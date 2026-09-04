#!/usr/bin/env node
// Verify every model slug in lib/routing.js against the live kie.ai API.
//
// WHY THIS EXISTS: the video slugs are confirmed from kie.ai's docs, but the
// image slugs follow their documented naming pattern and were NOT verified
// against a real account. A wrong slug fails at runtime, mid-demo. This turns
// that into a 30-second check.
//
//   node scripts/verify-models.mjs            # image models only
//   node scripts/verify-models.mjs --video    # include video (costs more)
//
// ⚠ COSTS REAL MONEY. A valid slug creates a real task and is billed —
// roughly $0.03-0.05 per image model, materially more per video. Invalid
// slugs are rejected before any work happens and cost nothing.

import { allModels } from '../lib/routing.js'

const API_BASE = 'https://api.kie.ai/api/v1'
const key = process.env.KIE_API_KEY
const includeVideo = process.argv.includes('--video')

if (!key) {
  console.error('KIE_API_KEY is not set. Export it first:\n  export KIE_API_KEY=...')
  process.exit(1)
}

const seen = new Set()
const targets = allModels().filter(m => {
  if (m.provider !== 'kie') return false
  if (m.kind === 'video' && !includeVideo) return false
  if (seen.has(m.model)) return false
  seen.add(m.model)
  return true
})

console.log(`Checking ${targets.length} model slug(s) against kie.ai${includeVideo ? ' (including video)' : ' (images only — pass --video for the rest)'}\n`)

let ok = 0, bad = 0

for (const t of targets) {
  const input = t.kind === 'video'
    ? { prompt: 'A calm wide shot of an empty street at dawn.', resolution: '480p', duration: 4, generate_audio: false }
    : { prompt: 'A plain grey square on a white background.', aspect_ratio: '1:1' }

  try {
    const res = await fetch(`${API_BASE}/jobs/createTask`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: t.model, input }),
    })
    const body = await res.json().catch(() => ({}))

    if (res.ok && body?.code === 200 && (body?.data?.taskId || body?.data?.task_id)) {
      console.log(`  ✓ ${t.model}   (${t.jobType}) — task ${body.data.taskId || body.data.task_id}`)
      ok++
    } else {
      console.log(`  ✗ ${t.model}   (${t.jobType}) — code ${body?.code ?? res.status}: ${body?.msg || 'rejected'}`)
      bad++
    }
  } catch (e) {
    console.log(`  ✗ ${t.model}   (${t.jobType}) — network error: ${e.message}`)
    bad++
  }
}

console.log(`\n${ok} valid, ${bad} rejected.`)
if (bad) {
  console.log('\nFix the rejected slugs in lib/routing.js. Browse the exact names at https://docs.kie.ai/market/quickstart')
  process.exit(1)
}
