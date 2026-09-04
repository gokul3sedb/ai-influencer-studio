import { STATE, jobState, ProviderError } from './contract.js'

// ── Higgsfield adapter ───────────────────────────────────────────
//
// Ported from src/utils/higgsfieldGenerate.js so Higgsfield becomes a peer
// provider rather than a separate code path. The browser copy is UNTOUCHED and
// still drives every existing page — this exists so /studio can offer
// Higgsfield as an option alongside kie.ai.
//
// BILLING DIFFERS FROM EVERY OTHER PROVIDER. kie.ai spends our server key;
// Higgsfield spends THE USER'S OWN CREDITS via their OAuth token. That token
// therefore has to arrive with each request (`auth`), and we never store it.
// It stays in the user's browser exactly as it does today.
//
// Protocol notes that cost real debugging time in the client and apply equally
// here:
//   • MCP is JSON-RPC over HTTP, and a session must be initialised before any
//     tools/call. Serverless is stateless, so we initialise per request.
//   • Responses arrive as JSON *or* text/event-stream depending on the call.
//   • A 200 OK can still carry "invalid or expired token" in the body.
//   • Only soul_2 is Higgsfield-exclusive; the rest are OpenAI/Google/ByteDance
//     models we can also reach through kie.ai, usually cheaper.

const NAME = 'higgsfield'
const MCP_URL = 'https://mcp.higgsfield.ai/mcp'

function requireAuth(auth) {
  if (!auth) throw new ProviderError(NAME, 'Higgsfield requires the user\'s access token — connect Higgsfield in Settings')
  return auth
}

// ── MCP transport ────────────────────────────────────────────────
async function mcpPost(body, auth, sessionId = null) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'Authorization': `Bearer ${requireAuth(auth)}`,
  }
  if (sessionId) headers['Mcp-Session-Id'] = sessionId

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60000)

  let res
  try {
    res = await fetch(MCP_URL, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal })
  } catch (e) {
    clearTimeout(timer)
    throw new ProviderError(NAME, e.name === 'AbortError' ? 'Higgsfield timed out' : e.message, { retryable: true })
  }

  if (res.status === 401) {
    clearTimeout(timer)
    // The client owns token refresh — surface this so the browser can refresh
    // and retry rather than silently failing over to another provider.
    throw new ProviderError(NAME, 'Higgsfield session expired — reconnect in Settings', { status: 401 })
  }
  if (!res.ok) {
    clearTimeout(timer)
    const text = await res.text().catch(() => '')
    throw new ProviderError(NAME, `HTTP ${res.status}: ${text.slice(0, 200)}`, { status: res.status, retryable: res.status >= 500 })
  }

  const sid = res.headers.get('Mcp-Session-Id') || sessionId
  const ct = res.headers.get('content-type') || ''

  try {
    const text = await res.text()
    const parsed = ct.includes('text/event-stream') || text.trimStart().startsWith('data:')
      ? parseSSEText(text)
      : safeJson(text)
    return { body: parsed, sessionId: sid }
  } finally {
    clearTimeout(timer)
  }
}

function safeJson(t) { try { return JSON.parse(t) } catch { return t } }

// Higgsfield emits several SSE frames; the one carrying `result` is the answer,
// and a null frame is a keepalive that must not be mistaken for the payload.
function parseSSEText(text) {
  let resultEvent = null, lastNonNull = null
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t.startsWith('data:')) continue
    const raw = t.slice(5).trim()
    if (!raw || raw === '[DONE]') continue
    try {
      const d = JSON.parse(raw)
      if (d !== null) { lastNonNull = d; if (d.result !== undefined) resultEvent = d }
    } catch { /* partial frame */ }
  }
  return resultEvent ?? lastNonNull
}

async function initSession(auth) {
  const { sessionId } = await mcpPost({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      clientInfo: { name: 'AI Influencer Studio', version: '1.0' },
    },
  }, auth)
  return sessionId
}

async function callTool(name, args, auth, sessionId) {
  const { body } = await mcpPost({
    jsonrpc: '2.0', id: Date.now(), method: 'tools/call',
    params: { name, arguments: args },
  }, auth, sessionId)

  const result = body?.result ?? body

  // Higgsfield reports failures as HTTP 200 with the error in the body, so this
  // check is the only thing standing between a dead request and a job that
  // appears to start and then hangs forever.
  //
  // Worse, those error messages embed "Request ID: <uuid>" — and the job-id
  // extractor scans for UUIDs as a fallback. Without this guard it happily
  // returns the Request ID as a job id and we poll a job that never existed.
  // Verified against the live API: an invalid token returns exactly that shape.
  assertNoError(result)
  return result
}

