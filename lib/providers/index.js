import kie from './kie.js'
import wavespeed from './wavespeed.js'

// ── Provider registry ────────────────────────────────────────────
//
// The only place that knows which adapters exist. Adding a provider means
// writing one file and adding one line here — nothing else in the app changes.
//
// NOTE ON HIGGSFIELD: it is deliberately absent. The existing Higgsfield path
// runs entirely in the browser over per-user OAuth (src/utils/higgsfieldAuth.js
// + higgsfieldGenerate.js) and still works untouched. Porting it server-side
// means re-implementing the MCP session, SSE parsing and token refresh — real
// risk for no gain, since kie.ai reaches the same underlying models (GPT Image,
// Nano Banana, Seedance) more cheaply. Only `soul_2` is Higgsfield-exclusive.

const REGISTRY = { [kie.name]: kie, [wavespeed.name]: wavespeed }

export function getProvider(name) {
  const p = REGISTRY[name]
  if (!p) throw new Error(`Unknown provider "${name}". Registered: ${Object.keys(REGISTRY).join(', ')}`)
  return p
}

export function listProviders() {
  return Object.values(REGISTRY).map(p => ({ name: p.name, supports: p.supports }))
}
