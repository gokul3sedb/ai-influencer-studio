// ── Client for the server-side generation API ────────────────────
//
// The migration bridge. Pages currently importing higgsfieldGenerate.js move
// to these functions one at a time; when the last one has moved,
// src/utils/systemPrompt.js and the Higgsfield client path can be deleted and
// the prompt library stops shipping to the browser entirely.
//
// The contract here is deliberately thin: upload refs, start a job, poll.
// No model names, no prompts, no provider names — the server owns all of it.

const REF_CACHE_KEY = 'studio_ref_cache'

// kie.ai deletes uploads after 24h, so a cached URL older than that is dead.
// Expiring at 20h leaves headroom for a long editing session.
const REF_TTL_MS = 20 * 60 * 60 * 1000

function appToken() {
  try { return localStorage.getItem('app_token') || '' } catch { return '' }
}

/** Whether this browser holds an access key for the server-side engine. */
export function hasAppToken() { return !!appToken() }

export function saveAppToken(value) {
  const t = String(value || '').trim()
  if (!t) return false
  try { localStorage.setItem('app_token', t); return true } catch { return false }
}

// Higgsfield spends the USER'S credits, so when they have connected their
// account we forward that token with the request. It is read from the very
// same localStorage key the existing Higgsfield client uses, so connecting in
// Settings works for both paths and there is never a second login.
function hfToken() {
  try { return localStorage.getItem('hf_access_token') || '' } catch { return '' }
}

export function isHiggsfieldAvailable() { return !!hfToken() }

function headers(extra = {}) {
  const h = { 'Content-Type': 'application/json', ...extra }
  const t = appToken()
  if (t) h['x-app-token'] = t
  const hf = hfToken()
  if (hf) h['x-hf-token'] = hf
  return h
}

export const PROVIDERS = {
  AUTO:       null,          // cheapest-first, per lib/routing.js
  KIE:        'kie',         // billed to the app's account
  HIGGSFIELD: 'higgsfield',  // billed to the user's own Higgsfield credits
}

async function postJson(url, body) {
  const res = await fetch(url, { method: 'POST', headers: headers(), body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(describeError(data, res.status))
  return data
}

// "All providers failed" on its own is useless — the reason each one failed is
// in `details`, and dropping it means staring at a generic message with no idea
// whether it's a missing key, an expired session or a bad model name.
function describeError(data, status) {
  const base = data?.error || `Request failed (${status})`
  if (!Array.isArray(data?.details) || !data.details.length) return base
  return `${base}\n\n${data.details.join('\n')}`
}

// ── Reference uploads ────────────────────────────────────────────
function readRefCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(REF_CACHE_KEY) || '{}')
    const now = Date.now()
    // Drop expired entries on read so the cache self-cleans.
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => v?.url && now - v.at < REF_TTL_MS))
  } catch { return {} }
}

function writeRefCache(cache) {
  try { localStorage.setItem(REF_CACHE_KEY, JSON.stringify(cache)) } catch { /* quota — memory only */ }
}

// Same cheap fingerprint the Higgsfield path uses: hashing megabytes of base64
// on every generation is slower than the upload it would save.
function fingerprint(dataUrl) {
  return `${dataUrl.length}:${dataUrl.slice(0, 48)}:${dataUrl.slice(-24)}`
}

/** Upload one reference image (data URL) and return its hosted URL. Cached. */
export async function uploadRef(dataUrl, { type = 'image' } = {}) {
  if (!dataUrl) return null
  if (/^https?:\/\//.test(dataUrl)) return dataUrl   // already hosted

  const fp = fingerprint(dataUrl)
  const cache = readRefCache()
  if (cache[fp]) return cache[fp].url

  const { url } = await postJson('/api/upload', { dataUrl, type })
  cache[fp] = { url, at: Date.now() }
  writeRefCache(cache)
  return url
}

/** Upload several refs in parallel, preserving order. Failures become null. */
export async function uploadRefs(dataUrls = [], opts) {
  const results = await Promise.all(
    dataUrls.filter(Boolean).map(d => uploadRef(d, opts).catch(e => {
      console.warn('[studio] ref upload failed:', e.message)
      return null
    }))
  )
  return results.filter(Boolean)
}

// ── Generation ───────────────────────────────────────────────────
export const JOB_TYPES = {
  CHARACTER_SHEET: 'character_sheet',
  SCENE_PHOTO:     'scene_photo',
  FAST_ITERATION:  'fast_iteration',
  VIDEO:           'video',
}

/**
 * Start a generation. Returns immediately with handles to poll.
 * @returns {Promise<{handles: string[], via: string, count: number}>}
 */
export function startGeneration({ jobType, character, refUrls = [], firstFrameUrl = null, audioUrls = [], options = {}, prompt = null }) {
  // `prompt` is the migration escape hatch for flows whose prompt builders
  // still live in the browser (see api/generate.js). Omit it and the server
  // builds the prompt itself, which is the preferred path.
  const body = { jobType, character, refUrls, firstFrameUrl, audioUrls, options }
  if (prompt) body.prompt = prompt
  return postJson('/api/generate', body)
}

/**
 * Poll until every job reaches a terminal state.
 *
 * onUpdate(jobs) fires every round so the UI can show results as they land
 * rather than waiting for the slowest job — the same partial-results behaviour
 * the Higgsfield path has.
 *
 * isCancelled() lets a page unmount abort polling without treating it as
 * failure; the handles stay valid and can be resumed later.
 */
export async function pollJobs(handles, { onUpdate, isCancelled, intervalMs = 3000, timeoutMs = 10 * 60 * 1000 } = {}) {
  const started = Date.now()
  const query = encodeURIComponent(handles.join(','))

  while (true) {
    if (isCancelled?.()) throw new Error('CANCELLED')
    if (Date.now() - started > timeoutMs) throw new Error('Generation timed out')

    const res = await fetch(`/api/status?handles=${query}`, { headers: headers() })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `Status check failed (${res.status})`)

    onUpdate?.(data.jobs)
    if (data.done) return data.jobs

    await new Promise(r => setTimeout(r, intervalMs))
  }
}

/** Convenience: start a job and wait for the finished URLs. */
export async function generate(spec, { onUpdate, isCancelled } = {}) {
  const { handles } = await startGeneration(spec)
  const jobs = await pollJobs(handles, { onUpdate, isCancelled })

  const urls = jobs.flatMap(j => j.urls || [])
  const failed = jobs.filter(j => j.state === 'failed')
  if (!urls.length && failed.length) {
    throw new Error(failed[0].error || 'Generation failed')
  }
  return { urls, jobs, handles }
}
