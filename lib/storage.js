import { put } from '@vercel/blob'

// ── Permanent storage ────────────────────────────────────────────
//
// kie.ai deletes every generated image and video after 24 hours. Without this,
// everything a user makes today is a dead link tomorrow — and because the app
// stores those URLs in the browser, the loss is silent: the influencer profile
// still lists a character sheet, it just renders as a broken image.
//
// So results are copied into our own bucket the moment a job succeeds, and the
// permanent URL is what reaches the client.
//
// Deliberately fail-soft: if the bucket is not configured or a copy fails, the
// original provider URL is returned instead. A picture that works for 24 hours
// beats no picture at all, and the alternative — failing a generation the user
// already paid for because of a storage problem — is worse than the problem.

// Vercel Blob authenticates two different ways, and checking only for the
// static token reports "storage off" on a store that is connected and working.
//
//   OIDC   — BLOB_STORE_ID + VERCEL_OIDC_TOKEN, injected automatically when a
//            store is linked to the project. This is the default on Vercel now,
//            uses short-lived rotating credentials, and takes precedence.
//   Static — BLOB_READ_WRITE_TOKEN, needed only for code running outside
//            Vercel (local dev, CI) or for browser upload tokens.
//
// Either credential is sufficient. BLOB_STORE_ID is deliberately NOT accepted:
// it is an identifier, not authentication. Treating it as proof of config made
// this report "storage on" while every copy silently failed — worse than
// reporting off, because it hid the problem instead of naming it.
const CONFIGURED = () => !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_OIDC_TOKEN)

function extensionFor(url, contentType = '') {
  if (contentType.includes('mp4') || /\.mp4/i.test(url)) return 'mp4'
  if (contentType.includes('webm') || /\.webm/i.test(url)) return 'webm'
  if (contentType.includes('png') || /\.png/i.test(url)) return 'png'
  if (contentType.includes('webp') || /\.webp/i.test(url)) return 'webp'
  return 'jpg'
}

/**
 * Copy one provider URL into permanent storage.
 * Returns the permanent URL, or the original if storage is unavailable.
 */
export async function persist(url, { prefix = 'generations' } = {}) {
  if (!url || !CONFIGURED()) return url
  // Already ours — copying again would duplicate on every status poll.
  if (url.includes('.public.blob.vercel-storage.com')) return url

  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`source returned ${res.status}`)

    const contentType = res.headers.get('content-type') || ''
    const blob = await res.blob()
    const name = `${prefix}/${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${extensionFor(url, contentType)}`

    const saved = await put(name, blob, {
      access: 'public',
      contentType: contentType || undefined,
      addRandomSuffix: false,
    })
    return saved.url
  } catch (e) {
    console.error('[storage] copy failed, using the temporary URL:', e.message)
    return url
  }
}

/** Copy several URLs, preserving order. Individual failures fall back. */
export async function persistAll(urls = [], opts) {
  if (!urls.length || !CONFIGURED()) return urls
  return Promise.all(urls.map(u => persist(u, opts)))
}

export function storageConfigured() { return CONFIGURED() }
