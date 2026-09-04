// ── Generation router ────────────────────────────────────────────
//
// Exposes the SAME function signatures as higgsfieldGenerate.js and picks the
// backend per call based on the user's saved engine preference.
//
// Why a shim instead of editing each call site: Influencers.jsx is 6,391 lines
// with seven generation call sites, each with its own pending-job persistence,
// cancel-on-unmount and partial-results wiring. Rewiring them individually is
// seven chances to break something that works today. Swapping one import line
// migrates all of them at once and is trivially reversible.
//
// Anything not routed is re-exported untouched, so the import line is a
// drop-in replacement.

import * as hf from './higgsfieldGenerate'
import { startGeneration, pollJobs, uploadRefs } from './studioApi'

const MODEL_PREF_KEY = 'aiis_model_pref'

/** Which engine the user last chose. kie.ai ids are prefixed `kie_`. */
export function currentEngine() {
  try { return (localStorage.getItem(MODEL_PREF_KEY) || '').startsWith('kie_') ? 'kie' : 'higgsfield' }
  catch { return 'higgsfield' }
}

const useServer = () => currentEngine() === 'kie'

// Pass-throughs — session and pending-job bookkeeping is Higgsfield-specific
// and harmless to call either way.
export const initSession       = hf.initSession
export const pollAllJobs       = hf.pollAllJobs
export const getPendingGens    = hf.getPendingGens
export const clearPendingGen   = hf.clearPendingGen
export const savePendingGen    = hf.savePendingGen
export const getPendingVideo   = hf.getPendingVideo
export const clearPendingVideo = hf.clearPendingVideo
export const savePendingVideo  = hf.savePendingVideo
export const resumeVideoJob    = hf.resumeVideoJob
export const getPendingPhoto   = hf.getPendingPhoto
export const clearPendingPhoto = hf.clearPendingPhoto
export const savePendingPhoto  = hf.savePendingPhoto
export const generatePosePreviews = hf.generatePosePreviews

// Identity references MUST land. If the face fails to upload the model does not
// error, it invents a different person — so these throw rather than fall away.
async function hostRefs(list) {
  const refs = list.filter(Boolean)
  return refs.length ? uploadRefs(refs, { required: true }) : []
}

// Props and style hints genuinely are optional; losing one degrades the image
// rather than changing who is in it.
async function hostOptionalRefs(list) {
  const refs = list.filter(Boolean)
  return refs.length ? uploadRefs(refs, { required: false }) : []
}

// Shared server round-trip. Reports progress on the same 0-100 scale the
// Higgsfield path uses so existing progress bars need no changes.
async function runOnServer({ jobType, prompt, refUrls, options, onProgress, onPartialResults, isCancelled }) {
  const { handles } = await startGeneration({ jobType, character: {}, refUrls, prompt, options })
  onProgress?.(30)

  const jobs = await pollJobs(handles, {
    isCancelled,
    onUpdate: list => {
      const urls = list.flatMap(j => j.urls || [])
      if (urls.length) onPartialResults?.(urls)
      const done = list.filter(j => j.state === 'succeeded' || j.state === 'failed').length
      onProgress?.(30 + Math.round((done / Math.max(list.length, 1)) * 65))
    },
  })

  const urls = jobs.flatMap(j => j.urls || [])
  if (!urls.length) {
    const failed = jobs.find(j => j.state === 'failed')
    throw new Error(failed?.error || 'No image returned — please try again')
  }
  onProgress?.(100)
  return urls
}

export async function generateSingleImage(opts) {
  if (!useServer()) return hf.generateSingleImage(opts)

  const { prompt, aspectRatio = '9:16', referenceImage, outfitImage, onProgress, isCancelled } = opts
  onProgress?.(10)
  const refUrls = await hostRefs([referenceImage, outfitImage])
  const urls = await runOnServer({
    jobType: 'scene_photo', prompt, refUrls,
    options: { count: 1, aspectRatio, provider: 'kie' },
    onProgress, isCancelled,
  })
  return urls[0]
}

export async function generateThreeImages(opts) {
  if (!useServer()) return hf.generateThreeImages(opts)

  const { prompts, aspectRatio = '9:16', faceRef, styleRef, onProgress, onPartialResults, isCancelled } = opts
  onProgress?.(10)
  const refUrls = await hostRefs([faceRef, styleRef])
  return runOnServer({
    jobType: 'scene_photo', prompt: prompts, refUrls,
    options: { count: Array.isArray(prompts) ? prompts.length : 3, aspectRatio, provider: 'kie' },
    onProgress, onPartialResults, isCancelled,
  })
}

export async function generateNImages(opts) {
  if (!useServer()) return hf.generateNImages(opts)

  const { prompt, count = 1, aspectRatio = '9:16', referenceImage, outfitImage,
          closeUpImage1, closeUpImage2, propImages = [], onProgress, onResult, isCancelled } = opts
  onProgress?.(10)
  const identity = await hostRefs([referenceImage, outfitImage, closeUpImage1, closeUpImage2])
  const props = await hostOptionalRefs(propImages)
  const refUrls = [...identity, ...props]
  const urls = await runOnServer({
    jobType: 'scene_photo',
    prompt: Array.isArray(prompt) ? prompt : Array.from({ length: count }, () => prompt),
    refUrls,
    options: { count, aspectRatio, provider: 'kie' },
    onProgress,
    // generateNImages delivers results one at a time rather than as a batch.
    onPartialResults: urlList => urlList.forEach(u => onResult?.(u)),
    isCancelled,
  })
  return urls
}

export async function generateVideo(opts) {
  if (!useServer()) return hf.generateVideo(opts)

  const { prompt, aspectRatio = '9:16', duration = 5, referenceImages = [], audioRef,
          startFrameUrl, resolution = '720p', onProgress, onPartialResults, isCancelled } = opts
  onProgress?.(10)

  const refUrls = await hostRefs(referenceImages)
  const [firstFrameUrl] = startFrameUrl ? await hostRefs([startFrameUrl]) : []
  const audioUrls = audioRef ? await hostRefs([audioRef]) : []

  const { handles } = await startGeneration({
    jobType: 'video', character: {}, prompt, refUrls, firstFrameUrl: firstFrameUrl || null, audioUrls,
    options: { aspectRatio, duration, resolution, provider: 'kie' },
  })
  onProgress?.(30)

  const jobs = await pollJobs(handles, {
    isCancelled,
    // Video is slow enough that a 3s poll is wasteful; the job rarely changes
    // state inside 6 seconds.
    intervalMs: 6000,
    timeoutMs: 15 * 60 * 1000,
    onUpdate: list => {
      const urls = list.flatMap(j => j.urls || [])
      if (urls.length) onPartialResults?.(urls)
      const done = list.filter(j => j.state === 'succeeded' || j.state === 'failed').length
      onProgress?.(30 + Math.round((done / Math.max(list.length, 1)) * 65))
    },
  })

  const urls = jobs.flatMap(j => j.urls || [])
  if (!urls.length) {
    const failed = jobs.find(j => j.state === 'failed')
    throw new Error(failed?.error || 'No video returned — please try again')
  }
  onProgress?.(100)
  // Higgsfield returns share links alongside the media; kie.ai has no
  // equivalent, so callers get an empty list rather than a missing field.
  return { urls, shareUrls: [] }
}
