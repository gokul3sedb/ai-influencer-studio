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
const ENGINE_PREF_KEY = 'aiis_engine_prefs'

// Engines are chosen PER MEDIA TYPE, not globally, because the economics are
// wildly different: an image is ~6 credits, a 5s video is ~205. The setup that
// actually makes sense is cheap photos on kie.ai while video stays wherever it
// looks best — a single switch cannot express that.
export const MEDIA = { IMAGE: 'image', VIDEO: 'video' }

function readPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(ENGINE_PREF_KEY) || '{}')
    return (raw && typeof raw === 'object') ? raw : {}
  } catch { return {} }
}

/**
 * Which engine runs this media type.
 *
 * Falls back to the old single model preference so anyone who picked a kie.ai
 * card in Create before this existed keeps the behaviour they already had,
 * rather than silently reverting to Higgsfield and a surprise bill.
 */
export function currentEngine(media = MEDIA.IMAGE) {
  const prefs = readPrefs()
  if (prefs[media] === 'kie' || prefs[media] === 'higgsfield') return prefs[media]

  try { return (localStorage.getItem(MODEL_PREF_KEY) || '').startsWith('kie_') ? 'kie' : 'higgsfield' }
  catch { return 'higgsfield' }
}

export function setEngine(media, engine) {
  const prefs = readPrefs()
  prefs[media] = engine
  try { localStorage.setItem(ENGINE_PREF_KEY, JSON.stringify(prefs)) } catch {}
  return prefs
}

export function getEngines() {
  return { [MEDIA.IMAGE]: currentEngine(MEDIA.IMAGE), [MEDIA.VIDEO]: currentEngine(MEDIA.VIDEO) }
}

const useServer = (media = MEDIA.IMAGE) => currentEngine(media) === 'kie'

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
export const hasPhotoGenSession  = hf.hasPhotoGenSession
export const markPhotoGenSession = hf.markPhotoGenSession

// Every reference must land, props included. The prompt addresses images by
// POSITION, so a dropped upload shifts everything after it and the prompt ends
// up describing the wrong picture — silently. `labels` let the error name the
// image that failed instead of a bare index.
async function hostRefs(list, labels = []) {
  const kept = []
  const keptLabels = []
  list.forEach((img, i) => { if (img) { kept.push(img); keptLabels.push(labels[i]) } })
  return kept.length ? uploadRefs(kept, { labels: keptLabels }) : []
}

// Shared server round-trip. Reports progress on the same 0-100 scale the
// Higgsfield path uses so existing progress bars need no changes.
async function runOnServer({ jobType, prompt, character = {}, refUrls, options, onProgress, onPartialResults, isCancelled }) {
  const { handles } = await startGeneration({ jobType, character, refUrls, prompt, options })
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

  const { prompt, aspectRatio = '9:16', referenceImage, outfitImage, onProgress, isCancelled,
          serverJobType = null, character = null } = opts
  onProgress?.(10)
  const refUrls = await hostRefs([referenceImage, outfitImage], ['the face reference', 'the outfit reference'])

  // When the caller names a server job type, the server builds the prompt from
  // the character record and the text never leaves the browser. Callers still
  // pass `prompt` because the Higgsfield path above needs it.
  const onServer = !!(serverJobType && character)

  const urls = await runOnServer({
    jobType: onServer ? serverJobType : 'scene_photo',
    prompt: onServer ? null : prompt,
    character: onServer ? character : {},
    refUrls,
    options: { count: 1, aspectRatio, provider: 'kie' },
    onProgress, isCancelled,
  })
  return urls[0]
}

export async function generateThreeImages(opts) {
  if (!useServer()) return hf.generateThreeImages(opts)

  const { prompts, aspectRatio = '9:16', faceRef, styleRef, onProgress, onPartialResults, isCancelled } = opts
  onProgress?.(10)
  const refUrls = await hostRefs([faceRef, styleRef], ['the face reference', 'the style reference'])
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
  // One call, one order: identity first then props, exactly matching how the
  // caller numbered the @image tags in the prompt.
  const refUrls = await hostRefs(
    [referenceImage, outfitImage, closeUpImage1, closeUpImage2, ...propImages],
    ['the face reference', 'the outfit reference', 'the close-up reference', 'the second close-up',
     ...propImages.map((_, i) => `prop image ${i + 1}`)],
  )
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
  if (!useServer(MEDIA.VIDEO)) return hf.generateVideo(opts)

  const { prompt, aspectRatio = '9:16', duration = 5, referenceImages = [], audioRef,
          startFrameUrl, resolution = '720p', onProgress, onPartialResults, isCancelled } = opts
  onProgress?.(10)

  const refUrls = await hostRefs(referenceImages, referenceImages.map((_, i) => `reference image ${i + 1}`))
  const [firstFrameUrl] = startFrameUrl ? await hostRefs([startFrameUrl], ['the start frame']) : []
  const audioUrls = audioRef ? await hostRefs([audioRef], ['the audio file']) : []

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
