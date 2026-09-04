'use client'

import type { DebateEvent, Role } from './ai/types'

export type EventHandler = (event: DebateEvent) => void

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

async function post(url: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

/** Starts a full debate (three agents in parallel, then the Judge). */
export async function startDebate(
  proposition: string,
  onEvent: EventHandler,
  signal?: AbortSignal,
): Promise<void> {
  const res = await post('/api/debate', { proposition }, signal)
  await consume(res, onEvent)
}

/** Re-runs a single agent after a failure. */
export async function retryAgent(
  proposition: string,
  agent: Role,
  onEvent: EventHandler,
  signal?: AbortSignal,
): Promise<void> {
  const res = await post('/api/debate/agent', { proposition, agent }, signal)
  await consume(res, onEvent)
}
