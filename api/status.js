import { rateLimit, clientIp } from '../lib/rateLimit.js'
import { checkAccess } from '../lib/auth.js'
import { getProvider } from '../lib/providers/index.js'
import { decodeHandle } from '../lib/jobs.js'
import { STATE } from '../lib/providers/contract.js'

// GET /api/status?handles=kie:abc,kie:def
//   -> { jobs: [{ handle, state, urls, progress, error }], done: bool }
//
// The client polls this. One request covers every handle from a generation so
// a batch of six images is one round trip per poll, not six.
//
// Deliberately stateless: the provider is encoded in the handle, so no
// database lookup is needed to know who to ask. When a real DB arrives this
// endpoint reads from it instead and the client contract is unchanged.

const MAX_HANDLES = 12

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-token')
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const auth = checkAccess(req.headers)
  if (!auth.ok) return res.status(auth.status).json({ error: auth.message })

  const rl = rateLimit(clientIp(req.headers))
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfter))
    return res.status(429).json({ error: 'Too many requests — slow down a moment and try again.' })
  }

  const userAuth = req.headers['x-hf-token'] || null

  const raw = req.query?.handles
    ?? (req.url ? new URLSearchParams(req.url.split('?')[1] || '').get('handles') : null)

  if (!raw) return res.status(400).json({ error: 'Missing handles' })

  const handles = String(raw).split(',').map(s => s.trim()).filter(Boolean).slice(0, MAX_HANDLES)
  if (!handles.length) return res.status(400).json({ error: 'No valid handles' })

  // One slow provider must not stall the whole poll, so failures are reported
  // per-job rather than failing the request. A transient polling error is NOT
  // a failed generation — it's reported as still running so the client keeps
  // polling instead of discarding a job that may well succeed.
  const jobs = await Promise.all(handles.map(async handle => {
    try {
      const { provider, taskId } = decodeHandle(handle)
      const state = await getProvider(provider).getJob(taskId, { auth: userAuth })
      return { handle, ...state }
    } catch (e) {
      console.error('[status]', handle, e.message)
      return { handle, state: STATE.RUNNING, urls: [], progress: null, error: null, transientError: e.message }
    }
  }))

  const done = jobs.every(j => j.state === STATE.SUCCEEDED || j.state === STATE.FAILED)

  return res.status(200).json({ jobs, done })
}
