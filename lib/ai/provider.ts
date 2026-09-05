import { Type, type Schema } from '@google/genai'
import type { Role } from './types'
import {
  AGENT_MAX_OUTPUT_TOKENS,
  AGENT_TEMPERATURE,
  GEMINI_MODEL,
  GROQ_MODEL,
  JUDGE_MAX_OUTPUT_TOKENS,
  JUDGE_TEMPERATURE,
  MAX_RETRIES,
  NVIDIA_MODEL,
  RETRY_BASE_DELAY_MS,
  TRIAGE_MAX_OUTPUT_TOKENS,
  TRIAGE_TEMPERATURE,
  getGeminiApiKey,
  getGroqApiKey,
  getNvidiaApiKey,
} from './config'
import {
  getClient as getGeminiClient,
  MissingApiKeyError as MissingGeminiApiKeyError,
  publicErrorMessage as publicGeminiErrorMessage,
} from './gemini'

export type ProviderType = 'groq' | 'nvidia' | 'gemini'

export type AgentStage = Role | 'judge' | 'triage'

/** Default provider mapping per agent stage in default mode. */
export const ROLE_PROVIDER_MAP: Record<AgentStage, ProviderType> = {
  advocate: 'groq',
  auditor: 'groq',
  critic: 'nvidia',
  judge: 'gemini',
  triage: 'groq',
}

export class MissingProviderApiKeyError extends Error {
  providerName: string
  envVar: string
  constructor(providerName: string, envVar: string) {
    super(`Server is missing ${envVar} for ${providerName}.`)
    this.name = 'MissingProviderApiKeyError'
    this.providerName = providerName
    this.envVar = envVar
  }
}

export class ProviderHttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ProviderHttpError'
    this.status = status
  }
}

export type StreamOptions = {
  systemInstruction: string
  prompt: string
  temperature?: number
  maxOutputTokens?: number
  abortSignal?: AbortSignal
  model?: string
  /** Optional BYOK key; triggers BYOK mode for Gemini when present. */
  apiKey?: string | null
  /** Agent stage to automatically resolve provider in default mode. */
  role?: AgentStage
  /** Explicit provider override if role is not supplied. */
  provider?: ProviderType
}

export type JsonOptions = {
  systemInstruction: string
  prompt: string
  schema?: Schema
  temperature?: number
  maxOutputTokens?: number
  abortSignal?: AbortSignal
  model?: string
  /** Optional BYOK key; triggers BYOK mode for Gemini when present. */
  apiKey?: string | null
  /** Agent stage to automatically resolve provider in default mode. */
  role?: AgentStage
  /** Explicit provider override if role is not supplied. */
  provider?: ProviderType
}

type AnyError = { status?: number; statusCode?: number; name?: string; message?: string }

function statusOf(err: unknown): number | undefined {
  if (err instanceof ProviderHttpError) return err.status
  const e = err as AnyError
  return e?.status ?? e?.statusCode
}

function isAbort(err: unknown): boolean {
  const e = err as AnyError
  return e?.name === 'AbortError' || /abort/i.test(e?.message ?? '')
}

