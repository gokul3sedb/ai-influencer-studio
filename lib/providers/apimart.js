import { STATE, jobState, httpJson, ProviderError } from './contract.js'
import { normalizeAspect, isParameterRejection } from './aspect.js'

// ── APIMart adapter ──────────────────────────────────────────────
//
// Third aggregator, fronting the same underlying models as kie.ai (Seedance,
// GPT Image, Nano Banana). Added for price competition rather than capability:
// the models are identical, so the only thing that differs is the rate.
//
// API surface, mapped against the live endpoint on 2026-09-05 by probing which
// paths return "Invalid URL" versus a real validation error — the account had
// no balance, so nothing could be run, but the shape is confirmed:
//
//   POST /v1/videos/generations   create a video task
//   POST /v1/images/generations   create an image task
//   GET  /v1/tasks/{task_id}      poll ANY task — one endpoint for both
//
// Note the asymmetry with kie.ai: kie has a per-domain status endpoint taking
// a query param, APIMart has one unified path taking the id in the URL.
//
// ⚠ REQUEST BODIES ARE UNVERIFIED. The endpoints are confirmed to exist and
// authenticate, but the account balance was 0.00 USD so no job could actually
// run. Field names follow APIMart's documented conventions and their
// OpenAI-compatible style. Run scripts/verify-apimart.mjs once the account has
// credit, before trusting this in production.

const NAME = 'apimart'
const API_BASE = 'https://api.apimart.ai/v1'

function apiKey() {
  const k = process.env.APIMART_API_KEY
  if (!k) throw new ProviderError(NAME, 'APIMART_API_KEY is not set')
  return k
}

function headers() {
  return { 'Authorization': `Bearer ${apiKey()}`, 'Content-Type': 'application/json' }
}

// APIMart wraps success as { code, data: [...] } and failure as
// { error: { message, type } }. A 200 can still carry an error object.
function unwrap(body) {
  if (body?.error) {
    const message = body.error.message || 'APIMart error'
    // Balance and auth problems are permanent for this request — retrying or
    // failing over to another model cannot help and only obscures the cause.
    const permanent = /insufficient balance|invalid api key|unauthorized/i.test(message)
    throw new ProviderError(NAME, message, {
      status: body.error.code || null,
      retryable: !permanent && !isParameterRejection(message),
    })
  }
  if (body?.code !== undefined && body.code !== 200) {
    throw new ProviderError(NAME, body.msg || body.message || `API code ${body.code}`, {
      status: body.code,
      retryable: body.code >= 500,
    })
  }
  return body?.data ?? body
}

// data arrives as an array of task objects, or occasionally a bare object.
function firstTask(data) {
  return Array.isArray(data) ? data[0] : data
}

// ── Upload ───────────────────────────────────────────────────────
// APIMart takes publicly reachable URLs and exposes no upload endpoint of its
// own. References must therefore already be hosted — which they are, because
// they are copied into our Blob store on the way in.
export async function uploadMedia(dataUrl) {
  if (/^https?:\/\//.test(dataUrl || '')) return dataUrl
  throw new ProviderError(NAME,
    'APIMart needs a hosted image URL. Enable Blob storage so references get a permanent URL first.')
}

// ── Job creation ─────────────────────────────────────────────────
async function createTask(path, payload) {
  const body = await httpJson(`${API_BASE}/${path}`, {
    method: 'POST', headers: headers(), body: JSON.stringify(payload),
  }, { provider: NAME })

  const task = firstTask(unwrap(body))
  const taskId = task?.task_id || task?.taskId || task?.id
  if (!taskId) throw new ProviderError(NAME, `No task_id returned: ${JSON.stringify(task).slice(0, 200)}`)
  return taskId
}

export async function createImageJob({ model, prompt, refUrls = [], aspectRatio = '9:16', auth: _auth = null }) {
  const input = { model, prompt, aspect_ratio: normalizeAspect(model, aspectRatio) }
  if (refUrls.length) input.image_urls = refUrls
  return createTask('images/generations', input)
}

export async function createVideoJob({
  model, prompt, refUrls = [], firstFrameUrl = null, audioUrls = [],
  aspectRatio = '9:16', resolution = '720p', duration = 5, generateAudio = true, auth: _auth = null,
}) {
  const input = {
    model,
    prompt,
    aspect_ratio: normalizeAspect(model, aspectRatio),
    resolution,
    duration,
    generate_audio: generateAudio,
  }
  if (firstFrameUrl) input.first_frame_url = firstFrameUrl
  if (refUrls.length) input.reference_image_urls = refUrls.slice(0, 9)
  if (audioUrls.length) input.reference_audio_urls = audioUrls.slice(0, 3)

  return createTask('videos/generations', input)
}

// ── Status ───────────────────────────────────────────────────────
// Their documented lifecycle is queued -> ready -> done. Other aggregators use
// different words for the same states, so map generously rather than assume.
const STATE_MAP = {
  submitted: STATE.PENDING, queued: STATE.PENDING, pending: STATE.PENDING, waiting: STATE.PENDING,
  ready: STATE.RUNNING, processing: STATE.RUNNING, running: STATE.RUNNING, generating: STATE.RUNNING,
  done: STATE.SUCCEEDED, success: STATE.SUCCEEDED, succeeded: STATE.SUCCEEDED, completed: STATE.SUCCEEDED,
  failed: STATE.FAILED, error: STATE.FAILED, cancelled: STATE.FAILED,
}

function extractUrls(task) {
  const out = []
  const push = v => { if (typeof v === 'string' && /^https?:\/\//.test(v)) out.push(v) }

  push(task?.video_url); push(task?.image_url); push(task?.url); push(task?.output_url)
  for (const key of ['urls', 'output', 'outputs', 'results', 'data']) {
    const v = task?.[key]
    if (Array.isArray(v)) v.forEach(item => push(typeof item === 'string' ? item : (item?.url || item?.video_url || item?.image_url)))
  }
  return [...new Set(out)]
}

export async function getJob(taskId, _opts = {}) {
  const body = await httpJson(`${API_BASE}/tasks/${encodeURIComponent(taskId)}`,
    { method: 'GET', headers: headers() }, { provider: NAME })

  const task = firstTask(unwrap(body))
  const state = STATE_MAP[String(task?.status || '').toLowerCase()] ?? STATE.PENDING

  if (state === STATE.FAILED) {
    return jobState(STATE.FAILED, { error: task?.fail_reason || task?.message || 'Generation failed' })
  }

  const urls = extractUrls(task)
  if (urls.length) return jobState(STATE.SUCCEEDED, { urls, progress: 100 })

  // Reported done with nothing to show — keep polling rather than handing back
  // an empty success, the same guard the other adapters use.
  if (state === STATE.SUCCEEDED) return jobState(STATE.RUNNING, { progress: 99 })

  return jobState(state, { progress: task?.progress ?? null })
}

export default {
  name: NAME,
  supports: { image: true, video: true, upload: false },
  uploadMedia,
  createImageJob,
  createVideoJob,
  getJob,
}
