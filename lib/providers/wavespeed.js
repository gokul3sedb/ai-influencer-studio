import { ProviderError } from './contract.js'

// ── WaveSpeed adapter — SCAFFOLD, NOT YET WIRED ──────────────────
//
// Deliberately left unimplemented rather than guessed at. WaveSpeed's request
// and response shapes have not been verified against a real account, and an
// adapter that *looks* real but posts to invented endpoints is worse than one
// that says plainly that it isn't ready.
//
// To finish it:
//   1. Confirm base URL, auth header, and the submit/poll endpoints at
//      https://wavespeed.ai/docs  (model pages carry per-model params)
//   2. Fill the four functions below, mapping WaveSpeed's own status strings
//      onto STATE.* from contract.js
//   3. Register it in ./index.js and add candidates to ../routing.js
//
// Pricing reference gathered 2026-09: Seedance 2.0 at $0.60 per 5s @480p,
// with 720p ≈ 2x, 1080p ≈ 5x, 4K ≈ 10x, scaling linearly with duration.
// Useful as a quality/price check against kie.ai rather than as the primary.

const NAME = 'wavespeed'

const notWired = () => {
  throw new ProviderError(NAME, 'WaveSpeed adapter is not implemented yet — see lib/providers/wavespeed.js')
}

export default {
  name: NAME,
  supports: { image: false, video: false, upload: false },
  uploadMedia: notWired,
  createImageJob: notWired,
  createVideoJob: notWired,
  getJob: notWired,
}
