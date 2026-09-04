import { rateLimit, clientIp } from '../lib/rateLimit.js'
import { checkAccess } from '../lib/auth.js'
import { getProvider } from '../lib/providers/index.js'

// POST /api/upload  { dataUrl, type? }  ->  { url }
//
// Reference images live in the browser as data URLs. Providers want hosted
// URLs. This uploads ONE file and returns its public URL.
//
// One file per request on purpose: Vercel caps serverless request bodies at
// ~4.5MB, and batching four reference images would blow past that. The client
// uploads each ref once and caches the returned URL (see the existing
// hf_media_cache pattern) so repeat generations re-use the same upload.
//
// Uploaded files expire after 24 hours on kie.ai — cached URLs must be
// treated as short-lived, not permanent.

export const config = { api: { bodyParser: { sizeLimit: '5mb' } } }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-token')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const auth = checkAccess(req.headers)
  if (!auth.ok) return res.status(auth.status).json({ error: auth.message })

  const rl = rateLimit(clientIp(req.headers))
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfter))
    return res.status(429).json({ error: 'Too many requests — slow down a moment and try again.' })
  }

  const { dataUrl, type = 'image', provider = 'kie' } = req.body || {}
  if (!dataUrl) return res.status(400).json({ error: 'Missing dataUrl' })

  try {
    const url = await getProvider(provider).uploadMedia(dataUrl, { type })
    return res.status(200).json({ url })
  } catch (e) {
    console.error('[upload]', e.message)
    return res.status(502).json({ error: e.message })
  }
}
