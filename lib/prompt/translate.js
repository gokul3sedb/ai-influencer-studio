// ── Cross-provider prompt translation ────────────────────────────
//
// THE BUG THIS FIXES, because it is not obvious:
//
// Every prompt in this app is written in Higgsfield's dialect. Higgsfield lets
// a prompt ADDRESS its attached images by name — `@image1`, `@image2` — and
// then assign each one a distinct job:
//
//   "@image1 is a facial geometry reference — match the face proportions but
//    defer to the text for skin tone. Ignore @image1's clothing and background.
//    @image2 is a visual style reference — do NOT copy the face of any person
//    in @image2, match only the outfit and lighting."
//
// That addressing is a Higgsfield feature. To every other model on earth,
// "@image1" is meaningless text. GPT Image 2 receives a flat `input_urls`
// array with no way to say which image is the face and which is the outfit —
// so those careful per-image instructions become noise, the model falls back
// to a generic edit, and the character's identity drifts into a stranger.
//
// Photo Studio fails harder still: its prompts are deliberately terse
// ("placement + action only. Do not re-describe the refs") because they assume
// the @image tokens carry the identity. Strip the addressing and almost nothing
// is left to generate from.
//
// So the fix is not more references — it is translating the addressing into
// plain language the model does understand, plus an explicit identity anchor
// that Higgsfield got for free from its role system.

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth']

// Matches @image1, @image_1, @image 1 — every spelling used across the codebase.
const TOKEN = /@image[\s_]?(\d+)/gi

/** Replace Higgsfield's @imageN addressing with plain positional language. */
export function detokenize(prompt) {
  if (typeof prompt !== 'string') return prompt
  return prompt.replace(TOKEN, (_, n) => {
    const idx = Number(n) - 1
    const ordinal = ORDINALS[idx] || `image ${n}`
    return `the ${ordinal} reference image`
  })
}

// Higgsfield's `role: 'image'` media slots imply "this is the person" without
// the prompt having to argue for it. Models taking a flat array need telling,
// and telling them firmly — this is the single line that keeps a character
// recognisably themselves across a whole feed.
const IDENTITY_ANCHOR =
  'IDENTITY LOCK: the first reference image defines the person. Reproduce that ' +
  'exact face — same bone structure, same eye shape and colour, same nose, same ' +
  'jawline, same hairline, same skin tone, same apparent age and gender. This is ' +
  'the same individual in a new photograph, not a similar-looking person. Do not ' +
  'restyle, idealise, beautify or alter the face in any way.'

/**
 * Prepare a prompt written for Higgsfield to run on a flat-reference model.
 *
 * `refCount` matters: with no references there is no identity to anchor and the
 * anchor would invent a constraint the model cannot satisfy.
 */
export function forFlatReferenceModel(prompt, refCount = 0) {
  const translated = detokenize(prompt)
  if (!refCount) return translated
  return `${IDENTITY_ANCHOR}\n\n${translated}`
}

export function translatePrompts(prompts, { provider, refCount = 0 }) {
  // Higgsfield understands its own dialect — leave it completely alone.
  if (provider === 'higgsfield') return prompts
  return prompts.map(p => forFlatReferenceModel(p, refCount))
}
