import { useState, useMemo, useEffect } from 'react'
import { useInfluencers } from '../store'
import { generate, JOB_TYPES } from '../utils/studioApi'

// ── Studio ───────────────────────────────────────────────────────
//
// The first page running on the server-side generation stack. Deliberately
// standalone rather than a rewrite of an existing page: it proves the whole
// loop end-to-end (character -> server prompt -> provider -> images) without
// touching Create.jsx or the 6,000-line Influencers.jsx.
//
// Note what is absent: no prompt building, no model names, no provider names,
// no API keys. This page sends a character and a job type and receives URLs.
// Everything that used to make the browser the weak point now lives on the server.

const JOB_LABELS = [
  { id: JOB_TYPES.SCENE_PHOTO,     label: 'Scene photo',      hint: 'Full quality — the workhorse' },
  { id: JOB_TYPES.FAST_ITERATION,  label: 'Fast draft',       hint: 'Lower res, quicker, cheaper' },
  { id: JOB_TYPES.CHARACTER_SHEET, label: 'Character sheet',  hint: 'Four-panel turnaround' },
]

const card = {
  background: 'var(--surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 16,
  padding: 20,
  marginBottom: 16,
}

const label = { fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }

export default function Studio() {
  const [influencers] = useInfluencers()
  const [selectedId, setSelectedId] = useState(null)
  const [jobType, setJobType] = useState(JOB_TYPES.SCENE_PHOTO)
  const [count, setCount] = useState(2)
  const [sceneIntent, setSceneIntent] = useState('')
  const [busy, setBusy] = useState(false)
  const [jobs, setJobs] = useState([])
  const [urls, setUrls] = useState([])
  const [error, setError] = useState(null)
  const [tokenMissing, setTokenMissing] = useState(false)

  useEffect(() => {
    try { setTokenMissing(!localStorage.getItem('app_token')) } catch { setTokenMissing(true) }
  }, [])

  const selected = useMemo(
    () => influencers.find(i => i.id === selectedId) || influencers[0] || null,
    [influencers, selectedId],
  )

  async function run() {
    if (!selected) return
    setBusy(true); setError(null); setUrls([]); setJobs([])
    try {
      const { urls: out } = await generate({
        jobType,
        // Send the whole record and let the server pick what it needs — the
        // field mapping lives in lib/prompt/index.js, not here.
        character: selected,
        options: { count, aspectRatio: '9:16', sceneIntent: sceneIntent.trim() || null },
      }, { onUpdate: setJobs })
      setUrls(out)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const done = jobs.filter(j => j.state === 'succeeded').length

  return (
    <div style={{ paddingTop: 'var(--nav-h)', minHeight: '100vh', background: 'var(--bg)' }}>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px' }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.5px', marginBottom: 6 }}>Studio</h1>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 28 }}>
          Server-side generation. No Higgsfield connection needed.
        </p>

        {tokenMissing && (
          <div style={{ ...card, borderColor: '#F59E0B', background: 'rgba(245,158,11,0.08)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Access token not set</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              Open the browser console and run:<br />
              <code style={{ display: 'inline-block', marginTop: 6, padding: '4px 8px', background: 'var(--bg-tertiary)', borderRadius: 6, fontSize: 12 }}>
                localStorage.setItem('app_token', 'YOUR_APP_ACCESS_TOKEN')
              </code>
            </div>
          </div>
        )}

        {!influencers.length ? (
          <div style={card}>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
              No influencers yet — create one first, then come back.
            </div>
          </div>
        ) : (
          <>
            <div style={card}>
              <div style={label}>Character</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {influencers.map(inf => {
                  const on = selected?.id === inf.id
                  return (
                    <button key={inf.id} onClick={() => setSelectedId(inf.id)} style={{
                      display: 'flex', alignItems: 'center', gap: 9,
                      padding: '8px 14px 8px 8px', borderRadius: 999, cursor: 'pointer',
                      border: `1.5px solid ${on ? '#8B5CF6' : 'var(--border)'}`,
                      background: on ? 'rgba(139,92,246,0.09)' : 'var(--bg)',
                      color: on ? '#8B5CF6' : 'var(--text-secondary)',
                      fontWeight: 600, fontSize: 13, fontFamily: 'inherit',
                    }}>
                      {inf.mainImage
                        ? <img src={inf.mainImage} alt="" style={{ width: 26, height: 26, borderRadius: '50%', objectFit: 'cover' }} />
                        : <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--bg-tertiary)' }} />}
                      {inf.name || 'Unnamed'}
                    </button>
                  )
                })}
              </div>
            </div>

            <div style={card}>
              <div style={label}>Type</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
                {JOB_LABELS.map(j => {
                  const on = jobType === j.id
                  return (
                    <button key={j.id} onClick={() => setJobType(j.id)} style={{
                      flex: '1 1 180px', padding: '12px 14px', borderRadius: 12, cursor: 'pointer', textAlign: 'left',
                      border: `1.5px solid ${on ? '#8B5CF6' : 'var(--border)'}`,
                      background: on ? 'rgba(139,92,246,0.09)' : 'var(--bg)',
                      fontFamily: 'inherit',
                    }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: on ? '#8B5CF6' : 'var(--text-primary)' }}>{j.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>{j.hint}</div>
                    </button>
                  )
                })}
              </div>

              <div style={label}>How many</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                {[1, 2, 3, 4].map(n => (
                  <button key={n} onClick={() => setCount(n)} style={{
                    width: 44, height: 40, borderRadius: 10, cursor: 'pointer', fontWeight: 700, fontSize: 14, fontFamily: 'inherit',
                    border: `1.5px solid ${count === n ? '#8B5CF6' : 'var(--border)'}`,
                    background: count === n ? 'rgba(139,92,246,0.09)' : 'var(--bg)',
                    color: count === n ? '#8B5CF6' : 'var(--text-secondary)',
                  }}>{n}</button>
                ))}
              </div>

              <div style={label}>Direction (optional)</div>
              <input
                value={sceneIntent}
                onChange={e => setSceneIntent(e.target.value)}
                placeholder="e.g. walking to a morning class, holding a coffee"
                style={{
                  width: '100%', padding: '11px 14px', borderRadius: 10, fontSize: 14, fontFamily: 'inherit',
                  border: '1.5px solid var(--border)', background: 'var(--bg)', color: 'var(--text-primary)', outline: 'none',
                }}
              />
            </div>

            <button onClick={run} disabled={busy || !selected} style={{
              width: '100%', padding: '15px', borderRadius: 12, fontSize: 15, fontWeight: 700, fontFamily: 'inherit',
              cursor: busy ? 'default' : 'pointer', border: 'none',
              background: busy ? 'var(--bg-tertiary)' : '#8B5CF6',
              color: busy ? 'var(--text-tertiary)' : '#fff',
            }}>
              {busy
                ? (jobs.length ? `Generating… ${done}/${jobs.length} done` : 'Starting…')
                : `Generate ${count} ${count === 1 ? 'image' : 'images'}`}
            </button>

            {error && (
              <div style={{ ...card, marginTop: 16, borderColor: '#FF3B30', background: 'rgba(255,59,48,0.07)' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#FF3B30', marginBottom: 4 }}>Generation failed</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{error}</div>
              </div>
            )}

            {!!urls.length && (
              <div style={{ marginTop: 24 }}>
                <div style={{ ...label, marginBottom: 12 }}>Results</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
                  {urls.map((u, i) => (
                    <a key={i} href={u} target="_blank" rel="noreferrer"
                       style={{ display: 'block', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border-subtle)', background: 'var(--bg-tertiary)' }}>
                      <img src={u} alt="" style={{ width: '100%', display: 'block' }} />
                    </a>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 12 }}>
                  These links expire after 24 hours — download anything worth keeping.
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
