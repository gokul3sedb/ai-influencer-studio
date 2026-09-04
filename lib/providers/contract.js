// ── Provider adapter contract ────────────────────────────────────
//
// Every generation backend (kie.ai, WaveSpeed, Higgsfield, a self-hosted
// ComfyUI box later) implements this same shape. Nothing above this layer
// — routing, the prompt engine, the API handlers — knows which provider
// actually ran a job. That is the whole point: swapping providers must
// never touch calling code.
//
// An adapter exports:
//
//   name       string
//   supports   { image, video, upload }  — capability flags
//
//   uploadMedia(dataUrl, { type })        -> Promise<string>   public URL
//   createImageJob(spec)                  -> Promise<string>   provider task id
//   createVideoJob(spec)                  -> Promise<string>   provider task id
//   getJob(taskId)                        -> Promise<JobState>
//
// Image spec:  { model, prompt, refUrls[], aspectRatio, resolution, quality }
// Video spec:  { model, prompt, refUrls[], firstFrameUrl, audioUrls[],
//                aspectRatio, resolution, duration, generateAudio }
//
// Providers differ wildly in their own status vocabularies. Each adapter is
// responsible for collapsing its native states into the four below, so the
// rest of the system only ever sees one state machine.

export const STATE = {
  PENDING:   'pending',    // accepted, not started
  RUNNING:   'running',    // actively generating
  SUCCEEDED: 'succeeded',  // urls are populated
  FAILED:    'failed',     // error is populated
}

/** @typedef {{ state: string, urls: string[], progress: number|null, error: string|null }} JobState */

export function jobState(state, { urls = [], progress = null, error = null } = {}) {
  return { state, urls, progress, error }
}

// Terminal states never need re-polling.
export function isTerminal(state) {
  return state === STATE.SUCCEEDED || state === STATE.FAILED
}

export class ProviderError extends Error {
  constructor(provider, message, { status = null, retryable = false } = {}) {
    super(`[${provider}] ${message}`)
    this.provider = provider
    this.status = status
    // Routing uses this to decide whether to fail over to the next candidate
    // rather than surfacing the error to the user.
    this.retryable = retryable
  }
}

// Shared fetch with timeout + retry on transient failures. Providers are
// third-party services on the far side of the internet; a 502 or a blip is
// normal and must not surface as a failed generation.
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])

export async function httpJson(url, options = {}, { provider = 'provider', attempts = 3, timeoutMs = 30000 } = {}) {
  let lastErr = null

  for (let i = 0; i < attempts; i++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, { ...options, signal: controller.signal })
      clearTimeout(timer)

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        const retryable = RETRYABLE_STATUS.has(res.status)
        lastErr = new ProviderError(provider, `HTTP ${res.status}${body ? ` — ${body.slice(0, 300)}` : ''}`, {
          status: res.status,
          retryable,
        })
        if (!retryable || i === attempts - 1) throw lastErr
        await sleep(backoffMs(i, res.headers.get('retry-after')))
        continue
      }

      const text = await res.text()
      if (!text) return {}
      try { return JSON.parse(text) }
      catch { throw new ProviderError(provider, `Non-JSON response: ${text.slice(0, 200)}`) }
    } catch (e) {
      clearTimeout(timer)
      if (e instanceof ProviderError) { if (i === attempts - 1) throw e; lastErr = e; await sleep(backoffMs(i)); continue }
      // Network error or timeout — always worth one more try.
      lastErr = new ProviderError(provider, e.name === 'AbortError' ? `Timed out after ${timeoutMs}ms` : e.message, { retryable: true })
      if (i === attempts - 1) throw lastErr
      await sleep(backoffMs(i))
    }
  }
  throw lastErr
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

function backoffMs(attempt, retryAfterHeader = null) {
  const ra = Number(retryAfterHeader)
  if (Number.isFinite(ra) && ra > 0) return Math.min(ra * 1000, 8000)
  return 500 * Math.pow(2, attempt) + Math.floor(Math.random() * 400)
}
