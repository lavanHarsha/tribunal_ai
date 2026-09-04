import { runDebate } from '@/lib/ai/debate'
import { parseJsonBody, requireApiKey, streamResponse } from '@/lib/ai/http'
import { readProposition } from '@/lib/ai/validate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * POST /api/debate
 * Body: { proposition: string }
 * Streams NDJSON DebateEvents: three agents run concurrently, then the Judge.
 */
export async function POST(req: Request) {
  const { body, error } = await parseJsonBody(req)
  if (error) return error

  const result = readProposition(body)
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status })

  const keyError = requireApiKey()
  if (keyError) return keyError

  const proposition = result.proposition
  return streamResponse((emit, signal) => runDebate(proposition, emit, signal), req.signal)
}