function isRetryable(err: unknown): boolean {
  if (isAbort(err)) return false
  const status = statusOf(err)
  if (status === undefined) return true // Network/connection issue
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

const DEBUG = process.env.NODE_ENV !== 'production'
function logFailure(provider: string, context: string, err: unknown) {
  if (!DEBUG) return
  const e = err as AnyError
  console.warn(
    `[tribunal] ${provider}:${context} status=${statusOf(err) ?? 'n/a'} ${String(e?.message ?? err).slice(0, 300)}`,
  )
}

/** User-friendly public error messages (never exposing keys or raw auth data). */
export function publicErrorMessage(err: unknown): string {
  if (err instanceof MissingProviderApiKeyError || err instanceof MissingGeminiApiKeyError) {
    return err.message
  }
  if (isAbort(err)) return 'Request cancelled.'
  const status = statusOf(err)
  if (status === 401 || status === 403) return 'Provider rejected the API key (unauthorized).'
  if (status === 404) return 'Provider could not find the requested model.'
  if (status === 429) return 'Provider is rate limiting requests. Please try again shortly.'
  if (status && status >= 500) return 'Provider service is temporarily unavailable.'
  if (status && status >= 400) return 'Provider could not process the request.'
  return publicGeminiErrorMessage(err)
}

/** Resolves the target provider, API key, and model name based on BYOK state or role. */
export function resolveTarget(opts: { apiKey?: string | null; role?: AgentStage; provider?: ProviderType; model?: string }): {
  provider: ProviderType
  apiKey: string
  model: string
} {
  const byok = opts.apiKey?.trim()
  if (byok) {
    // BYOK Mode: User Gemini key overrides all 4 agents
    return {
      provider: 'gemini',
      apiKey: byok,
      model: opts.model || GEMINI_MODEL,
    }
  }

  const provider = opts.provider || (opts.role ? ROLE_PROVIDER_MAP[opts.role] : 'groq')

  if (provider === 'groq') {
    const key = getGroqApiKey()
    if (!key) throw new MissingProviderApiKeyError('Groq', 'GROQ_API_KEY')
    return { provider: 'groq', apiKey: key, model: opts.model || GROQ_MODEL }
  }

  if (provider === 'nvidia') {
    const key = getNvidiaApiKey()
    if (!key) throw new MissingProviderApiKeyError('NVIDIA NIM', 'NVIDIA_API_KEY')
    return { provider: 'nvidia', apiKey: key, model: opts.model || NVIDIA_MODEL }
  }

  // Gemini server mode
  const key = getGeminiApiKey()
  if (!key || key.startsWith('AQ.')) {
    // If server has no valid Gemini key, fall back to Groq for default mode
    const groqKey = getGroqApiKey()
    if (groqKey) return { provider: 'groq', apiKey: groqKey, model: opts.model || GROQ_MODEL }
    const nvidiaKey = getNvidiaApiKey()
    if (nvidiaKey) return { provider: 'nvidia', apiKey: nvidiaKey, model: opts.model || NVIDIA_MODEL }
    throw new MissingProviderApiKeyError('Gemini', 'GEMINI_API_KEY')
  }
  return { provider: 'gemini', apiKey: key, model: opts.model || GEMINI_MODEL }
}

const OPENAI_ENDPOINTS: Record<'groq' | 'nvidia', string> = {
  groq: 'https://api.groq.com/openai/v1',
  nvidia: 'https://integrate.api.nvidia.com/v1',
}

/** Universal streaming function across Gemini, Groq, and NVIDIA NIM. */
export async function* streamText(opts: StreamOptions): AsyncGenerator<string, void, unknown> {
  const target = resolveTarget(opts)

  if (target.provider === 'gemini') {
    const client = getGeminiClient(target.apiKey)
    let attempt = 0
    let emitted = false

    for (;;) {
      try {
        const stream = await client.models.generateContentStream({
          model: target.model,
          contents: opts.prompt,
          config: {
            systemInstruction: opts.systemInstruction,
            temperature: opts.temperature ?? AGENT_TEMPERATURE,
            maxOutputTokens: opts.maxOutputTokens ?? AGENT_MAX_OUTPUT_TOKENS,
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
        return
      } catch (err) {
        if (isAbort(err) || opts.abortSignal?.aborted) return
        logFailure('gemini', `stream-attempt-${attempt}`, err)
        if (emitted || !isRetryable(err) || attempt >= MAX_RETRIES) throw err
        await delay(RETRY_BASE_DELAY_MS * 2 ** attempt)
        attempt++
      }
    }
  }

  // Groq & NVIDIA NIM (OpenAI Chat Completions API)
  const baseUrl = OPENAI_ENDPOINTS[target.provider]
  const endpoint = `${baseUrl}/chat/completions`

  let attempt = 0
  let emitted = false

  for (;;) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${target.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: target.model,
          messages: [
            { role: 'system', content: opts.systemInstruction },
            { role: 'user', content: opts.prompt },
          ],
          temperature: opts.temperature ?? AGENT_TEMPERATURE,
          max_tokens: opts.maxOutputTokens ?? AGENT_MAX_OUTPUT_TOKENS,
          stream: true,
        }),
        signal: opts.abortSignal,
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        let msg = `HTTP ${res.status}`
        try {
          const parsed = JSON.parse(errText)
          if (parsed?.error?.message) msg = parsed.error.message
        } catch {}
        throw new ProviderHttpError(res.status, msg)
      }

      if (!res.body) throw new Error(`${target.provider} returned an empty response body.`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          if (opts.abortSignal?.aborted) return

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed || trimmed.startsWith(':')) continue
            if (trimmed === 'data: [DONE]') return

            if (trimmed.startsWith('data: ')) {
              const dataJson = trimmed.slice(6).trim()
              if (dataJson === '[DONE]') return
              try {
                const parsed = JSON.parse(dataJson)
                const text = parsed.choices?.[0]?.delta?.content
                if (text) {
                  emitted = true
                  yield text
                }
              } catch {}
            }
          }
        }

        if (buffer.trim().startsWith('data: ')) {
          const dataJson = buffer.trim().slice(6).trim()
          if (dataJson && dataJson !== '[DONE]') {
            try {
              const parsed = JSON.parse(dataJson)
              const text = parsed.choices?.[0]?.delta?.content
              if (text) {
                emitted = true
                yield text
              }
            } catch {}
          }
        }
        return
      } finally {
        reader.releaseLock()
      }
    } catch (err) {
      if (isAbort(err) || opts.abortSignal?.aborted) return
      logFailure(target.provider, `stream-attempt-${attempt}`, err)
      if (emitted || !isRetryable(err) || attempt >= MAX_RETRIES) {
        // Automatically fall back to secondary server provider on rate limits before text emission
        if (!opts.apiKey && statusOf(err) === 429 && !emitted && (target.provider === 'groq' || target.provider === 'nvidia')) {
          const fallbackProvider: ProviderType = target.provider === 'nvidia' ? 'groq' : 'nvidia'
          logFailure(target.provider, `rate-limit 429 fallback -> ${fallbackProvider}`, err)
          try {
            for await (const chunk of streamText({ ...opts, provider: fallbackProvider })) {
              yield chunk
            }
            return
          } catch {}
        }
        throw err
      }
      await delay(RETRY_BASE_DELAY_MS * 2 ** attempt)
      attempt++
    }
  }
}

