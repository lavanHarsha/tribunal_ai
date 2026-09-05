import { Type, generateJson } from './provider'
import {
  DEFAULT_SUGGESTIONS,
  TRIAGE_MAX_OUTPUT_TOKENS,
  TRIAGE_TEMPERATURE,
  type AiContext,
} from './config'

/**
 * Intake layer. Before any agent runs, the user's raw message is classified and
 * (when it is a real debate) polished into a crisp, neutral proposition. This
 * keeps us from firing a full tribunal at "hi" and from feeding messy, half-formed
 * input straight into the agents.
 */

export type TriageIntent = 'debate' | 'smalltalk' | 'meta' | 'unclear'

export type Triage = {
  intent: TriageIntent
  /** Cleaned, self-contained proposition (debate intent only). */
  refined: string
  /** Short label for the header (<= ~8 words). */
  title: string
  /** Warm, on-brand reply used for non-debate intents. */
  reply: string
  /** Suggested debate prompts to nudge the user forward. */
  suggestions: string[]
}

const INTENTS: readonly TriageIntent[] = ['debate', 'smalltalk', 'meta', 'unclear']

const TRIAGE_SYSTEM = `You are the intake clerk of TRIBUNAL, a three-way analytical tribunal that examines a debatable question from opposing sides.

Read the user's message and classify it into exactly one intent:
- "debate": a genuine question, claim, decision, or topic worth arguing from multiple sides (even if phrased loosely or as a statement).
- "smalltalk": greetings, thanks, farewells, compliments, or casual chit-chat with no debatable issue ("hi", "how are you", "thanks!").
- "meta": the user is asking about TRIBUNAL itself — what it does, how to use it, its capabilities, who made it, or how the agents/judge work.
- "unclear": too vague, empty of a real issue, gibberish, a task you cannot debate (e.g. "write code", "do my homework"), or otherwise not a proposition.

Then respond:
- If intent is "debate": rewrite the topic into "refined" — a crisp, neutral, self-contained proposition that both sides could argue (fix grammar, resolve pronouns, keep the user's meaning; do NOT inject your own opinion or bias). Also produce "title": a short natural-language label of at most 8 words. Leave "reply" empty and you may leave "suggestions" empty.
- If intent is NOT "debate": leave "refined" and "title" empty, and write "reply" — a warm, concise message (2-4 sentences) in TRIBUNAL's calm, intelligent voice that responds to what they actually said and gently invites them to bring a real question to the tribunal. For "meta", briefly and accurately explain that TRIBUNAL runs three independent minds — an Advocate (the case for), a Critic (the case against), and an Auditor (fact- and logic-checking both) — and then a Judge who weighs everything into a verdict. Do not pretend to be human. Also give "suggestions": up to 3 debate prompts tailored to the conversation (or broadly interesting if there is nothing to tailor to).

Rules: never fabricate facts; keep every field concise; output only the requested JSON.`

const TRIAGE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    intent: { type: Type.STRING, enum: ['debate', 'smalltalk', 'meta', 'unclear'] },
    refined: { type: Type.STRING },
    title: { type: Type.STRING },
    reply: { type: Type.STRING },
    suggestions: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ['intent', 'refined', 'title', 'reply', 'suggestions'],
}

/** Trivial inputs recognised instantly, without spending a model call. */
const GREETINGS = new Set([
  'hi', 'hey', 'hello', 'yo', 'sup', 'hiya', 'hii', 'hiii', 'heya', 'howdy',
  'good morning', 'good afternoon', 'good evening', 'morning', 'evening',
])
const THANKS = new Set(['thanks', 'thank you', 'thx', 'ty', 'cheers', 'appreciate it', 'thankyou'])
const FILLER = new Set(['ok', 'okay', 'k', 'cool', 'nice', 'lol', 'lmao', 'test', 'testing', 'hmm', 'hm', '?', '...', 'asdf', 'aaa'])

