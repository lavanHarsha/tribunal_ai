import type { DebateEvent } from './types'

export type Emit = (event: DebateEvent) => void

/**
 * Wraps an async `run` function in a ReadableStream of newline-delimited JSON
 * (NDJSON) events. Emission is safe after close/cancel, and a client disconnect
 * (or an explicit request abort) propagates an AbortSignal to downstream work so
 * Gemini requests are not left running needlessly.
 */
export function createEventStream(
  run: (emit: Emit, signal: AbortSignal) => Promise<void>,
  requestSignal?: AbortSignal,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const ac = new AbortController()
  const onAbort = () => ac.abort()

  if (requestSignal) {
    if (requestSignal.aborted) ac.abort()
    else requestSignal.addEventListener('abort', onAbort, { once: true })
  }

  let closed = false
  const cleanup = () => requestSignal?.removeEventListener('abort', onAbort)

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit: Emit = (event) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
        } catch {
          closed = true
        }
      }

      try {
        await run(emit, ac.signal)
      } catch {
        emit({ type: 'error', message: 'Internal error while running the debate.' })
      } finally {
        if (!closed) {
          try {
            controller.close()
          } catch {
            /* already closed */
          }
          closed = true
        }
        cleanup()
      }
    },
    cancel() {
      closed = true
      ac.abort()
      cleanup()
    },
  })
}
