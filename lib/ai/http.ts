import { getApiKey } from './config'
import { createEventStream, type Emit } from './stream'

/** Headers for an NDJSON streaming response (no buffering, no transform). */
const STREAM_HEADERS = {
  'Content-Type': 'application/x-ndjson; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  'X-Accel-Buffering': 'no',
} as const

/** Parses a JSON request body, returning a 400 Response when malformed. */
export async function parseJsonBody(
  req: Request,
): Promise<{ body?: unknown; error?: Response }> {
  try {
    return { body: await req.json() }
  } catch {
    return { error: Response.json({ error: 'Request body must be valid JSON.' }, { status: 400 }) }
  }
}

/** Returns a 503 Response when the server has no Gemini key configured. */
export function requireApiKey(): Response | null {
  if (getApiKey()) return null
  return Response.json(
    { error: 'Server is missing GEMINI_API_KEY. Configure it in the environment.' },
    { status: 503 },
  )
}

/** Builds a streaming NDJSON Response wired to the client's abort signal. */
export function streamResponse(
  run: (emit: Emit, signal: AbortSignal) => Promise<void>,
  requestSignal?: AbortSignal,
): Response {
  return new Response(createEventStream(run, requestSignal), { headers: { ...STREAM_HEADERS } })
}
