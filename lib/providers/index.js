import kie from './kie.js'
import wavespeed from './wavespeed.js'
import higgsfield from './higgsfield.js'

// ── Provider registry ────────────────────────────────────────────
//
// The only place that knows which adapters exist. Adding a provider means
// writing one file and adding one line here — nothing else in the app changes.
//
// HIGGSFIELD is a first-class provider here, but it bills differently from
// every other one: it spends the USER'S own credits via their OAuth token,
// which must be supplied per request as `auth`. We never store that token.
// Its browser implementation (src/utils/higgsfield*.js) is untouched and still
// drives all the original pages — this adapter exists so /studio can offer
// Higgsfield and kie.ai as equals.

const REGISTRY = { [kie.name]: kie, [higgsfield.name]: higgsfield, [wavespeed.name]: wavespeed }

export function getProvider(name) {
  const p = REGISTRY[name]
  if (!p) throw new Error(`Unknown provider "${name}". Registered: ${Object.keys(REGISTRY).join(', ')}`)
  return p
}

export function listProviders() {
  return Object.values(REGISTRY).map(p => ({ name: p.name, supports: p.supports, requiresUserAuth: !!p.requiresUserAuth }))
}
