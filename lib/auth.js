// ── Access gate ──────────────────────────────────────────────────
//
// CRITICAL. Moving provider keys server-side means WE now pay for every
// generation, where previously each user spent their own Higgsfield credits.
// An ungated /api/generate is an open tap on our billing account.
//
// This is a shared secret, not real auth — it stops drive-by abuse, not a
// determined attacker, and every user shares one token so it cannot attribute
// or meter usage. Replace it with per-user accounts before any public launch.
// Until then, treat the token as a production credential.

export function checkAccess(headers) {
  const expected = process.env.APP_ACCESS_TOKEN

  if (!expected) {
    // Unset in production is a misconfiguration, and failing open would mean
    // silently exposing the billing account. Fail closed instead.
    if (process.env.NODE_ENV === 'production') {
      return { ok: false, status: 500, message: 'Server misconfigured: APP_ACCESS_TOKEN is not set' }
    }
    console.warn('[auth] APP_ACCESS_TOKEN unset — allowing request (development only)')
    return { ok: true }
  }

  const get = name => (typeof headers?.get === 'function' ? headers.get(name) : headers?.[name]) || ''
  const provided = get('x-app-token') || get('authorization').replace(/^Bearer\s+/i, '')

  if (!provided || !timingSafeEqual(provided, expected)) {
    return { ok: false, status: 401, message: 'Unauthorized' }
  }
  return { ok: true }
}

// Constant-time compare so response latency doesn't leak the token.
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
