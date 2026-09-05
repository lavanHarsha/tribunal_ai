import type { Role } from './types'
import { AGENTS, buildAgentPrompt, type PeerArguments } from './agents'
import { streamText, publicErrorMessage } from './provider'
import { type AiContext, AGENT_MAX_OUTPUT_TOKENS, AGENT_TEMPERATURE } from './config'
import { runJudge } from './judge'
import { triageInput, type Triage } from './triage'
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
 *
 * `peers` is supplied only for the Auditor, which cross-checks both sides.
 */
async function runAgent(
  proposition: string,
  role: Role,
  emit: Emit,
  signal: AbortSignal,
  ctx?: AiContext,
  peers?: PeerArguments,
): Promise<string> {
  const started = Date.now()
  emit({ type: 'agent_start', agent: role })
  log('agent:start', role)

  let text = ''
  try {
    const stream = streamText({
      role,
      systemInstruction: AGENTS[role].systemInstruction,
      prompt: buildAgentPrompt(role, proposition, peers),
      temperature: AGENT_TEMPERATURE,
      maxOutputTokens: AGENT_MAX_OUTPUT_TOKENS,
      apiKey: ctx?.apiKey,
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
 * Runs a full debate:
 *  1. Intake — classify the message and polish it into a clean proposition.
 *     Non-debate input ("hi", "what is this?") short-circuits to a direct reply.
 *  2. Advocate and Critic argue independently, in parallel.
 *  3. Auditor reads BOTH arguments and checks their facts and logic.
 *  4. Judge synthesizes everything into a verdict (summary + key points).
 */
export async function runDebate(
  proposition: string,
  emit: Emit,
  signal: AbortSignal,
  ctx?: AiContext,
): Promise<void> {
  const debateStart = Date.now()
  log('debate:start', `${proposition.length} chars`)

  // 1. Intake. Raw user text is never sent straight to the agents.
  emit({ type: 'triage_start' })
  let triage: Triage
  try {
    triage = await triageInput(proposition, ctx, signal)
  } catch (err) {
    if (signal.aborted) {
      emit({ type: 'done' })
      return
    }
    // Triage is a nicety, not a gate: on failure, fall back to the user's words.
    log('triage:error', publicErrorMessage(err))
    triage = { intent: 'debate', refined: proposition, title: proposition.slice(0, 60), reply: '', suggestions: [] }
  }
  if (signal.aborted) {
    emit({ type: 'done' })
    return
  }

  // Non-debate input gets a direct, human reply instead of a full tribunal.
  if (triage.intent !== 'debate') {
    log('triage:reply', triage.intent)
    emit({ type: 'chat_reply', message: triage.reply, suggestions: triage.suggestions })
    emit({ type: 'done' })
    return
  }

  const refined = triage.refined || proposition
  emit({ type: 'proposition_ready', original: proposition, refined, title: triage.title })
  log('triage:debate', `"${refined.slice(0, 60)}"`)

  // 2. Advocate and Critic run independently and in parallel.
  const [advocate, critic] = await Promise.all([
    runAgent(refined, 'advocate', emit, signal, ctx),
    runAgent(refined, 'critic', emit, signal, ctx),
  ])
  if (signal.aborted) {
    emit({ type: 'done' })
    return
  }

  // 3. Auditor sees both arguments and checks them. Runs after the two sides.
  const auditor = await runAgent(refined, 'auditor', emit, signal, ctx, { advocate, critic })
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

  // 4. Judge weighs all three into a structured verdict.
  emit({ type: 'judge_start' })
  log('judge:start')
  const judgeStart = Date.now()

  try {
    const verdict = await runJudge(refined, outputs, ctx, signal)
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
 * Judge or intake; it simply restores the missing perspective. `peers` lets the
 * Auditor be retried with the same two arguments it originally cross-checked.
 */
export async function runSingleAgent(
  proposition: string,
  role: Role,
  emit: Emit,
  signal: AbortSignal,
  ctx?: AiContext,
  peers?: PeerArguments,
): Promise<void> {
  log('retry:start', role)
  await runAgent(proposition, role, emit, signal, ctx, peers)
  emit({ type: 'done' })
  log('retry:complete', role)
}
