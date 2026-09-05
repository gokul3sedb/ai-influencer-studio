// ── Profile sheet prompts (server-side) ──────────────────────────
//
// Lifted verbatim from src/pages/Influencers.jsx so the wording cannot drift
// between the two copies. These now run only here — the browser sends a job
// type and the character record, never the text.
//
// Each targets a different job:
//   character sheet — four-view turnaround, the outfit/body reference
//   close-up        — identity-card headshot, the face reference
//   feature sheet   — macro grid of eye/brow/lip/skin/hair/hands, the detail reference

export function buildFeatureSheetPrompt(inf) {
  const phys = inf.physicalDesc ? `The subject: ${inf.physicalDesc}. ` : ''
  return `Beauty model feature reference sheet. ${phys}Pure white background throughout. Clinical reference card layout — like a casting or makeup artist reference sheet printed on white paper. Bold black uppercase sans-serif labels above each panel. Clear white gutters between every panel and white margins around the outside.

Layout — 4 rows stacked top to bottom:
Row 1 (full width): one wide panel labelled "EYE" — extreme macro close-up centered tightly on both irises. The irises fill the majority of the frame. Shows exact iris color, pattern, and detail. Lashes visible at edges but irises are the dominant subject.
Row 2 (full width): one wide panel labelled "BROW" — close-up from hairline to mid-nose showing exact brow shape, arch, thickness, hair direction, forehead skin.
Row 3 (two equal side-by-side panels):
  Left — labelled "LIP": close-up from nose base to chin showing exact lip shape, cupid's bow, natural lip color.
  Right — labelled "SKIN TEXTURE": macro close-up of cheek skin showing pores, freckles, natural skin detail, zero retouching.
Row 4 (two equal side-by-side panels):
  Left — labelled "HAIR TEXTURE": close-up of hair strands showing exact color, shine, texture, wave or curl pattern.
  Right — labelled "HANDS": close-up of hand showing nail shape, length, nail color or nail art, knuckle skin detail.

Replicate the reference person's exact features in every panel: precise skin tone, freckle placement, hair color, lip shape, brow arch. Zero beauty retouching — raw photographic detail. White space clearly visible between all panels.

Photorealistic RAW photograph quality, ultra-sharp macro detail in each panel. Shot on Hasselblad 100mm macro lens.`
}

export function buildCloseUpPrompt(inf) {
  const phys = inf.physicalDesc ? `The subject: ${inf.physicalDesc}. ` : ''
  return `Professional studio headshot. Subject facing directly forward, eyes looking straight into the camera lens. Framed from shoulders up — head, neck, and upper chest visible. Clean seamless pure white backdrop, soft gradient toward very light grey at edges, no texture, no cast shadows on background.

${phys}Soft diffused studio lighting: two large softboxes at 45-degree angles producing soft, even, shadow-free illumination across the face. Subtle catchlights visible in both eyes. No harsh under-nose or chin shadows. Skin tone reproduced accurately — natural pore texture, subtle imperfections visible, zero retouching.

Replicate every physical detail from the reference image exactly: facial bone structure, unique facial features and natural asymmetries, precise skin tone, freckles, moles, iris color and detail, eyebrow shape, lip shape, hair color, texture and natural fall. The subject must be unmistakably the same individual.

Subject standing straight, head completely level, facing dead-on into the camera — no tilt, no turn, no pose. Eyes looking directly into the lens. Neutral expression, mouth relaxed and closed. No modelling, no attitude, no special pose whatsoever. Identical to a casting reference or identity card photo.

Shot on Phase One IQ4 150MP, 85mm portrait lens, f/2.8, studio strobe. Photorealistic, ultra-sharp facial detail, RAW photograph quality. Studio identity reference portrait.`
}

export function buildCharacterSheetPrompt(inf) {
  const phys = inf.physicalDesc ? `The character: ${inf.physicalDesc}. ` : ''
  const style = inf.clothingStyle ? `Outfit: ${inf.clothingStyle}. ` : ''
  return `Professional full-body character turnaround sheet. Pure white background, no background elements whatsoever. Soft neutral studio lighting, perfectly flat and even across all four panels — no shadows, no color cast, no vignette.

${phys}${style}

Single row of four equally sized full-body shots from head to toe, each with a small label in clean sans-serif capitals printed above the figure:
Panel 1 — "FRONT VIEW": character facing directly forward, arms relaxed at sides, feet together.
Panel 2 — "SIDE VIEW": character in perfect left profile, arms at sides.
Panel 3 — "BACK VIEW": character facing directly away, arms relaxed.
Panel 4 — "THREE-QUARTER VIEW": character at 45-degree angle facing forward-right.

Replicate every single physical detail identically across all four panels: exact facial structure and bone structure, unique facial features and natural asymmetries, precise skin tone, real pore texture, natural blemishes, freckles, moles, birthmarks, natural moisture and skin sheen, realistic catchlights in the eyes, exact iris color and detail, exact hair color and texture and styling. Zero beauty retouching — raw skin imperfections must be visible. Same outfit, same proportions, same scale in every panel.

Shot on Hasselblad X2D 100C, photorealistic, ultra-sharp micro detail, RAW photograph quality. Character design sheet, model sheet, orthographic turnaround reference.`
}
