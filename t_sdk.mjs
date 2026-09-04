import { readFileSync } from 'node:fs'
import { GoogleGenAI } from '@google/genai'

// Load .env.local without needing dotenv
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY })
const model = env.GEMINI_MODEL || 'gemini-3.6-flash'
console.log('MODEL UNDER TEST:', model)

function dump(label, e) {
  console.log('\n--- ' + label + ' FAILED ---')
  console.log('name:  ', e?.name)
  console.log('status:', e?.status)
  console.log('msg:   ', e?.message?.slice(0, 500))
  const body = e?.error ?? e?.response ?? e?.details ?? null
  if (body) console.log('body:  ', JSON.stringify(body).slice(0, 700))
}

// A) bare call - no config at all
try {
  const r = await ai.models.generateContent({ model, contents: 'Say hi' })
  console.log('\nA) BARE -> OK:', JSON.stringify(r.text?.slice(0, 120)))
} catch (e) { dump('A) BARE', e) }

// B) with the exact config our agents send
try {
  const r = await ai.models.generateContent({
    model,
    contents: 'Say hi',
    config: { temperature: 0.85, maxOutputTokens: 1800, systemInstruction: 'You are a helpful debater.' },
  })
  console.log('\nB) AGENT-CONFIG -> OK:', JSON.stringify(r.text?.slice(0, 120)))
} catch (e) { dump('B) AGENT-CONFIG', e) }

// C) streaming call - what the app actually uses
try {
  const stream = await ai.models.generateContentStream({
    model,
    contents: 'Say hi',
    config: { temperature: 0.85, maxOutputTokens: 1800 },
  })
  let out = ''
  for await (const chunk of stream) out += chunk.text ?? ''
  console.log('\nC) STREAM -> OK:', JSON.stringify(out.slice(0, 120)))
} catch (e) { dump('C) STREAM', e) }

// D) structured JSON output - what the Judge uses
try {
  const r = await ai.models.generateContent({
    model,
    contents: 'Pick winner: red or blue. Reply JSON.',
    config: {
      temperature: 0.4,
      maxOutputTokens: 2000,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: { winner: { type: 'STRING' } },
        required: ['winner'],
      },
    },
  })
  console.log('\nD) JSON-SCHEMA -> OK:', JSON.stringify(r.text?.slice(0, 120)))
} catch (e) { dump('D) JSON-SCHEMA', e) }
