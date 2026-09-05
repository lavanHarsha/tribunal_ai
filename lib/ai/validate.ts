import { MAX_PROPOSITION_LENGTH } from './config'
import { isRole, type Role } from './types'
import type { PeerArguments } from './agents'

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

/** Upper bound on a peer argument sent back for an Auditor retry. */
const MAX_PEER_LENGTH = 6000

/**
 * Reads the optional `context` object a client sends when retrying the Auditor,
 * so it can cross-check the same two arguments. Returns undefined when there is
 * nothing usable; values are truncated to a safe length.
 */
export function readPeerContext(body: unknown): PeerArguments | undefined {
  const ctx = (body as { context?: unknown } | null)?.context
  if (!ctx || typeof ctx !== 'object') return undefined
  const c = ctx as { advocate?: unknown; critic?: unknown }
  const advocate = typeof c.advocate === 'string' ? c.advocate.slice(0, MAX_PEER_LENGTH) : ''
  const critic = typeof c.critic === 'string' ? c.critic.slice(0, MAX_PEER_LENGTH) : ''
  if (!advocate.trim() && !critic.trim()) return undefined
  return { advocate, critic }
}
