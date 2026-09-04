import { buildDirectPrompt, buildThreeVariationPrompts } from './systemPrompt.js'
import { buildInfluencerSheetPrompt } from './charSheetPrompt.js'
import { JOB } from '../routing.js'

// ── Server-side prompt engine ────────────────────────────────────
//
// THIS IS THE ASSET. The 119-entry wardrobe library, the 100 profession
// archetypes, the scene pools and the scoring logic all live in
// ./systemPrompt.js — and from here on they only ever execute on the server.
//
// The browser sends { jobType, character, options } and receives image URLs.
// It never sees the assembled prompt, so opening devtools or watching the
// network tab reveals nothing about how the output was produced.
//
// NOTE: src/utils/systemPrompt.js is still present and still used by the
// existing client-side pages. That copy is now DEPRECATED — deleting it is
// the final step of the frontend migration, and until it's gone the library
// is still readable in the browser bundle. Nothing else depends on it.
//
// Only the pure builders are used here. buildCharSheetPromptWithClaude() in
// charSheetPrompt.js calls a browser-relative '/api/claude' and is not
// server-callable; it stays untouched for the client path.

/**
 * Build the prompt(s) for one generation request.
 * Returns an array — image jobs may want several distinct prompts so each
 * output varies (different scene, pose, outfit) while identity stays locked.
 *
 * @returns {string[]}
 */
export function buildPrompts(jobType, character, options = {}) {
  const {
    count = 1,
    aspectRatio = '9:16',
    sceneIntent = null,     // optional free-text steer, e.g. "walking to the gym"
    backstoryLocked = false,
    forceOutdoor = false,
    model = 'gpt_image_2',
  } = options

  const c = normalizeCharacter(character)

  switch (jobType) {
    case JOB.CHARACTER_SHEET:
      // One canonical turnaround. Never randomised — this image is the
      // reference every later generation is conditioned on.
      return [buildInfluencerSheetPrompt(c)]

    case JOB.SCENE_PHOTO:
    case JOB.FAST_ITERATION: {
      // Three-at-a-time gets the purpose-built variation builder, which
      // guarantees three DIFFERENT poses rather than three independent rolls
      // that might collide.
      if (count === 3) return buildThreeVariationPrompts(c, aspectRatio, model)

      return Array.from({ length: count }, () =>
        withSceneIntent(
          buildDirectPrompt(c, null, { backstoryLocked, forceOutdoor, model }, aspectRatio),
          sceneIntent,
        )
      )
    }

    case JOB.VIDEO:
      return [buildVideoPrompt(c, options)]

    default:
      throw new Error(`No prompt builder for job type "${jobType}"`)
  }
}

// The wizard and the stored influencer record use slightly different field
// names for the same things. Normalising here means the prompt builders only
// ever see one shape.
function normalizeCharacter(character = {}) {
  const niches = character.niches
    ?? (character.niche ? String(character.niche).split(',').map(s => s.trim()).filter(Boolean) : [])

  return {
    ...character,
    gender: (character.gender || 'woman').toLowerCase() === 'female' ? 'woman' : (character.gender || 'woman'),
    personality: character.personality ?? character.introExtrovert ?? 50,
    vibeWords: character.vibeWords ?? character.contentPillars ?? [],
    niches,
  }
}

// A caller-supplied steer is appended rather than substituted — the scene the
// engine chose still carries all the lighting, wardrobe and skin logic, and
// we only nudge the subject matter.
function withSceneIntent(prompt, sceneIntent) {
  if (!sceneIntent?.trim()) return prompt
  return `${prompt}\n\nAdditional direction: ${sceneIntent.trim()}`
}

// Video prompting is intentionally minimal for now. The richer video logic
// (motion presets, delivery lines, lip-sync wiring) still lives in
// src/pages/Influencers.jsx and should move here during the frontend
// migration — porting it blind would risk changing output quality.
function buildVideoPrompt(c, { sceneIntent = null, motion = null } = {}) {
  const subject = c.physicalDesc?.trim() || `${c.gender}, natural features`
  const action = sceneIntent?.trim() || 'moving naturally through the scene, relaxed and unposed'
  const camera = motion?.trim() || 'Handheld phone camera, subtle natural shake, no professional stabilisation.'

  return [
    `Candid vertical phone video of @image1 — ${subject}.`,
    `Action: ${action}.`,
    camera,
    'Natural found lighting, real location, unedited phone footage.',
    'Consistent identity across every frame — same face, same build, same outfit throughout.',
    'No text overlays, no UI elements, no watermarks, no visible brand logos.',
  ].join(' ')
}
