import { GoogleGenAI, Type } from '@google/genai'
import {
  GEMINI_MODEL,
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
function redactKeys(text: string): string {
  if (!text) return ''
  return text
    .replace(/(AIzaSy[A-Za-z0-9_-]{33}|gsk_[A-Za-z0-9]{40,}|nvapi-[A-Za-z0-9_-]{40,})/gi, '[REDACTED_KEY]')
    .replace(/(Bearer\s+)[A-Za-z0-9_.-]+/gi, '$1[REDACTED_TOKEN]')
    .replace(/(x-gemini-api-key:\s*)[^\s,]+/gi, '$1[REDACTED_HEADER]')
}

function logFailure(context: string, err: unknown) {
  if (!DEBUG) return
  const e = err as AnyError
  const raw = String(e?.message ?? err)
  console.warn(
    `[tribunal] gemini:${context} model=${GEMINI_MODEL} status=${statusOf(err) ?? 'n/a'} ${redactKeys(raw).slice(0, 300)}`,
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

export { Type }