function cleanJsonResponse(text: string): string {
  let trimmed = text.trim()
  if (trimmed.startsWith('```')) {
    trimmed = trimmed.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
  }
  return trimmed
}

/** Universal structured JSON generation function across Gemini, Groq, and NVIDIA NIM. */
export async function generateJson<T = unknown>(opts: JsonOptions): Promise<T> {
  const target = resolveTarget(opts)

  if (target.provider === 'gemini') {
    const client = getGeminiClient(target.apiKey)
    let lastErr: unknown

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) await delay(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1))
      try {
        const response = await client.models.generateContent({
          model: target.model,
          contents: opts.prompt,
          config: {
            systemInstruction: opts.systemInstruction,
            temperature: opts.temperature ?? JUDGE_TEMPERATURE,
            maxOutputTokens: opts.maxOutputTokens ?? JUDGE_MAX_OUTPUT_TOKENS,
            responseMimeType: 'application/json',
            ...(opts.schema ? { responseSchema: opts.schema } : {}),
            abortSignal: opts.abortSignal,
          },
        })
        const text = response.text
        if (!text) throw new Error('Empty response from Gemini.')
        return JSON.parse(cleanJsonResponse(text)) as T
      } catch (err) {
        if (isAbort(err) || opts.abortSignal?.aborted) throw err
        logFailure('gemini', `json-attempt-${attempt}`, err)
        lastErr = err
        if (!isRetryable(err)) throw err
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('Gemini request failed.')
  }

  // Groq & NVIDIA NIM
  const baseUrl = OPENAI_ENDPOINTS[target.provider]
  const endpoint = `${baseUrl}/chat/completions`
  const jsonSystem = `${opts.systemInstruction}\n\nIMPORTANT: Respond strictly with raw valid JSON matching the requested structure. Do not wrap in markdown or add explanations.`

  let lastErr: unknown

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await delay(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1))
    try {
      const bodyPayload: Record<string, unknown> = {
        model: target.model,
        messages: [
          { role: 'system', content: jsonSystem },
          { role: 'user', content: opts.prompt },
        ],
        temperature: opts.temperature ?? TRIAGE_TEMPERATURE,
        max_tokens: opts.maxOutputTokens ?? TRIAGE_MAX_OUTPUT_TOKENS,
      }

      if (target.provider === 'groq') {
        bodyPayload.response_format = { type: 'json_object' }
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${target.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(bodyPayload),
        signal: opts.abortSignal,
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        let msg = `HTTP ${res.status}`
        try {
          const parsed = JSON.parse(errText)
          if (parsed?.error?.message) msg = parsed.error.message
        } catch {}
        throw new ProviderHttpError(res.status, msg)
      }

      const data = await res.json()
      const rawText = data?.choices?.[0]?.message?.content
      if (!rawText) throw new Error(`Empty JSON response from ${target.provider}.`)

      const cleaned = cleanJsonResponse(rawText)
      return JSON.parse(cleaned) as T
    } catch (err) {
      if (isAbort(err) || opts.abortSignal?.aborted) throw err
      logFailure(target.provider, `json-attempt-${attempt}`, err)
      if (!isRetryable(err) || attempt >= MAX_RETRIES) {
        // Automatically fall back to secondary server provider on rate limits in Default Mode
        if (!opts.apiKey && statusOf(err) === 429 && (target.provider === 'groq' || target.provider === 'nvidia')) {
          const fallbackProvider: ProviderType = target.provider === 'nvidia' ? 'groq' : 'nvidia'
          logFailure(target.provider, `rate-limit 429 fallback -> ${fallbackProvider}`, err)
          try {
            return await generateJson<T>({ ...opts, provider: fallbackProvider })
          } catch {}
        }
        throw err
      }
      lastErr = err
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(`${target.provider} request failed.`)
}

export { Type }
