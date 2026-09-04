import { MAX_PROPOSITION_LENGTH } from './config'
import { isRole, type Role } from './types'

export type PropositionResult =
  | { ok: true; proposition: string }
  | { ok: false; status: number; error: string }

/** Validates the proposition field from an untrusted request body. */
export function readProposition(body: unknown): PropositionResult {
  const proposition = (body as { proposition?: unknown } | null)?.proposition
  if (typeof proposition !== 'string' || !proposition.trim()) {
    return { ok: false, status: 400, error: 'A non-empty "proposition" string is required.' }
  }
  const trimmed = proposition.trim()
  if (trimmed.length > MAX_PROPOSITION_LENGTH) {
    return {
      ok: false,
      status: 400,
      error: `Proposition must be ${MAX_PROPOSITION_LENGTH} characters or fewer.`,
    }
  }
  return { ok: true, proposition: trimmed }
}

/** Validates the agent role field, returning null when invalid. */
export function readRole(body: unknown): Role | null {
  const agent = (body as { agent?: unknown } | null)?.agent
  return isRole(agent) ? agent : null
}
