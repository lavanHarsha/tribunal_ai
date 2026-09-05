/**
 * Centralized, server-only configuration for the Gemini integration.
 * Everything model-related is tuned here so agent logic never hard-codes it.
 */

/** Fast, current Gemini model suited to interactive streaming responses.
 *  Pinned models get retired by Google over time; `gemini-flash-latest` is the
 *  future-proof alias if this one ever 404s. Override via GEMINI_MODEL in .env.local. */
export const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || 'gemini-3.6-flash'
export const GROQ_MODEL = process.env.GROQ_MODEL?.trim() || 'openai/gpt-oss-120b'
export const NVIDIA_MODEL = process.env.NVIDIA_MODEL?.trim() || 'nvidia/nemotron-3-super-120b-a12b'

/** Thinking depth for reasoning models. MINIMAL keeps debates responsive.
 *  Gemini 3.5+ rejects the older `thinkingBudget` setting entirely. */
export const THINKING_LEVEL = 'MINIMAL'

/** Hard limit on the proposition accepted from the client. */
export const MAX_PROPOSITION_LENGTH = 2000

/** Per-agent generation budget — keeps answers sharp, not essay-length.
 *  Thinking models spend part of this budget reasoning before emitting text. */
export const AGENT_MAX_OUTPUT_TOKENS = 1800
export const JUDGE_MAX_OUTPUT_TOKENS = 2200

/** Intake triage is a tiny, fast classification+polish call, kept cheap. */
export const TRIAGE_MAX_OUTPUT_TOKENS = 1024

/** Sampling temperatures per concern. */
export const AGENT_TEMPERATURE = 0.85
export const JUDGE_TEMPERATURE = 0.4
export const TRIAGE_TEMPERATURE = 0.3

/** Fallback suggestion chips when the model returns none. */
export const DEFAULT_SUGGESTIONS = [
  'Should cities prioritize rewilding over new housing?',
  'Is remote work actually better for society?',
  'Should AI-generated art be copyrightable?',
]

/**
 * Per-request AI context. When a user supplies their own key (BYOK) it is
 * carried here and used instead of the server key for that request only.
 * It is never logged, cached across requests, or returned to the client.
 */
export type AiContext = { apiKey?: string | null }

/** Retry policy for transient failures only. */
export const MAX_RETRIES = 2
export const RETRY_BASE_DELAY_MS = 600

/** Returns trimmed provider API keys, or null when missing/blank. */
export function getGroqApiKey(): string | null {
  const key = process.env.GROQ_API_KEY?.trim()
  return key ? key : null
}

export function getNvidiaApiKey(): string | null {
  const key = process.env.NVIDIA_API_KEY?.trim()
  return key ? key : null
}

export function getGeminiApiKey(): string | null {
  const key = process.env.GEMINI_API_KEY?.trim()
  return key ? key : null
}

export function getApiKey(): string | null {
  return getGeminiApiKey()
}

