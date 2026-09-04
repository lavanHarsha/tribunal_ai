import { Type, generateJson } from './gemini'
import { JUDGE_MAX_OUTPUT_TOKENS, JUDGE_TEMPERATURE } from './config'
import type { JudgeVerdict, Role } from './types'
import { ROLES } from './types'

const JUDGE_SYSTEM = `You are the JUDGE of a three-way analytical tribunal.
You receive one proposition and the outputs of three independent agents:
- ADVOCATE (argues in favor)
- CRITIC (argues against)
- AUDITOR (assesses factual/logical reliability)

Your job is to independently SYNTHESIZE these arguments and reach the strongest overall position.
Rules:
- Do NOT simply vote or count sides. Weigh the actual quality of reasoning and evidence.
- Judge arguments on their merits; do not blindly trust any single agent.
- Be decisive but calibrated. Assign confidence that honestly reflects the balance of the arguments.
- Keep every field concise and grounded strictly in what the agents produced.
- "winner" is the position that better survives scrutiny: "advocate", "critic", or "draw".`.trim()

/** Schema constraining Gemini's structured JSON output. */
const VERDICT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    winner: { type: Type.STRING, enum: ['advocate', 'critic', 'draw'] },
    confidence: { type: Type.NUMBER },
    verdict: { type: Type.STRING },
    reasoning: { type: Type.STRING },
    strongestArgument: { type: Type.STRING },
    weakestArgument: { type: Type.STRING },
    keyDisagreement: { type: Type.STRING },
    factualConcerns: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: [
    'winner',
    'confidence',
    'verdict',
    'reasoning',
    'strongestArgument',
    'weakestArgument',
    'keyDisagreement',
    'factualConcerns',
  ],
}

type AgentOutputs = Record<Role, string>

function truncate(text: string, max = 6000): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** Builds the Judge prompt containing the proposition and all agent outputs. */
export function buildJudgePrompt(proposition: string, outputs: AgentOutputs): string {
  const section = (label: string, body: string) =>
    `${label}:\n${body.trim() ? truncate(body) : '(this agent produced no usable output)'}`

  return [
    `Original proposition:\n"""${proposition}"""`,
    section('ADVOCATE', outputs.advocate),
    section('CRITIC', outputs.critic),
    section('AUDITOR', outputs.auditor),
    'Deliver your structured verdict now.',
  ].join('\n\n')
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

/**
 * Validates and sanitizes the raw model output into a trustworthy JudgeVerdict.
 * Never trusts model-generated fields blindly; coerces/clamps every value.
 */
export function sanitizeVerdict(raw: unknown): JudgeVerdict {
  const obj = (raw ?? {}) as Record<string, unknown>

  const winnerRaw = typeof obj.winner === 'string' ? obj.winner.toLowerCase() : ''
  const winner: JudgeVerdict['winner'] =
    winnerRaw === 'draw' || (ROLES as readonly string[]).includes(winnerRaw)
      ? (winnerRaw as JudgeVerdict['winner'])
      : 'draw'

  const confidenceNum = Number(obj.confidence)
  // Accept 0..1 or 0..100, clamp to a 0..100 integer.
  const normalized = Number.isFinite(confidenceNum)
    ? confidenceNum <= 1
      ? confidenceNum * 100
      : confidenceNum
    : 50
  const confidence = Math.max(0, Math.min(100, Math.round(normalized)))

  const concerns = Array.isArray(obj.factualConcerns)
    ? obj.factualConcerns.filter((c): c is string => typeof c === 'string' && c.trim().length > 0).map((c) => c.trim())
    : []

  return {
    winner,
    confidence,
    verdict: str(obj.verdict, 'Verdict unavailable.'),
    reasoning: str(obj.reasoning, ''),
    strongestArgument: str(obj.strongestArgument, ''),
    weakestArgument: str(obj.weakestArgument, ''),
    keyDisagreement: str(obj.keyDisagreement, ''),
    factualConcerns: concerns.slice(0, 6),
  }
}

/** Runs the Judge and returns a validated verdict. Throws on hard failure. */
export async function runJudge(
  proposition: string,
  outputs: AgentOutputs,
  abortSignal?: AbortSignal,
): Promise<JudgeVerdict> {
  const raw = await generateJson({
    systemInstruction: JUDGE_SYSTEM,
    prompt: buildJudgePrompt(proposition, outputs),
    schema: VERDICT_SCHEMA,
    temperature: JUDGE_TEMPERATURE,
    maxOutputTokens: JUDGE_MAX_OUTPUT_TOKENS,
    abortSignal,
  })
  return sanitizeVerdict(raw)
}
