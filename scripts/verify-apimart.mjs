#!/usr/bin/env node
// Verify the APIMart adapter against the live API.
//
// The adapter's endpoints are confirmed, but its REQUEST BODIES are not — the
// account had no balance when it was written, so no job could run. This script
// is the missing verification. Run it once the account has credit.
//
//   export APIMART_API_KEY=sk-...
//   node scripts/verify-apimart.mjs           # image only, cheapest
//   node scripts/verify-apimart.mjs --video   # include video (costs more)
//
// It reports exactly which field names the API accepted or rejected, so a
// wrong guess becomes a one-line fix in lib/providers/apimart.js rather than a
// silent wrong result later.

import provider from '../lib/providers/apimart.js'

if (!process.env.APIMART_API_KEY) {
  console.error('APIMART_API_KEY is not set.')
  process.exit(1)
}

const includeVideo = process.argv.includes('--video')

async function poll(taskId, label) {
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 8000))
    const s = await provider.getJob(taskId)
    process.stdout.write(`  [${(i + 1) * 8}s] ${s.state}\n`)
    if (s.state === 'succeeded') { console.log(`  ✓ ${label}:`, s.urls[0]); return true }
    if (s.state === 'failed') { console.log(`  ✗ ${label} failed:`, s.error); return false }
  }
  console.log(`  ? ${label} still running after 5 minutes`)
  return false
}

try {
  console.log('Image — model gpt-image-2, 1:1')
  const img = await provider.createImageJob({
    model: 'gpt-image-2', prompt: 'a plain grey square on a white background', aspectRatio: '1:1',
  })
  console.log('  task:', img)
  await poll(img, 'image')

  if (includeVideo) {
    console.log('\nVideo — model seedance-2.0, 480p, 4s')
    const vid = await provider.createVideoJob({
      model: 'seedance-2.0', prompt: 'a quiet empty street at dawn',
      resolution: '480p', duration: 4, aspectRatio: '9:16', generateAudio: false,
    })
    console.log('  task:', vid)
    await poll(vid, 'video')
  } else {
    console.log('\n(video skipped — pass --video to include it)')
  }
} catch (e) {
  console.error('\nFAILED:', e.message)
  console.error('\nIf this names a field, fix it in lib/providers/apimart.js and re-run.')
  process.exit(1)
}
