'use client'

import type { DebateEvent, Role } from './ai/types'

export type EventHandler = (event: DebateEvent) => void

/** Header used to forward a user's own Gemini key (BYOK). Mirrors the server. */
const BYOK_HEADER = 'x-gemini-api-key'

/** The two partisan arguments sent back when retrying the Auditor. */
export type PeerContext = { advocate?: string; critic?: string }

/** Reads an NDJSON response body and dispatches each parsed event. */
async function consume(res: Response, onEvent: EventHandler): Promise<void> {
  if (!res.body) throw new Error('The server returned no stream.')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let newline: number
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (!line) continue
      try {
        onEvent(JSON.parse(line) as DebateEvent)
      } catch {
        // Ignore a malformed line; keep the stream alive.
      }
    }
  }
}

async function post(
  url: string,
  body: unknown,
  signal?: AbortSignal,
  apiKey?: string,
): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers[BYOK_HEADER] = apiKey

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  })

  if (!res.ok) {
    let message = `Request failed (${res.status}).`
    try {
      const data = (await res.json()) as { error?: unknown }
      if (typeof data?.error === 'string') message = data.error
    } catch {
      /* non-JSON error body; keep the generic message */
    }
    throw new Error(message)
  }
  return res
}

/** Starts a full debate (intake, two sides, auditor, then the Judge). */
export async function startDebate(
  proposition: string,
  onEvent: EventHandler,
  signal?: AbortSignal,
  apiKey?: string,
): Promise<void> {
  const res = await post('/api/debate', { proposition }, signal, apiKey)
  await consume(res, onEvent)
}

/** Re-runs a single agent after a failure. */
export async function retryAgent(
  proposition: string,
  agent: Role,
  onEvent: EventHandler,
  signal?: AbortSignal,
  apiKey?: string,
  context?: PeerContext,
): Promise<void> {
  const res = await post('/api/debate/agent', { proposition, agent, context }, signal, apiKey)
  await consume(res, onEvent)
}
