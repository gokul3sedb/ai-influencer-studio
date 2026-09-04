// ── Aspect ratio compatibility ───────────────────────────────────
//
// THE BUG THIS FIXES:
//
// The app asks for 4:5 on close-ups — a perfectly normal portrait ratio that
// Higgsfield accepts. GPT Image 2 on kie.ai REJECTS it, with a 500 that reads
// like a server error rather than "you sent a bad value".
//
// That 500 looked transient, so routing failed over to the next candidate —
// Nano Banana, which DOES accept 4:5. The request then succeeded, silently, on
// a different model that treats reference images differently. The user got a
// photo of a stranger and no error at all.
//
// Two lessons are encoded here and in routing's failover rules:
//   1. Providers disagree about which ratios exist. Translate, don't assume.
//   2. A rejected parameter must never trigger failover. It is deterministic,
//      it will fail identically next time, and quietly switching models turns
//      a clear error into a wrong result — far harder to notice or debug.
//
// Verified against the live API on 2026-09-04.

const SUPPORTED = {
  'gpt-image-2': ['1:1', '3:2', '2:3', '3:4', '4:3', '16:9', '9:16', '21:9'],
  // Nano Banana accepts everything above plus 4:5 and 5:4.
  'nano-banana':  ['1:1', '3:2', '2:3', '3:4', '4:3', '16:9', '9:16', '21:9', '4:5', '5:4'],
  seedance:       ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9', 'adaptive'],
}

function familyOf(model = '') {
  if (model.startsWith('gpt-image')) return 'gpt-image-2'
  if (model.startsWith('nano-banana')) return 'nano-banana'
  if (model.includes('seedance')) return 'seedance'
  return null
}

function toNumber(ratio) {
  const [w, h] = String(ratio).split(':').map(Number)
  return (w > 0 && h > 0) ? w / h : null
}

/**
 * Return the closest ratio the model actually accepts.
 *
 * Substituting the nearest neighbour is deliberate: 4:5 becomes 3:4, which is
 * a barely perceptible crop difference on a headshot. Failing the request
 * instead would block a routine action over a formatting detail, and silently
 * switching models — the old behaviour — changed who was in the picture.
 */
export function normalizeAspect(model, requested) {
  const family = familyOf(model)
  if (!family) return requested

  const allowed = SUPPORTED[family]
  if (!requested || allowed.includes(requested)) return requested

  const target = toNumber(requested)
  if (target === null) return allowed[0]

  let best = allowed[0]
  let bestGap = Infinity
  for (const candidate of allowed) {
    const value = toNumber(candidate)
    if (value === null) continue
    const gap = Math.abs(Math.log(value / target))   // log space: 2:1 and 1:2 are equally far
    if (gap < bestGap) { bestGap = gap; best = candidate }
  }

  console.warn(`[aspect] ${model} does not accept ${requested} — using ${best}`)
  return best
}

/** True when a provider error is a rejected parameter rather than a real outage. */
export function isParameterRejection(message = '') {
  return /not within the range of allowed options|invalid (?:value|parameter)|is not supported/i.test(message)
}
