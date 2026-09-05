import { getGeminiApiKey, getGroqApiKey, getNvidiaApiKey } from './config'
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

/** Returns a 503 Response when the server is missing required default provider keys. */
export function requireApiKey(): Response | null {
  const missing: string[] = []
  if (!getGroqApiKey()) missing.push('GROQ_API_KEY')
  if (!getNvidiaApiKey()) missing.push('NVIDIA_API_KEY')
  if (!getGeminiApiKey()) missing.push('GEMINI_API_KEY')
  if (missing.length === 0) return null
  return Response.json(
    { error: `Server is missing required environment variables: ${missing.join(', ')}. Configure them in .env.local or provide a BYOK Gemini key.` },
    { status: 503 },
  )
}

/** Header a client uses to supply its own Gemini key (BYOK). */
export const BYOK_HEADER = 'x-gemini-api-key'

/**
 * Reads an optional user-supplied Gemini key from the request header.
 * Returns null when absent or implausible. The value is used server-side for
 * this request only — never logged, stored, or echoed back.
 */
export function readUserApiKey(req: Request): string | null {
  const raw = req.headers.get(BYOK_HEADER)
  if (!raw) return null
  const key = raw.trim()
  // Gemini keys are ~39+ chars; reject anything clearly not a key without
  // hard-coding a prefix (formats vary between AI Studio and Cloud).
  if (key.length < 20 || key.length > 300) return null
  return key
}

/**
 * Ensures SOME key is available: either the user's BYOK Gemini key or the default server keys.
 * Returns null when it is safe to proceed, or a 503 Response when neither exists.
 */
export function requireAnyApiKey(userKey: string | null): Response | null {
  if (userKey) return null
  return requireApiKey()
}

/** Builds a streaming NDJSON Response wired to the client's abort signal. */
export function streamResponse(
  run: (emit: Emit, signal: AbortSignal) => Promise<void>,
  requestSignal?: AbortSignal,
): Response {
  return new Response(createEventStream(run, requestSignal), { headers: { ...STREAM_HEADERS } })
}
