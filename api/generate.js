import { rateLimit, clientIp } from '../lib/rateLimit.js'
import { checkAccess } from '../lib/auth.js'
import { getProvider } from '../lib/providers/index.js'
import { candidatesFor, modelFor } from '../lib/routing.js'
import { buildPrompts } from '../lib/prompt/index.js'
import { translatePrompts } from '../lib/prompt/translate.js'
import { encodeHandle } from '../lib/jobs.js'
import { ProviderError } from '../lib/providers/contract.js'

// POST /api/generate
//   { jobType, character, refUrls?, firstFrameUrl?, audioUrls?, options? }
//   -> { handles: string[], jobType, count }
//
// Assembles the prompt server-side, dispatches to whichever provider the
// routing table names, and returns opaque handles. Returns IMMEDIATELY —
// generation takes minutes and serverless functions have hard execution
// limits, so the client polls /api/status with these handles.
//
// The assembled prompt is never returned. That is the point of this endpoint.

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } }

const MAX_COUNT = 6

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

  const {
    jobType,
    character = {},
    refUrls = [],
    firstFrameUrl = null,
    audioUrls = [],
    options = {},
  } = req.body || {}

  if (!jobType) return res.status(400).json({ error: 'Missing jobType' })

  // Cap fan-out so a malformed or hostile request can't launch 500 paid jobs.
  const count = Math.min(Math.max(1, Number(options.count) || 1), MAX_COUNT)

  // Higgsfield spends the USER'S credits, so their OAuth token rides along on
  // the request and is used, never stored. Absent for kie.ai, which uses ours.
  const userAuth = req.headers['x-hf-token'] || null

  let candidates
  try { candidates = candidatesFor(jobType, options.provider || null) }
  catch (e) { return res.status(400).json({ error: e.message }) }

  // MIGRATION ESCAPE HATCH — read this before extending it.
  //
  // Some flows (character sheet, close-ups, video) still build their prompt in
  // the browser and pass it through. That is a deliberate step BACKWARDS on
  // prompt privacy for those paths: a browser-supplied prompt is a
  // browser-readable prompt.
  //
  // It exists so those pages can move onto the cheaper engine now instead of
  // waiting for every prompt builder to be ported into lib/prompt/. Once they
  // are, this branch should be deleted. Do not reach for it in new code.
  const supplied = req.body?.prompt
  let prompts
  if (supplied) {
    prompts = (Array.isArray(supplied) ? supplied : [supplied])
      .filter(p => typeof p === 'string' && p.trim())
      .slice(0, MAX_COUNT)
    if (!prompts.length) return res.status(400).json({ error: 'Supplied prompt was empty' })
  } else {
    try { prompts = buildPrompts(jobType, character, { ...options, count }) }
    catch (e) {
      console.error('[generate] prompt build failed:', e.message)
      return res.status(400).json({ error: `Could not build prompt: ${e.message}` })
    }
  }

  // Walk the candidate list. A retryable failure (rate limit, 5xx, timeout)
  // falls through to the next provider/model; a genuine rejection — bad model
  // slug, malformed params — surfaces immediately, because retrying it on a
  // different model would just hide a bug we need to see.
  const errors = []
  for (const candidate of candidates) {
    try {
      const model = modelFor(candidate, refUrls.length > 0)
      // Prompts are written in Higgsfield's dialect (@image1, @image2). Any
      // other provider needs that addressing translated into plain language,
      // or the per-reference instructions become noise and the character's
      // identity drifts. Translated per candidate, since failover may cross
      // providers.
      const finalPrompts = translatePrompts(prompts, {
        provider: candidate.provider,
        refCount: refUrls.length + (firstFrameUrl ? 1 : 0),
      })
      const handles = await dispatch(candidate, model, finalPrompts, { refUrls, firstFrameUrl, audioUrls, options, userAuth })
      return res.status(200).json({
        handles,
        jobType,
        count: handles.length,
        // Named so the client can show "generating…" states, never the prompt.
        via: `${candidate.provider}/${model}`,
      })
    } catch (e) {
      const retryable = e instanceof ProviderError ? e.retryable : false
      const attempted = modelFor(candidate, refUrls.length > 0)
      errors.push(`${candidate.provider}/${attempted}: ${e.message}`)
      console.error('[generate] candidate failed', attempted, e.message, retryable ? '(failing over)' : '(fatal)')
      if (!retryable) break
    }
  }

  return res.status(502).json({
    error: 'All providers failed for this job.',
    details: errors,
  })
}

async function dispatch(candidate, model, prompts, { refUrls, firstFrameUrl, audioUrls, options, userAuth }) {
  const provider = getProvider(candidate.provider)
  if (provider.requiresUserAuth && !userAuth) {
    throw new Error(`${provider.name} needs your account connected — connect it in Settings, or pick another option`)
  }
  // Client overrides apply to VIDEO only. Image models disagree about which
  // resolution values they accept (and some reject the field outright), so the
  // routing table is the sole authority there — a stray client value would be a
  // hard 500 rather than a graceful degrade.
  const params = { ...candidate.params, ...(candidate.kind === 'video' ? pickOverrides(options) : {}) }

  if (candidate.kind === 'video') {
    if (!provider.supports.video) throw new Error(`${provider.name} does not support video`)
    const taskId = await provider.createVideoJob({
      model,
      prompt: prompts[0],
      refUrls,
      firstFrameUrl,
      audioUrls,
      aspectRatio: options.aspectRatio || '9:16',
      duration: clampDuration(options.duration),
      auth: userAuth,
      ...params,
    })
    return [encodeHandle(provider.name, taskId)]
  }

  if (!provider.supports.image) throw new Error(`${provider.name} does not support image`)

  // Unlike Higgsfield's MCP session, kie.ai jobs are independent HTTP calls
  // with no shared session to conflict over — so these can fire in parallel.
  const taskIds = await Promise.all(prompts.map(prompt =>
    provider.createImageJob({
      model,
      prompt,
      refUrls,
      aspectRatio: options.aspectRatio || '9:16',
      auth: userAuth,
      ...params,
    })
  ))
  return taskIds.map(id => encodeHandle(provider.name, id))
}

// Only a narrow allowlist of client-supplied params reaches the provider.
// Anything else — model names especially — stays under server control.
function pickOverrides(options = {}) {
  const out = {}
  if (options.resolution) out.resolution = String(options.resolution)
  if (typeof options.generateAudio === 'boolean') out.generateAudio = options.generateAudio
  return out
}

function clampDuration(d) {
  const n = Number(d) || 5
  return Math.min(Math.max(4, n), 15)   // Seedance accepts 4-15s
}
