import { GoogleGenAI, Type, type Schema, type ThinkingLevel } from '@google/genai'
import {
  GEMINI_MODEL,
  MAX_RETRIES,
  RETRY_BASE_DELAY_MS,
  THINKING_LEVEL,
  getApiKey,
} from './config'

/** Thrown when the server is not configured with a Gemini API key. */
export class MissingApiKeyError extends Error {
  constructor() {
    super('GEMINI_API_KEY is not configured on the server.')
    this.name = 'MissingApiKeyError'
  }
}

let cached: GoogleGenAI | null = null

/**
 * Returns a Gemini client. When `apiKey` (a user's BYOK key) is supplied, a fresh
 * client is built for that call and never cached — so one user's key can never
 * leak into another request. Otherwise the server key is used and cached once.
 */
export function getClient(apiKey?: string | null): GoogleGenAI {
  const byok = apiKey?.trim()
  if (byok) return new GoogleGenAI({ apiKey: byok })

  if (cached) return cached
  const serverKey = getApiKey()
  if (!serverKey) throw new MissingApiKeyError()
  cached = new GoogleGenAI({ apiKey: serverKey })
  return cached
}

type AnyError = { status?: number; statusCode?: number; name?: string; message?: string }

/** Extracts an HTTP status from the various error shapes the SDK may throw. */
function statusOf(err: unknown): number | undefined {
  const e = err as AnyError
  return e?.status ?? e?.statusCode
}

function isAbort(err: unknown): boolean {
  const e = err as AnyError
  return e?.name === 'AbortError' || /abort/i.test(e?.message ?? '')
}

/** Transient failures worth retrying; auth/config errors are never retried. */
function isRetryable(err: unknown): boolean {
  if (isAbort(err)) return false
  const status = statusOf(err)
  if (status === undefined) return true // network/connection level failure
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/** Dev-only: logs the real upstream failure so a 4xx cause is never guesswork. */
const DEBUG = process.env.NODE_ENV !== 'production'
function logFailure(context: string, err: unknown) {
  if (!DEBUG) return
  const e = err as AnyError
  console.warn(
    `[tribunal] gemini:${context} model=${GEMINI_MODEL} status=${statusOf(err) ?? 'n/a'} ${String(e?.message ?? err).slice(0, 300)}`,
  )
}

/** A short, non-sensitive message safe to surface to the client. */
export function publicErrorMessage(err: unknown): string {
  if (err instanceof MissingApiKeyError) return err.message
  if (isAbort(err)) return 'Request cancelled.'
  const status = statusOf(err)
  if (status === 401 || status === 403) return 'Gemini rejected the API key (unauthorized).'
  if (status === 404) return 'Gemini could not find the configured model (check GEMINI_MODEL).'
  if (status === 429) return 'Gemini is rate limiting requests. Please try again shortly.'
  if (status && status >= 500) return 'Gemini is temporarily unavailable.'
  if (status && status >= 400) return 'Gemini could not process the request.'
  return 'Unexpected error while contacting Gemini.'
}

export type StreamOptions = {
  systemInstruction: string
  prompt: string
  temperature?: number
  maxOutputTokens?: number
  abortSignal?: AbortSignal
  model?: string
  /** Optional BYOK key; falls back to the server key when omitted. */
  apiKey?: string | null
}

/**
 * Streams text for a single prompt, retrying transient failures that occur
 * before any content has been emitted. Once chunks start flowing we never
 * retry (that would duplicate partial output) — errors bubble up instead.
 */
export async function* streamText(
  opts: StreamOptions,
): AsyncGenerator<string, void, unknown> {
  const client = getClient(opts.apiKey)
  const model = opts.model ?? GEMINI_MODEL
  let attempt = 0
  let emitted = false

  for (;;) {
    try {
      const stream = await client.models.generateContentStream({
        model,
        contents: opts.prompt,
        config: {
          systemInstruction: opts.systemInstruction,
          temperature: opts.temperature,
          maxOutputTokens: opts.maxOutputTokens,
          thinkingConfig: { thinkingLevel: THINKING_LEVEL as ThinkingLevel },
          abortSignal: opts.abortSignal,
        },
      })

      for await (const chunk of stream) {
        if (opts.abortSignal?.aborted) return
        const text = chunk.text
        if (text) {
          emitted = true
          yield text
        }
      }
      return // completed successfully
    } catch (err) {
      if (isAbort(err) || opts.abortSignal?.aborted) return
      logFailure(`stream-attempt-${attempt}`, err)
      if (emitted || !isRetryable(err) || attempt >= MAX_RETRIES) throw err
      await delay(RETRY_BASE_DELAY_MS * 2 ** attempt)
      attempt++
    }
  }
}

export type JsonOptions = {
  systemInstruction: string
  prompt: string
  schema: Schema
  temperature?: number
  maxOutputTokens?: number
  abortSignal?: AbortSignal
  model?: string
  /** Optional BYOK key; falls back to the server key when omitted. */
  apiKey?: string | null
}

/**
 * Requests a JSON object constrained by `schema`, with limited retries for
 * transient failures. Returns the raw parsed value for caller-side validation.
 */
export async function generateJson<T = unknown>(opts: JsonOptions): Promise<T> {
  const client = getClient(opts.apiKey)
  const model = opts.model ?? GEMINI_MODEL
  let lastErr: unknown

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await delay(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1))
    try {
      const response = await client.models.generateContent({
        model,
        contents: opts.prompt,
        config: {
          systemInstruction: opts.systemInstruction,
          temperature: opts.temperature,
          maxOutputTokens: opts.maxOutputTokens,
          thinkingConfig: { thinkingLevel: THINKING_LEVEL as ThinkingLevel },
          responseMimeType: 'application/json',
          responseSchema: opts.schema,
          abortSignal: opts.abortSignal,
        },
      })
      const text = response.text
      if (!text) throw new Error('Empty response from Gemini.')
      return JSON.parse(text) as T
    } catch (err) {
      if (isAbort(err) || opts.abortSignal?.aborted) throw err
      logFailure(`json-attempt-${attempt}`, err)
      lastErr = err
      if (!isRetryable(err)) throw err
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Gemini request failed.')
}

export { Type }
