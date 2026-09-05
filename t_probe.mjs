import fs from 'fs'

const line = fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).find(x => x.startsWith('GEMINI_API_KEY='))
const KEY = (line || '').split('=').slice(1).join('=').trim()

const candidates = ['gemini-3.6-flash', 'gemini-flash-latest', 'gemini-3.5-flash', 'gemini-2.5-flash']
for (const m of candidates) {
  const t0 = Date.now()
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(KEY)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply with the single word: OK' }] }] }),
    })
    const data = await res.json().catch(() => ({}))
    const text = (data?.candidates?.[0]?.content?.parts || []).map(p => p.text).join('') || ''
    const ms = Date.now() - t0
    if (res.status === 200) console.log(`OK   ${m}: HTTP 200 ${ms}ms text="${text.slice(0, 30).replace(/\s+/g, ' ')}"`)
    else console.log(`FAIL ${m}: HTTP ${res.status} ${ms}ms :: ${(data?.error?.message || '').slice(0, 90)}`)
  } catch (e) { console.log(`ERR  ${m}: ${e.message}`) }
}