function normalize(raw: string): string {
  return raw.toLowerCase().replace(/[.!¡?¿,]+$/g, '').replace(/\s+/g, ' ').trim()
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

const GREETING_REPLIES = [
  'Welcome to TRIBUNAL. Bring me a question worth arguing and I will convene the court: an Advocate for it, a Critic against it, an Auditor checking both, and a Judge to weigh it all. What should we put on trial?',
  'Hello. I do one thing well — I take a contested question and examine it from every side until the strongest position emerges. Give me a proposition and we will begin.',
]
const THANKS_REPLIES = [
  'Any time. Whenever you have another question worth pressure-testing, the tribunal is ready.',
  'Glad it helped. Bring me the next hard question whenever you are ready.',
]
const FILLER_REPLIES = [
  'I need a real question to convene the tribunal. Try something contested — a decision, a claim, or a "should we?" — and I will examine it from both sides.',
  'That did not give me much to argue. Offer a debatable proposition and the Advocate, Critic, Auditor, and Judge will get to work.',
]

/**
 * Instant, local classification for unambiguous trivial input. Returns null when
 * the message needs the model's judgement (the common case).
 */
function quickLocalTriage(raw: string): Triage | null {
  const text = normalize(raw)
  if (!text) return null
  // Only short, single-purpose messages qualify — anything longer goes to the model.
  if (text.length > 24) return null

  if (GREETINGS.has(text)) {
    return { intent: 'smalltalk', refined: '', title: '', reply: pick(GREETING_REPLIES), suggestions: [...DEFAULT_SUGGESTIONS] }
  }
  if (THANKS.has(text)) {
    return { intent: 'smalltalk', refined: '', title: '', reply: pick(THANKS_REPLIES), suggestions: [...DEFAULT_SUGGESTIONS] }
  }
  if (FILLER.has(text)) {
    return { intent: 'unclear', refined: '', title: '', reply: pick(FILLER_REPLIES), suggestions: [...DEFAULT_SUGGESTIONS] }
  }
  return null
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function strList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .map((s) => s.trim())
    .slice(0, max)
}

/** Coerces raw model output into a trustworthy Triage, filling safe fallbacks. */
export function sanitizeTriage(raw: unknown, original: string): Triage {
  const obj = (raw ?? {}) as Record<string, unknown>

  const intentRaw = typeof obj.intent === 'string' ? obj.intent.toLowerCase().trim() : ''
  const intent: TriageIntent = (INTENTS as readonly string[]).includes(intentRaw)
    ? (intentRaw as TriageIntent)
    : 'debate' // when unsure, honour the user's likely intent rather than refusing

  const refined = str(obj.refined)
  const title = str(obj.title)
  let reply = str(obj.reply)
  const suggestions = strList(obj.suggestions, 3)

  if (intent === 'debate') {
    return {
      intent,
      // Fall back to the user's own words if the model left refined empty.
      refined: refined || original.trim(),
      title: title || (refined ? refined.slice(0, 60) : original.trim().slice(0, 60)),
      reply: '',
      suggestions: suggestions.length ? suggestions : [],
    }
  }

  if (!reply) {
    reply = intent === 'meta'
      ? 'TRIBUNAL convenes three independent minds on a contested question — an Advocate builds the case for, a Critic builds the case against, and an Auditor fact- and logic-checks both. A Judge then weighs everything into a verdict with a confidence score. Give me a question and I will put it on trial.'
      : 'I need a debatable question to convene the tribunal. Offer a claim, a decision, or a "should we?" and I will examine it from every side.'
  }

  return {
    intent,
    refined: '',
    title: '',
    reply,
    suggestions: suggestions.length ? suggestions : [...DEFAULT_SUGGESTIONS],
  }
}

/**
 * Classifies and polishes the user's message. Cheap local short-circuit first,
 * then a single fast model call. Throws only on hard model failure (the caller
 * falls back to treating the input as a debate proposition).
 */
export async function triageInput(
  raw: string,
  ctx?: AiContext,
  abortSignal?: AbortSignal,
): Promise<Triage> {
  const local = quickLocalTriage(raw)
  if (local) return local

  const result = await generateJson<unknown>({
    role: 'triage',
    systemInstruction: TRIAGE_SYSTEM,
    prompt: `User message:\n"""${raw.trim()}"""\n\nClassify the intent and respond with the JSON described in your instructions.`,
    schema: TRIAGE_SCHEMA,
    temperature: TRIAGE_TEMPERATURE,
    maxOutputTokens: TRIAGE_MAX_OUTPUT_TOKENS,
    apiKey: ctx?.apiKey,
    abortSignal,
  })

  return sanitizeTriage(result, raw)
}
