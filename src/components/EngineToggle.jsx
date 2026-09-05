import { useState } from 'react'
import { setEngine, getEngines } from '../utils/generationRouter'

// ── Inline engine toggle ─────────────────────────────────────────
//
// Sits next to a Generate button so the engine can be flipped without leaving
// the screen and losing the form. Settings holds the default; this is the
// per-generation override, and the two stay in sync because both write the
// same per-media preference.
//
// Why it belongs here rather than only in Settings: the realistic workflow is
// running the SAME inputs on both engines to compare them. Sending someone to
// another page and back to do that — with a form full of script, wardrobe and
// prop choices — turns a comparison into a chore.
//
// One component for photos and video so they can never drift apart in
// behaviour or appearance.

const OPTIONS = [
  { id: 'higgsfield', label: 'Higgsfield' },
  { id: 'kie',        label: 'kie.ai' },
  { id: 'apimart',    label: 'APIMart' },
]

const HINTS = {
  higgsfield: 'Runs on your own Higgsfield credits',
  kie:        'Runs on the app account — no login needed',
  apimart:    'Runs on the app account — unverified, test before relying on it',
}

export default function EngineToggle({ media = 'image', disabled = false, onChange }) {
  const [engine, setLocal] = useState(() => getEngines()[media])

  function pick(id) {
    if (disabled || id === engine) return
    setEngine(media, id)
    setLocal(id)
    onChange?.(id)
  }

  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      opacity: disabled ? 0.5 : 1,
    }}>
      <span style={{
        fontSize: 11, fontWeight: 600, letterSpacing: '0.4px',
        textTransform: 'uppercase', color: 'var(--text-tertiary)',
      }}>Engine</span>

      <div style={{
        display: 'inline-flex', padding: 2, borderRadius: 9,
        background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)',
      }}>
        {OPTIONS.map(opt => {
          const on = engine === opt.id
          return (
            <button
              key={opt.id}
              onClick={() => pick(opt.id)}
              disabled={disabled}
              title={HINTS[opt.id]}
              style={{
                padding: '5px 10px', borderRadius: 7, border: 'none',
                fontFamily: 'inherit', fontSize: 11.5, fontWeight: 700,
                cursor: disabled ? 'default' : 'pointer',
                background: on ? 'var(--surface)' : 'transparent',
                color: on ? '#8B5CF6' : 'var(--text-tertiary)',
                boxShadow: on ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
                transition: 'all 0.14s',
              }}
            >{opt.label}</button>
          )
        })}
      </div>
    </div>
  )
}
