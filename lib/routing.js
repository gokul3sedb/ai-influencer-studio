// ── Model routing ────────────────────────────────────────────────
//
// Job type -> ordered list of candidates. The first is tried; a retryable
// failure falls through to the next. This is the single file to edit when
// prices move or a better model ships — nothing else references a model name.
//
// Deliberately NOT exposed to the browser. Customers buy finished creative;
// model names mean nothing to them and inviting the question costs support time.
//
// ── VERIFIED against the live API 2026-09-04 ─────────────────────
// Every slug below was confirmed by creating a real task. Measured cost per
// image at default params, on our own account:
//
//     gpt-image-2-image-to-image      6 credits
//     gpt-image-2-text-to-image       6 credits
//     nano-banana-2                   8 credits
//     nano-banana-pro                18 credits
//
// Note the ordering that implies: GPT Image 2 is the CHEAPEST of the three,
// not the premium tier. Nano Banana Pro costs 3x for a fallback we rarely
// want, so it sits last everywhere.
//
// Slugs are FLAT — no vendor prefix. "google/nano-banana-pro" is rejected;
// "nano-banana-pro" is correct. Video is the exception and does carry the
// "bytedance/" prefix.
//
// Re-check any time with:  node scripts/verify-models.mjs
// ─────────────────────────────────────────────────────────────────

export const JOB = {
  CHARACTER_SHEET: 'character_sheet',
  SCENE_PHOTO:     'scene_photo',
  FAST_ITERATION:  'fast_iteration',
  VIDEO:           'video',
}

// Image models come in text-to-image and image-to-image variants and the wrong
// one fails at runtime. Rather than hardcode a guess per job type, each
// candidate names both and the dispatcher picks based on whether the request
// actually carries reference images.
const GPT_IMAGE_2 = {
  provider: 'kie',
  kind: 'image',
  models: { withRefs: 'gpt-image-2-image-to-image', withoutRefs: 'gpt-image-2-text-to-image' },
}

const NANO_BANANA_2   = { provider: 'kie', kind: 'image', models: { withRefs: 'nano-banana-2',   withoutRefs: 'nano-banana-2' } }
const NANO_BANANA_PRO = { provider: 'kie', kind: 'image', models: { withRefs: 'nano-banana-pro', withoutRefs: 'nano-banana-pro' } }

export const ROUTES = {
  // Four-panel turnaround. Identity fidelity matters most — every later
  // generation is conditioned on this image.
  [JOB.CHARACTER_SHEET]: [
    { ...GPT_IMAGE_2,      params: { quality: 'high' } },
    { ...NANO_BANANA_PRO,  params: { resolution: '2K' } },
  ],

  // The workhorse: a new scene for an existing character.
  [JOB.SCENE_PHOTO]: [
    { ...GPT_IMAGE_2,     params: { quality: 'high' } },
    { ...NANO_BANANA_2,   params: { resolution: '2K' } },
  ],

  // Draft passes. Same model as above — it's already the cheapest — but at
  // lower resolution and quality.
  [JOB.FAST_ITERATION]: [
    { ...GPT_IMAGE_2,     params: { quality: 'medium' } },
    { ...NANO_BANANA_2,   params: { resolution: '1K' } },
  ],

  // 720p by default. Seedance pricing roughly doubles 480p->720p and is ~5x at
  // 1080p, while 9:16 mobile feed placements rarely justify 1080p. Resolution
  // moves cost far more than provider choice does.
  [JOB.VIDEO]: [
    { provider: 'kie', kind: 'video', models: { withRefs: 'bytedance/seedance-2',      withoutRefs: 'bytedance/seedance-2' },      params: { resolution: '720p', generateAudio: false } },
    { provider: 'kie', kind: 'video', models: { withRefs: 'bytedance/seedance-2-fast', withoutRefs: 'bytedance/seedance-2-fast' }, params: { resolution: '720p', generateAudio: false } },
  ],
}

/** Resolve the right model slug for a candidate given whether refs are present. */
export function modelFor(candidate, hasRefs) {
  return hasRefs ? candidate.models.withRefs : candidate.models.withoutRefs
}

export function candidatesFor(jobType) {
  const list = ROUTES[jobType]
  if (!list?.length) {
    throw new Error(`No route configured for job type "${jobType}". Known: ${Object.keys(ROUTES).join(', ')}`)
  }
  return list
}

/** Every distinct slug in the table — used by scripts/verify-models.mjs. */
export function allModels() {
  const out = []
  for (const [jobType, list] of Object.entries(ROUTES)) {
    for (const c of list) {
      for (const model of new Set(Object.values(c.models))) {
        out.push({ jobType, provider: c.provider, kind: c.kind, model })
      }
    }
  }
  return out
}
