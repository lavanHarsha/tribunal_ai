import { readFileSync } from 'node:fs'
import { GoogleGenAI } from '@google/genai'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY })
const model = env.GEMINI_MODEL || 'gemini-3.6-flash'

const sys = 'You are a rigorous debater. Write a ~260 word Markdown argument with a single "## " heading.'
const prompt = 'Proposition: """Is coffee better than tea?"""'

async function run(label, extra) {
  const t0 = Date.now()
  try {
    const stream = await ai.models.generateContentStream({
      model,
      contents: prompt,
      config: { systemInstruction: sys, temperature: 0.85, maxOutputTokens: 1800, ...extra },
    })
    let out = ''
    for await (const c of stream) out += c.text ?? ''
    console.log(`${label.padEnd(28)} OK    ${((Date.now() - t0) / 1000).toFixed(1)}s  ${out.length} chars`)
  } catch (e) {
    console.log(`${label.padEnd(28)} FAIL  ${((Date.now() - t0) / 1000).toFixed(1)}s  status=${e?.status} ${String(e?.message).slice(0, 160)}`)
  }
}

console.log('MODEL:', model)
await run('default (no thinking cfg)', {})
await run('thinkingLevel=MINIMAL', { thinkingConfig: { thinkingLevel: 'MINIMAL' } })
await run('thinkingLevel=LOW', { thinkingConfig: { thinkingLevel: 'LOW' } })
await run('thinkingBudget=0', { thinkingConfig: { thinkingBudget: 0 } })
