/**
 * Centralized, server-only configuration for the Gemini integration.
 * Everything model-related is tuned here so agent logic never hard-codes it.
 */

/** Fast, current Gemini model suited to interactive streaming responses. */
export const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || 'gemini-3.6-flash'

/** Thinking depth for reasoning models. MINIMAL keeps debates responsive.
 *  Gemini 3.5+ rejects the older `thinkingBudget` setting entirely. */
export const THINKING_LEVEL = 'MINIMAL'

/** Hard limit on the proposition accepted from the client. */
export const MAX_PROPOSITION_LENGTH = 2000

/** Per-agent generation budget — keeps answers sharp, not essay-length.
 *  Thinking models spend part of this budget reasoning before emitting text. */
export const AGENT_MAX_OUTPUT_TOKENS = 1800
export const JUDGE_MAX_OUTPUT_TOKENS = 2000

/** Sampling temperatures per concern. */
export const AGENT_TEMPERATURE = 0.85
export const JUDGE_TEMPERATURE = 0.4

/** Retry policy for transient failures only. */
export const MAX_RETRIES = 2
export const RETRY_BASE_DELAY_MS = 600

/** Returns the trimmed API key, or null when it is missing/blank. */
export function getApiKey(): string | null {
  const key = process.env.GEMINI_API_KEY?.trim()
  return key ? key : null
}