// Note the wording: Higgsfield says "session has expired or is no longer valid",
// NOT "invalid or expired token" as the browser client's check assumed. Match
// broadly — a missed auth error is an infinite poll.
const AUTH_ERROR = /session (?:has )?expired|no longer valid|re-authorize|unauthori[sz]ed|invalid.{0,20}token/i

function assertNoError(result) {
  const structured = result?.structuredContent
  const inlineText = result?.content?.map(c => c?.text).filter(Boolean).join(' ') || ''
  const message = structured?.error || (/^error\b|error starting generation/i.test(inlineText) ? inlineText : null)
  if (!message) return

  if (AUTH_ERROR.test(message)) {
    throw new ProviderError(NAME, 'Higgsfield session expired — reconnect it in Settings', { status: 401 })
  }
  // Strip the Request ID so it can never be mistaken for a job id downstream.
  throw new ProviderError(NAME, String(message).replace(/\s*Request ID:\s*\S+/i, '').trim().slice(0, 300))
}

// MCP wraps tool output in a content array whose text is itself JSON.
function unwrapMCP(result) {
  if (!result?.content) return result
  for (const item of result.content) {
    if (item.text) { try { return JSON.parse(item.text) } catch { return item.text } }
  }
  return result
}

function extractJobIds(result) {
  const data = unwrapMCP(result)
  if (data && typeof data === 'object') {
    if (Array.isArray(data.results)) {
      const ids = data.results.map(r => r?.id || r?.job_id).filter(id => id?.length >= 8)
      if (ids.length) return ids
    }
    if (data.job_id) return [data.job_id]
    if (data.jobId) return [data.jobId]
    if (typeof data.id === 'string' && data.id.length >= 8) return [data.id]
  }
  const str = typeof data === 'string' ? data : JSON.stringify(data ?? '')
  return [...new Set(str.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || [])]
}

