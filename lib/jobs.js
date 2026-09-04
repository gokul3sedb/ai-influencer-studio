// ── Job handles ──────────────────────────────────────────────────
//
// A handle is what the browser holds between starting a generation and
// collecting the result: "<provider>:<providerTaskId>".
//
// Encoding the provider into the handle means /api/status can route a poll
// without a database lookup. When a real DB arrives this becomes a row id and
// the format stays opaque to the client either way — which is exactly why the
// client must never parse it.

const SEP = ':'

export function encodeHandle(provider, taskId) {
  if (!provider || !taskId) throw new Error('encodeHandle requires provider and taskId')
  return `${provider}${SEP}${taskId}`
}

export function decodeHandle(handle) {
  if (typeof handle !== 'string') throw new Error('Invalid job handle')
  const idx = handle.indexOf(SEP)
  // Split on the FIRST separator only — provider ids never contain ':' but
  // provider task ids sometimes do.
  if (idx <= 0 || idx === handle.length - 1) throw new Error('Invalid job handle')
  return { provider: handle.slice(0, idx), taskId: handle.slice(idx + 1) }
}
