import fs from 'fs'

const line = fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).find(x => x.startsWith('GEMINI_API_KEY='))
const KEY = (line || '').split('=').slice(1).join('=').trim()

async function tryBase(base) {
  const url = `${base}/models?key=${encodeURIComponent(KEY)}&pageSize=300`
  const res = await fetch(url)
  const data = await res.json().catch(() => ({}))
  console.log(`\n[${base}] HTTP ${res.status}`)
  if (Array.isArray(data.models)) {
    const gem = data.models.map(m => m.name).filter(n => /gemini/i.test(n))
    console.log(`  ${gem.length} gemini models:`)
    gem.forEach(n => console.log('   ', n))
    if (!gem.length) console.log('  (none) raw sample:', JSON.stringify(data.models.slice(0, 5)).slice(0, 400))
  } else {
    console.log('  body:', JSON.stringify(data).slice(0, 400))
  }
}

await tryBase('https://generativelanguage.googleapis.com/v1beta')
