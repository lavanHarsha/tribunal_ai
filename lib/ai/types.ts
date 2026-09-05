/**
 * Shared contracts for the TRIBUNAL debate system.
 * These types are consumed by both the server orchestration layer and the
 * browser client so the UI never needs to know about Gemini specifics.
 */

export type Role = 'advocate' | 'critic' | 'auditor'

export const ROLES: readonly Role[] = ['advocate', 'critic', 'auditor'] as const

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}

/** Structured, validated output produced by the Judge. */
export type JudgeVerdict = {
  winner: Role | 'draw'
  /** 0-100 integer confidence in the verdict. */
  confidence: number
  /** Short headline verdict (a few words) shown as the Judge's title. */
  verdict: string
  /** The proper synthesis: a clear 3-5 sentence summary shown first. */
  summary: string
  /** The Judge's own reasoned takeaways, revealed below the summary. */
  keyPoints: string[]
  strongestArgument: string
  weakestArgument: string
  keyDisagreement: string
  factualConcerns: string[]
}

/**
 * Generic stream events sent from the API to the browser.
 * The frontend consumes these without any knowledge of the model layer.
 */
export type DebateEvent =
  | { type: 'triage_start' }
  | { type: 'proposition_ready'; original: string; refined: string; title: string }
  | { type: 'chat_reply'; message: string; suggestions: string[] }
  | { type: 'agent_start'; agent: Role }
  | { type: 'agent_chunk'; agent: Role; text: string }
  | { type: 'agent_complete'; agent: Role }
  | { type: 'agent_error'; agent: Role; message: string }
  | { type: 'judge_start' }
  | { type: 'judge_complete'; verdict: JudgeVerdict }
  | { type: 'judge_error'; message: string }
  | { type: 'error'; message: string }
  | { type: 'done' }

/** A completed debate persisted to the browser's history (localStorage). */
export type SavedDebate = {
  id: string
  proposition: string
  createdAt: number
  contents: Record<Role, string>
  errors: Partial<Record<Role, string>>
  verdict: JudgeVerdict | null
}
