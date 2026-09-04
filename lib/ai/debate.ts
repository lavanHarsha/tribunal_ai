import type { Role } from './types'
import { ROLES } from './types'
import { AGENTS, buildAgentPrompt } from './agents'
import { streamText, publicErrorMessage } from './gemini'
import { AGENT_MAX_OUTPUT_TOKENS, AGENT_TEMPERATURE } from './config'
import { runJudge } from './judge'
import type { Emit } from './stream'

/** Concise dev-only logging; trivially removable and silent in production. */
const DEBUG = process.env.NODE_ENV !== 'production'
function log(...args: unknown[]) {
  if (DEBUG) console.log('[tribunal]', ...args)
}

/**
 * Streams a single agent's analysis, emitting generic events and accumulating
 * the produced text. Per-agent failures are contained: they emit `agent_error`
 * and resolve with whatever partial text arrived, so one bad agent never tears
 * down the whole debate.
 */
async function runAgent(
  proposition: string,
  role: Role,
  emit: Emit,
  signal: AbortSignal,
): Promise<string> {
  const started = Date.now()
  emit({ type: 'agent_start', agent: role })
  log('agent:start', role)

  let text = ''
  try {
    const stream = streamText({
      systemInstruction: AGENTS[role].systemInstruction,
      prompt: buildAgentPrompt(role, proposition),
      temperature: AGENT_TEMPERATURE,
      maxOutputTokens: AGENT_MAX_OUTPUT_TOKENS,
      abortSignal: signal,
    })

    for await (const piece of stream) {
      if (signal.aborted) break
      text += piece
      emit({ type: 'agent_chunk', agent: role, text: piece })
    }

    if (signal.aborted) return text
    if (!text.trim()) throw new Error('Agent produced an empty response.')

    emit({ type: 'agent_complete', agent: role })
    log('agent:complete', role, `${Date.now() - started}ms`)
    return text
  } catch (err) {
    if (signal.aborted) return text
    const message = publicErrorMessage(err)
    log('agent:error', role, message)
    emit({ type: 'agent_error', agent: role, message })
    return text
  }
}

/**
 * Runs a full debate: Advocate, Critic and Auditor execute concurrently, then —
 * once their outputs settle — the Judge synthesizes a structured verdict.
 */
export async function runDebate(
  proposition: string,
  emit: Emit,
  signal: AbortSignal,
): Promise<void> {
  const debateStart = Date.now()
  log('debate:start', `${proposition.length} chars`)

  // Parallel agent execution — never sequential.
  const [advocate, critic, auditor] = await Promise.all(
    ROLES.map((role) => runAgent(proposition, role, emit, signal)),
  )

  if (signal.aborted) {
    emit({ type: 'done' })
    return
  }

  const outputs = { advocate, critic, auditor }
  const hasContent = Object.values(outputs).some((t) => t.trim().length > 0)

  if (!hasContent) {
    log('debate:judge-skipped', 'no agent output')
    emit({ type: 'judge_error', message: 'No agent output was available to judge.' })
    emit({ type: 'done' })
    return
  }

  emit({ type: 'judge_start' })
  log('judge:start')
  const judgeStart = Date.now()

  try {
    const verdict = await runJudge(proposition, outputs, signal)
    if (signal.aborted) {
      emit({ type: 'done' })
      return
    }
    emit({ type: 'judge_complete', verdict })
    log('judge:complete', `${Date.now() - judgeStart}ms`)
  } catch (err) {
    if (signal.aborted) {
      emit({ type: 'done' })
      return
    }
    // Safe fallback: the debate still succeeded at the agent level.
    log('judge:error', publicErrorMessage(err))
    emit({ type: 'judge_error', message: publicErrorMessage(err) })
  }

  emit({ type: 'done' })
  log('debate:complete', `${Date.now() - debateStart}ms`)
}

/**
 * Re-runs a single agent (used by the card "Retry" action). Does not re-run the
 * Judge; it simply restores the missing perspective.
 */
export async function runSingleAgent(
  proposition: string,
  role: Role,
  emit: Emit,
  signal: AbortSignal,
): Promise<void> {
  log('retry:start', role)
  await runAgent(proposition, role, emit, signal)
  emit({ type: 'done' })
  log('retry:complete', role)
}
