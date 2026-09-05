import { runDebate } from '@/lib/ai/debate'
import { parseJsonBody, readUserApiKey, requireAnyApiKey, streamResponse } from '@/lib/ai/http'
import { readProposition } from '@/lib/ai/validate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * POST /api/debate
 * Body: { proposition: string }
 * Optional header: x-gemini-api-key (BYOK — the user's own key, used for this
 * request only so their usage bills to them).
 * Streams NDJSON DebateEvents: intake/triage, then Advocate + Critic in
 * parallel, then the Auditor (which checks both), then the Judge.
 */
export async function POST(req: Request) {
  const { body, error } = await parseJsonBody(req)
  if (error) return error

  const result = readProposition(body)
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status })

  const userKey = readUserApiKey(req)
  const keyError = requireAnyApiKey(userKey)
  if (keyError) return keyError

  const proposition = result.proposition
  return streamResponse(
    (emit, signal) => runDebate(proposition, emit, signal, { apiKey: userKey }),
    req.signal,
  )
}
