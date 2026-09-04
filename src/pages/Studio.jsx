import { useState, useMemo, useEffect } from 'react'
import { useInfluencers, generateId } from '../store'
import { generate, JOB_TYPES, PROVIDERS, isHiggsfieldAvailable } from '../utils/studioApi'

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

const input = {
  width: '100%', padding: '11px 14px', borderRadius: 10, fontSize: 14, fontFamily: 'inherit',
  border: '1.5px solid var(--border)', background: 'var(--bg)', color: 'var(--text-primary)', outline: 'none',
}

const PROVIDER_CHOICES = [
  { id: PROVIDERS.AUTO,       label: 'Auto',       hint: 'Cheapest first' },
  { id: PROVIDERS.KIE,        label: 'kie.ai',     hint: 'Billed to the app' },
  { id: PROVIDERS.HIGGSFIELD, label: 'Higgsfield', hint: 'Your own credits' },
]

const BLANK_CHARACTER = {
  name: '', gender: 'Female', age: '', physicalDesc: '', backstory: '', niche: '', introExtrovert: 50,
}

export default function Studio() {
  const [influencers, setInfluencers] = useInfluencers()
  const [mode, setMode] = useState('existing')          // 'existing' | 'new'
  const [selectedId, setSelectedId] = useState(null)
  const [draft, setDraft] = useState(BLANK_CHARACTER)
  const [provider, setProvider] = useState(PROVIDERS.AUTO)
  const [jobType, setJobType] = useState(JOB_TYPES.SCENE_PHOTO)
  const [count, setCount] = useState(2)
  const [sceneIntent, setSceneIntent] = useState('')
  const [busy, setBusy] = useState(false)
  const [jobs, setJobs] = useState([])
  const [urls, setUrls] = useState([])
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(null)
  const [tokenMissing, setTokenMissing] = useState(false)
  const [hfReady, setHfReady] = useState(false)

  useEffect(() => {
    try { setTokenMissing(!localStorage.getItem('app_token')) } catch { setTokenMissing(true) }
    setHfReady(isHiggsfieldAvailable())
  }, [])

  const selected = useMemo(
    () => influencers.find(i => i.id === selectedId) || influencers[0] || null,
    [influencers, selectedId],
  )

  // In 'new' mode the character exists only in this form until it is saved —
  // generation does not require it to be in the store first.
  const character = mode === 'new' ? draft : selected
  const effectiveJobType = mode === 'new' ? JOB_TYPES.CHARACTER_SHEET : jobType
  const canRun = mode === 'new'
    ? draft.physicalDesc.trim().length > 3
    : !!selected

  async function run() {
    if (!canRun) return
    setBusy(true); setError(null); setUrls([]); setJobs([]); setSaved(null)
    try {
      const { urls: out } = await generate({
        jobType: effectiveJobType,
        // Send the whole record and let the server pick what it needs — the
        // field mapping lives in lib/prompt/index.js, not here.
        character,
        options: {
          count: mode === 'new' ? 1 : count,
          aspectRatio: '9:16',
          sceneIntent: sceneIntent.trim() || null,
          provider,
        },
      }, { onUpdate: setJobs })
      setUrls(out)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  // Persist a freshly generated character so it becomes selectable like any
  // other. Uses the same store as every existing page — nothing bespoke.
  function saveCharacter() {
    const inf = {
      ...draft,
      id: generateId(),
      age: Number(draft.age) || undefined,
      createdAt: Date.now(),
      mainImage: urls[0] || null,
      characterSheetImage: urls[0] || null,
      generationHistory: [],
    }
    setInfluencers(list => [...list, inf])
    setSaved(inf.name || 'Character')
    setMode('existing')
    setSelectedId(inf.id)
  }

  const done = jobs.filter(j => j.state === 'succeeded').length

  return (
    <div style={{ paddingTop: 'var(--nav-h)', minHeight: '100vh', background: 'var(--bg)' }}>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px' }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.5px', marginBottom: 6 }}>Studio</h1>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 20 }}>
          Server-side generation. Prompts are built on the server, never in your browser.
        </p>

        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          {[['existing', 'Use a character'], ['new', 'New character']].map(([id, text]) => {
            const on = mode === id
            return (
              <button key={id} onClick={() => { setMode(id); setUrls([]); setError(null); setSaved(null) }} style={{
                padding: '9px 18px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit',
                fontWeight: 700, fontSize: 13,
                border: `1.5px solid ${on ? '#8B5CF6' : 'var(--border)'}`,
                background: on ? 'rgba(139,92,246,0.09)' : 'var(--bg)',
                color: on ? '#8B5CF6' : 'var(--text-secondary)',
              }}>{text}</button>
            )
          })}
        </div>

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

        {mode === 'existing' && !influencers.length ? (
          <div style={card}>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
              No characters yet — switch to <strong>New character</strong> above to build one from scratch.
            </div>
          </div>
        ) : (
          <>
            {mode === 'new' ? (
              <div style={card}>
                <div style={label}>Define the character</div>

                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
                  <input style={input} placeholder="Name" value={draft.name}
                         onChange={e => setDraft({ ...draft, name: e.target.value })} />
                  <select style={input} value={draft.gender}
                          onChange={e => setDraft({ ...draft, gender: e.target.value })}>
                    <option>Female</option><option>Male</option>
                  </select>
                  <input style={input} placeholder="Age" inputMode="numeric" value={draft.age}
                         onChange={e => setDraft({ ...draft, age: e.target.value })} />
                </div>

                <textarea
                  style={{ ...input, minHeight: 74, resize: 'vertical', marginBottom: 12 }}
                  placeholder="Physical description — the more specific, the more consistent she stays. e.g. Latina, medium-length wavy brunette hair with side-swept bangs, brown eyes, olive skin tone, slim athletic build"
                  value={draft.physicalDesc}
                  onChange={e => setDraft({ ...draft, physicalDesc: e.target.value })}
                />

                <textarea
                  style={{ ...input, minHeight: 60, resize: 'vertical', marginBottom: 12 }}
                  placeholder="Backstory / job — drives wardrobe and location. e.g. Pilates instructor who moved into fashion content"
                  value={draft.backstory}
                  onChange={e => setDraft({ ...draft, backstory: e.target.value })}
                />

                <input style={{ ...input, marginBottom: 16 }} placeholder="Niche — e.g. Fashion, Fitness, Travel"
                       value={draft.niche} onChange={e => setDraft({ ...draft, niche: e.target.value })} />

                <div style={{ ...label, marginBottom: 6 }}>
                  Personality — {draft.introExtrovert < 30 ? 'reserved' : draft.introExtrovert < 60 ? 'balanced' : 'outgoing'}
                </div>
                <input type="range" min="0" max="100" value={draft.introExtrovert}
                       onChange={e => setDraft({ ...draft, introExtrovert: Number(e.target.value) })}
                       style={{ width: '100%', accentColor: '#8B5CF6' }} />
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 6 }}>
                  Drives pose and wardrobe selection on the server.
                </div>
              </div>
            ) : (
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
            )}

            <div style={card}>
              <div style={label}>Engine</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {PROVIDER_CHOICES.map(pc => {
                  const on = provider === pc.id
                  // Higgsfield spends the user's own credits, so it is only
                  // offered once they have actually connected their account.
                  const blocked = pc.id === PROVIDERS.HIGGSFIELD && !hfReady
                  return (
                    <button key={pc.label} onClick={() => !blocked && setProvider(pc.id)} disabled={blocked} style={{
                      flex: '1 1 150px', padding: '11px 14px', borderRadius: 12, textAlign: 'left', fontFamily: 'inherit',
                      cursor: blocked ? 'not-allowed' : 'pointer', opacity: blocked ? 0.45 : 1,
                      border: `1.5px solid ${on ? '#8B5CF6' : 'var(--border)'}`,
                      background: on ? 'rgba(139,92,246,0.09)' : 'var(--bg)',
                    }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: on ? '#8B5CF6' : 'var(--text-primary)' }}>{pc.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                        {blocked ? 'Connect in Settings' : pc.hint}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {mode === 'existing' && (
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
            )}

            <button onClick={run} disabled={busy || !canRun} style={{
              width: '100%', padding: '15px', borderRadius: 12, fontSize: 15, fontWeight: 700, fontFamily: 'inherit',
              cursor: busy ? 'default' : 'pointer', border: 'none',
              background: busy ? 'var(--bg-tertiary)' : '#8B5CF6',
              color: busy ? 'var(--text-tertiary)' : '#fff',
            }}>
              {busy
                ? (jobs.length ? `Generating… ${done}/${jobs.length} done` : 'Starting…')
                : mode === 'new'
                  ? 'Generate character sheet'
                  : `Generate ${count} ${count === 1 ? 'image' : 'images'}`}
            </button>

            {saved && (
              <div style={{ ...card, marginTop: 16, borderColor: '#10B981', background: 'rgba(16,185,129,0.08)' }}>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  Saved <strong>{saved}</strong> — now selectable above, and ready for scene photos.
                </div>
              </div>
            )}

            {error && (
              <div style={{ ...card, marginTop: 16, borderColor: '#FF3B30', background: 'rgba(255,59,48,0.07)' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#FF3B30', marginBottom: 4 }}>Generation failed</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{error}</div>
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

                {mode === 'new' && !saved && (
                  <button onClick={saveCharacter} style={{
                    marginTop: 16, width: '100%', padding: '14px', borderRadius: 12,
                    fontSize: 14, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
                    border: '1.5px solid #10B981', background: 'rgba(16,185,129,0.1)', color: '#10B981',
                  }}>
                    Save “{draft.name || 'this character'}” to my characters
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
