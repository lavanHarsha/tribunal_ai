import fs from 'fs'

const BASE = 'http://localhost:3000'
const line = fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).find(x => x.startsWith('GEMINI_API_KEY='))
const REAL_KEY = (line || '').split('=').slice(1).join('=').trim()

function summarize(ev) {
  switch (ev.type) {
    case 'triage_start': console.log('  - triage_start'); break
    case 'proposition_ready': console.log(`  - proposition_ready: title="${ev.title}" refined="${ev.refined.slice(0, 80)}"`); break
    case 'chat_reply': console.log(`  - chat_reply: "${ev.message.slice(0, 140)}" | suggestions=${(ev.suggestions || []).length}`); break
    case 'agent_start': console.log(`  - agent_start(${ev.agent})`); break
    case 'agent_complete': console.log(`  - agent_complete(${ev.agent})`); break
    case 'agent_error': console.log(`  - agent_error(${ev.agent}): ${ev.message}`); break
    case 'judge_start': console.log('  - judge_start'); break
    case 'judge_complete': {
      const v = ev.verdict
      console.log(`  - judge_complete: winner=${v.winner} conf=${v.confidence} summaryLen=${(v.summary || '').length} keyPoints=${(v.keyPoints || []).length} concerns=${(v.factualConcerns || []).length}`)
      console.log(`      headline : ${v.verdict}`)
      console.log(`      summary  : ${(v.summary || '').slice(0, 200)}`)
      ;(v.keyPoints || []).slice(0, 2).forEach((p, i) => console.log(`      point[${i}] : ${p.slice(0, 140)}`))
      break
    }
    case 'judge_error': console.log(`  - judge_error: ${ev.message}`); break
    case 'error': console.log(`  - error: ${ev.message}`); break
    case 'done': console.log('  - done'); break
  }
}

async function stream(path, body, headers, label) {
  const t0 = Date.now()
  let res
  try {
    res = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
  } catch (e) {
    console.log(`\n=== ${label} === FETCH FAILED: ${e.message}`); return
  }
  console.log(`\n=== ${label} :: ${path} -> HTTP ${res.status} ===`)
  if (!res.ok) { console.log('  body:', (await res.text()).slice(0, 200)); console.log(`  total: ${Date.now() - t0}ms`); return }
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''; let first = null; let chunks = 0
  for (;;) {
    const { value, done } = await reader.read(); if (done) break
    if (first === null) first = Date.now() - t0
    buf += dec.decode(value, { stream: true })
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1); if (!l) continue
      try { const ev = JSON.parse(l); if (ev.type === 'agent_chunk') { chunks++; continue } summarize(ev) } catch { }
    }
  }
  console.log(`  firstByte=${first}ms total=${Date.now() - t0}ms chunks=${chunks}`)
}

console.log('REAL_KEY present:', REAL_KEY.length > 0, '(len ' + REAL_KEY.length + ')')

await stream('/api/debate', { proposition: 'hi' }, {}, 'T1 SMALLTALK "hi" (local short-circuit)')
await stream('/api/debate', { proposition: 'what can you do?' }, {}, 'T2 META "what can you do?" (model triage)')
await stream('/api/debate', { proposition: 'Is remote work actually better for society?' }, { 'x-gemini-api-key': 'AIzaSyB-invalid-0000000000000000000000' }, 'T4 BYOK BAD KEY (should be rejected, not fall back)')
await stream('/api/debate', { proposition: 'Should cities prioritize rewilding over new housing?' }, {}, 'T3 FULL DEBATE (server key)')