function extractUrls(result, kind) {
  const data = unwrapMCP(result)
  if (Array.isArray(data?.results)) {
    const urls = data.results.map(r => r?.results?.rawUrl || r?.results?.minUrl || r?.result_url).filter(Boolean)
    if (urls.length) return [...new Set(urls)]
  }
  const str = typeof data === 'string' ? data : JSON.stringify(data)
  const pattern = kind === 'video'
    ? /https:\/\/[^\s"\\]+\.(?:mp4|webm|mov)(?:[^\s"\\]*)?/g
    : /https:\/\/[^\s"\\]+\.(?:jpg|jpeg|png|webp)(?:[^\s"\\]*)?/g
  const byExt = (str.match(pattern) || []).map(u => u.replace(/[\\}"',]+$/, ''))
  if (byExt.length) return [...new Set(byExt)]
  // Higgsfield CDN URLs sometimes carry no file extension at all.
  return [...new Set((str.match(/https:\/\/[a-z0-9]+\.cloudfront\.net\/[^\s"'\\}]*/gi) || []).map(u => u.replace(/[\\}"',]+$/, '')))]
}

// ── Media upload: request slot -> PUT bytes -> confirm ───────────
export async function uploadMedia(dataUrl, { type = 'image', auth } = {}) {
  if (/^https?:\/\//.test(dataUrl)) return dataUrl
  const sessionId = await initSession(auth)

  const res = await fetch(dataUrl)
  const blob = await res.blob()
  const contentType = blob.type || 'image/png'
  const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg'

  const up = unwrapMCP(await callTool('media_upload', {
    method: 'upload_url', filename: `${type}_${Date.now()}.${ext}`, content_type: contentType,
  }, auth, sessionId))

  const f0 = up?.uploads?.[0] ?? up?.files?.[0] ?? up?.data?.[0]
  let uploadUrl = up?.upload_url || up?.url || f0?.upload_url || f0?.url
  let mediaId   = up?.media_id  || up?.id  || f0?.media_id  || f0?.id

  // Plain-text response — dig the values out by pattern.
  if (!uploadUrl || !mediaId) {
    const text = typeof up === 'string' ? up : JSON.stringify(up ?? '')
    mediaId = mediaId || (text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i) || [])[0]
    uploadUrl = uploadUrl || (text.match(/https:\/\/[^\s"'\\]+/) || [])[0]
  }
  if (!uploadUrl || !mediaId) throw new ProviderError(NAME, `media_upload failed: ${JSON.stringify(up)?.slice(0, 200)}`)

  const put = await fetch(uploadUrl, { method: 'PUT', body: blob, headers: { 'Content-Type': contentType } })
  if (!put.ok) throw new ProviderError(NAME, `Upload PUT failed: ${put.status}`, { retryable: true })

  const confirmed = unwrapMCP(await callTool('media_confirm', { media_id: mediaId, type }, auth, sessionId))
  const cdn = confirmed?.url || confirmed?.media_url || confirmed?.rawUrl || confirmed?.cdn_url
  if (cdn) return cdn
  if (typeof confirmed === 'string') {
    const m = confirmed.match(/https:\/\/[^\s"'\\]+/)
    if (m) return m[0]
  }
  // Higgsfield accepts a media id wherever it accepts a URL.
  return confirmed?.media_id || confirmed?.id || mediaId
}

// ── Job creation ─────────────────────────────────────────────────
function baseParams(model, aspectRatio) {
  if (model === 'soul_2') return { model, aspect_ratio: aspectRatio, quality: '2k' }
  if (model === 'gpt_image_2') return { model, aspect_ratio: aspectRatio, count: 1, quality: 'high' }
  return { model, aspect_ratio: aspectRatio, count: 1, resolution: '2k' }
}

export async function createImageJob({ model, prompt, refUrls = [], aspectRatio = '9:16', auth }) {
  const sessionId = await initSession(auth)
  const params = baseParams(model, aspectRatio)
  if (refUrls.length) params.medias = refUrls.map(value => ({ value, role: 'image' }))

  const result = await callTool('generate_image', { params: { ...params, prompt } }, auth, sessionId)
  const ids = extractJobIds(result)
  if (!ids.length) throw new ProviderError(NAME, `No job id returned: ${JSON.stringify(unwrapMCP(result))?.slice(0, 200)}`)
  return ids[0]
}

export async function createVideoJob({
  model = 'seedance_2_0', prompt, refUrls = [], firstFrameUrl = null, audioUrls = [],
  aspectRatio = '9:16', resolution = '1080p', duration = 5, auth,
}) {
  const sessionId = await initSession(auth)

  // Order matters: start_image, then @image_N references, then audio.
  const medias = []
  if (firstFrameUrl) medias.push({ value: firstFrameUrl, role: 'start_image' })
  refUrls.forEach(value => medias.push({ value, role: 'image' }))
  audioUrls.forEach(value => medias.push({ value, role: 'audio' }))

  const params = { model, prompt, aspect_ratio: aspectRatio, duration, resolution, mode: 'std' }
  if (medias.length) params.medias = medias

  let result = await callTool('generate_video', { params }, auth, sessionId)

  // Higgsfield sometimes answers with a preset match instead of a job. Decline
  // it and ask again, otherwise we'd poll a preset id forever.
  const presetId = (JSON.stringify(unwrapMCP(result) ?? '')
    .match(/declined_preset_id[^a-f0-9]*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i) || [])[1]
  if (presetId && !extractUrls(result, 'video').length) {
    result = await callTool('generate_video', { params: { ...params, declined_preset_id: presetId } }, auth, sessionId)
  }

  const raw = JSON.stringify(unwrapMCP(result) ?? '')
  if (/ip detected|ip.block|vpn detected|blocked this request/i.test(raw)) {
    throw new ProviderError(NAME, 'Higgsfield blocked this request — it detected a protected or copyrighted likeness in the reference images')
  }

  const ids = extractJobIds(result).filter(id => id !== presetId)
  if (!ids.length) throw new ProviderError(NAME, `No job id returned: ${raw.slice(0, 200)}`)
  return ids[0]
}

// ── Status ───────────────────────────────────────────────────────
const FAILED = new Set(['failed', 'error', 'cancelled', 'rejected', 'nsfw', 'content_filtered', 'not_found'])
const DONE = new Set(['completed', 'done'])

export async function getJob(taskId, { auth } = {}) {
  const sessionId = await initSession(auth)
  const result = await callTool('job_status', { jobId: taskId }, auth, sessionId)
  const data = unwrapMCP(result)

  const item = Array.isArray(data?.results) ? data.results[0] : data
  const status = String(item?.status || data?.status || '').toLowerCase()

  if (FAILED.has(status)) {
    return jobState(STATE.FAILED, { error: item?.error || `Higgsfield job ${status}` })
  }

  const urls = extractUrls(result, 'auto')
  if (urls.length) return jobState(STATE.SUCCEEDED, { urls, progress: 100 })

  // "done" with no URL yet means the CDN hasn't caught up — keep polling
  // rather than handing back an empty success.
  if (DONE.has(status)) return jobState(STATE.RUNNING, { progress: 99 })

  return jobState(status ? STATE.RUNNING : STATE.PENDING, { progress: item?.progress ?? null })
}

export default {
  name: NAME,
  supports: { image: true, video: true, upload: true },
  requiresUserAuth: true,   // routing/UI use this to prompt for a connection
  uploadMedia,
  createImageJob,
  createVideoJob,
  getJob,
}
