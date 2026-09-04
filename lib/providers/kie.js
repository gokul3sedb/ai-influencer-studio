import { STATE, jobState, httpJson, ProviderError } from './contract.js'

// ── kie.ai adapter ───────────────────────────────────────────────
//
// Aggregator fronting Seedance, GPT Image, Nano Banana, Veo, Kling and more
// behind one key. Two separate hosts, which is easy to trip over:
//
//   api.kie.ai              — job creation + status
//   kieai.redpandaai.co     — file upload
//
// IMPORTANT LIFECYCLE FACTS (both documented by kie.ai):
//   • Uploaded files are deleted after 24 hours.
//   • Generated result URLs expire after 24 hours.
// So kie.ai is a generation service, NOT storage. Anything a user must keep
// has to be copied into our own bucket before that window closes. Until that
// exists, treat every returned URL as ephemeral.

const NAME = 'kie'
const API_BASE = 'https://api.kie.ai/api/v1'
const UPLOAD_BASE = 'https://kieai.redpandaai.co/api'

function apiKey() {
  const k = process.env.KIE_API_KEY
  if (!k) throw new ProviderError(NAME, 'KIE_API_KEY is not set')
  return k
}

function headers() {
  return { 'Authorization': `Bearer ${apiKey()}`, 'Content-Type': 'application/json' }
}

// kie.ai wraps everything in { code, msg, data }. A 200 at the HTTP layer can
// still carry a non-200 `code`, so every response goes through here.
function unwrap(body) {
  if (body?.code !== undefined && body.code !== 200) {
    throw new ProviderError(NAME, body.msg || `API code ${body.code}`, {
      status: body.code,
      retryable: body.code >= 500,
    })
  }
  return body?.data ?? body
}

// ── Upload ───────────────────────────────────────────────────────
// kie.ai models take image URLs, not inline base64 — unlike Higgsfield's
// media_upload/media_confirm pair. We push the data URL through their base64
// endpoint and hand the returned public URL to the model.
export async function uploadMedia(dataUrl, { type = 'image' } = {}) {
  if (!dataUrl?.startsWith('data:')) {
    // Already a hosted URL — nothing to do.
    if (/^https?:\/\//.test(dataUrl)) return dataUrl
    throw new ProviderError(NAME, 'uploadMedia expects a data: URL or an http(s) URL')
  }

  const ext = (dataUrl.match(/^data:([^;]+)/)?.[1] || '').split('/')[1] || 'png'
  const body = await httpJson(`${UPLOAD_BASE}/file-base64-upload`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      base64Data: dataUrl,
      uploadPath: `influencer-studio/${type}`,
      fileName: `${type}_${Date.now()}.${ext}`,
    }),
  }, { provider: NAME, timeoutMs: 60000 })

  const data = unwrap(body)
  // Field naming varies across their upload endpoints — accept any of them
  // rather than guessing one and breaking on a rename.
  const url = data?.downloadUrl || data?.fileUrl || data?.url || data?.data?.downloadUrl
  if (!url) throw new ProviderError(NAME, `Upload returned no URL: ${JSON.stringify(data).slice(0, 200)}`)
  return url
}

// ── Job creation ─────────────────────────────────────────────────
async function createTask(model, input) {
  const body = await httpJson(`${API_BASE}/jobs/createTask`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ model, input }),
  }, { provider: NAME })

  const data = unwrap(body)
  const taskId = data?.taskId || data?.task_id || data?.id
  if (!taskId) throw new ProviderError(NAME, `createTask returned no taskId: ${JSON.stringify(data).slice(0, 200)}`)
  return taskId
}

export async function createImageJob({ model, prompt, refUrls = [], aspectRatio = '9:16', resolution = null, quality = null }) {
  const input = { prompt, aspect_ratio: aspectRatio }

  // kie image models split into text-to-image and image-to-image variants.
  // The routing table picks the right slug; we just attach refs when present.
  if (refUrls.length) input.input_urls = refUrls

  // NO DEFAULTS HERE — deliberately. Models disagree about these fields and
  // sending an unsupported one is a hard 500, not a warning. Verified 2026-09:
  //   gpt-image-2-*  rejects 'resolution' outright; takes 'quality'
  //   nano-banana-*  takes 'resolution' but only UPPERCASE ('1K', not '1k')
  // The routing table supplies whatever each model actually accepts, so this
  // layer passes through and never guesses.
  if (resolution) input.resolution = resolution
  if (quality) input.quality = quality

  return createTask(model, input)
}

export async function createVideoJob({
  model, prompt, refUrls = [], firstFrameUrl = null, audioUrls = [],
  aspectRatio = '9:16', resolution = '720p', duration = 5, generateAudio = false,
}) {
  const input = {
    prompt,
    aspect_ratio: aspectRatio,
    resolution,
    duration,
    generate_audio: generateAudio,
  }
  if (firstFrameUrl) input.first_frame_url = firstFrameUrl
  if (refUrls.length) input.reference_image_urls = refUrls.slice(0, 9)   // documented max
  if (audioUrls.length) input.reference_audio_urls = audioUrls.slice(0, 3)

  return createTask(model, input)
}

// ── Status ───────────────────────────────────────────────────────
const STATE_MAP = {
  waiting:    STATE.PENDING,
  queuing:    STATE.PENDING,
  generating: STATE.RUNNING,
  success:    STATE.SUCCEEDED,
  fail:       STATE.FAILED,
}

export async function getJob(taskId) {
  const body = await httpJson(
    `${API_BASE}/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
    { method: 'GET', headers: headers() },
    { provider: NAME },
  )
  const data = unwrap(body)

  const state = STATE_MAP[data?.state] ?? STATE.PENDING

  if (state === STATE.FAILED) {
    return jobState(STATE.FAILED, {
      error: data?.failMsg || data?.failCode || 'Generation failed',
      progress: data?.progress ?? null,
    })
  }

  if (state !== STATE.SUCCEEDED) {
    return jobState(state, { progress: data?.progress ?? null })
  }

  // resultJson arrives as a JSON *string*, not an object.
  let urls = []
  try {
    const parsed = typeof data.resultJson === 'string' ? JSON.parse(data.resultJson) : (data.resultJson || {})
    urls = parsed.resultUrls || parsed.result_urls || []
  } catch {
    throw new ProviderError(NAME, `Could not parse resultJson: ${String(data.resultJson).slice(0, 200)}`)
  }

  if (!urls.length) {
    // Reported success with nothing to show — treat as still running so the
    // caller polls again rather than delivering an empty result.
    return jobState(STATE.RUNNING, { progress: 99 })
  }

  return jobState(STATE.SUCCEEDED, { urls, progress: 100 })
}

export default {
  name: NAME,
  supports: { image: true, video: true, upload: true },
  uploadMedia,
  createImageJob,
  createVideoJob,
  getJob,
}
