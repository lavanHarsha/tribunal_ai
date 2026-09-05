import { runSingleAgent } from '@/lib/ai/debate'
import { parseJsonBody, readUserApiKey, requireAnyApiKey, streamResponse } from '@/lib/ai/http'
import { readPeerContext, readProposition, readRole } from '@/lib/ai/validate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/debate/agent
 * Body: { proposition: string, agent: 'advocate' | 'critic' | 'auditor', context?: { advocate?, critic? } }
 * Optional header: x-gemini-api-key (BYOK).
 * Streams NDJSON DebateEvents for a single re-run agent (card "Retry"). The
 * optional `context` lets a retried Auditor cross-check the same two arguments.
 */
export async function POST(req: Request) {
  const { body, error } = await parseJsonBody(req)
  if (error) return error

  const result = readProposition(body)
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status })

  const role = readRole(body)
  if (!role) {
    return Response.json(
      { error: 'A valid "agent" (advocate, critic or auditor) is required.' },
      { status: 400 },
    )
  }

  const userKey = readUserApiKey(req)
  const keyError = requireAnyApiKey(userKey)
  if (keyError) return keyError

  const proposition = result.proposition
  const peers = readPeerContext(body)
  return streamResponse(
    (emit, signal) => runSingleAgent(proposition, role, emit, signal, { apiKey: userKey }, peers),
    req.signal,
  )
}
