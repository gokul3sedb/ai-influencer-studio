import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

const WORDS = ['Influencer', 'Creator', 'Avatar', 'Model', 'Icon']
const TYPE_SPEED = 75
const DELETE_SPEED = 45
const PAUSE_MS = 1800

function useTypewriter() {
  const [text, setText] = useState('')
  const [wordIdx, setWordIdx] = useState(0)
  const [phase, setPhase] = useState('typing')

  useEffect(() => {
    const word = WORDS[wordIdx]
    if (phase === 'typing') {
      if (text.length < word.length) {
        const t = setTimeout(() => setText(word.slice(0, text.length + 1)), TYPE_SPEED)
        return () => clearTimeout(t)
      } else {
        const t = setTimeout(() => setPhase('deleting'), PAUSE_MS)
        return () => clearTimeout(t)
      }
    }
    if (phase === 'deleting') {
      if (text.length > 0) {
        const t = setTimeout(() => setText(text.slice(0, -1)), DELETE_SPEED)
        return () => clearTimeout(t)
      } else {
        setWordIdx(i => (i + 1) % WORDS.length)
        setPhase('typing')
      }
    }
  }, [text, phase, wordIdx])

  return text
}

const ALL_IMGS = [
  '/inf/i1.png',  '/inf/i2.png',  '/inf/i3.jpg',  '/inf/i4.jpg',  '/inf/i5.png',
  '/inf/i6.jpg',  '/inf/i7.png',  '/inf/i8.png',  '/inf/i9.png',  '/inf/i10.png',
  '/inf/i11.png', '/inf/i12.png', '/inf/i13.png', '/inf/i14.png', '/inf/i15.png',
  '/inf/i16.png', '/inf/i17.png', '/inf/i18.png', '/inf/i19.png', '/inf/i20.png',
  '/inf/i21.png', '/inf/i22.png', '/inf/i23.png', '/inf/i24.png', '/inf/i25.png',
  '/inf/i26.png', '/inf/i27.png', '/inf/i28.png', '/inf/i29.png',
  '/inf/i30.png', '/inf/i31.png', '/inf/i32.png', '/inf/i33.png', '/inf/i34.png',
  '/inf/i35.png', '/inf/i36.png', '/inf/i37.png', '/inf/i38.png', '/inf/i39.png',
  '/inf/i40.png', '/inf/i41.png',
  '/inf/i42.png', '/inf/i43.png', '/inf/i44.png', '/inf/i45.png', '/inf/i46.png',
]

// A tidy marquee strip of cards along the bottom, plus two accent cards up top.
const CARDS = [
  { left: '-30px', top: '8%',  w: 150, rot: '-6deg', opacity: 0.55, period: 9,  sway: 12, delay: 0.0 },
  { right:'-30px', top: '6%',  w: 152, rot:  '7deg', opacity: 0.55, period: 10, sway: 13, delay: 0.5 },
  { left: '4%',    top: '70%', w: 134, rot: '-4deg', opacity: 0.40, period: 12, sway: 15, delay: 1.0 },
  { right:'4%',    top: '72%', w: 138, rot:  '5deg', opacity: 0.40, period: 11, sway: 14, delay: 1.6 },
]

export default function Landing() {
  const navigate = useNavigate()
  const animatedWord = useTypewriter()

  const [cardSrcs, setCardSrcs] = useState(() => ALL_IMGS.slice(0, CARDS.length))
  const [cardFade, setCardFade] = useState(() => CARDS.map(() => false))

  useEffect(() => {
    let alive = true
    function tick() {
      if (!alive) return
      const i = Math.floor(Math.random() * CARDS.length)
      setCardFade(prev => { const n = [...prev]; n[i] = true; return n })
      setTimeout(() => {
        if (!alive) return
        setCardSrcs(prev => {
          const options = ALL_IMGS.filter(s => s !== prev[i])
          const next = [...prev]
          next[i] = options[Math.floor(Math.random() * options.length)]
          return next
        })
        setCardFade(prev => { const n = [...prev]; n[i] = false; return n })
      }, 750)
    }
    const id = setInterval(tick, 2800)
    return () => { alive = false; clearInterval(id) }
  }, [])

  return (
    <div style={{
      minHeight: '100vh',
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'radial-gradient(120% 90% at 50% -10%, #16261f 0%, #0b0f0d 45%, #08090b 100%)',
      overflow: 'hidden',
      padding: 'calc(var(--nav-h) + 40px) 24px 80px',
      textAlign: 'center',
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    }}>

      {/* Soft ambient glow — emerald/amber, not the generic AI purple */}
      <div style={{ position:'absolute', width:820, height:820, top:'-26%', left:'-16%', borderRadius:'50%', background:'radial-gradient(circle, rgba(52,211,153,0.16) 0%, transparent 62%)', animation:'orb1 16s ease-in-out infinite', pointerEvents:'none' }}/>
      <div style={{ position:'absolute', width:640, height:640, top:'-10%', right:'-12%', borderRadius:'50%', background:'radial-gradient(circle, rgba(245,197,66,0.12) 0%, transparent 62%)', animation:'orb2 21s ease-in-out infinite', pointerEvents:'none' }}/>

      {/* Fine grid */}
      <div style={{ position:'absolute', inset:0, backgroundImage:'linear-gradient(rgba(255,255,255,0.028) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.028) 1px, transparent 1px)', backgroundSize:'48px 48px', pointerEvents:'none' }}/>

      {/* Floating cards */}
      {CARDS.map((card, i) => {
        const pos = {}
        if (card.left  !== undefined) pos.left  = card.left
        if (card.right !== undefined) pos.right = card.right
        return (
          <div
            key={i}
            className="landing-card"
            style={{
              position: 'absolute', top: card.top, ...pos, width: card.w,
              transform: `rotate(${card.rot})`, opacity: 0,
              '--target-opacity': card.opacity,
              animation: `cardAppear 1s ease ${card.delay + 0.2}s forwards`,
              pointerEvents: 'none', zIndex: 0,
            }}
          >
            <div style={{
              animation: `cardFloat ${card.period}s ease-in-out ${card.delay}s infinite, cardSway ${card.sway}s ease-in-out ${card.delay * 0.7}s infinite`,
              borderRadius: 14, overflow: 'hidden',
              boxShadow: '0 24px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.07)',
              opacity: cardFade[i] ? 0 : 1, transition: 'opacity 0.75s ease',
            }}>
              <img src={cardSrcs[i]} alt="" style={{ width:'100%', aspectRatio:'2/3', objectFit:'cover', display:'block' }}/>
              <div style={{ position:'absolute', inset:0, background:'linear-gradient(to top, rgba(8,9,11,0.5) 0%, transparent 55%)' }}/>
            </div>
          </div>
        )
      })}

      {/* Vignette */}
      <div style={{ position:'absolute', inset:0, background:'radial-gradient(ellipse at 50% 45%, transparent 32%, rgba(8,9,11,0.85) 100%)', pointerEvents:'none', zIndex:1 }}/>

      {/* ── Center content ── */}
      <div style={{ maxWidth: 720, position: 'relative', zIndex: 2 }}>

        {/* Eyebrow (no attribution) */}
        <div style={{
          display:'inline-flex', alignItems:'center', gap:9,
          color:'rgba(52,211,153,0.9)', fontSize:12, fontWeight:600,
          letterSpacing:'2.5px', textTransform:'uppercase', marginBottom:34,
        }}>
          <span style={{ width:22, height:1, background:'rgba(52,211,153,0.5)' }}/>
          AI Influencer Studio
          <span style={{ width:22, height:1, background:'rgba(52,211,153,0.5)' }}/>
        </div>

        <h1 style={{ fontSize:'clamp(56px,9.5vw,100px)', fontWeight:800, letterSpacing:'-3px', lineHeight:1.02, color:'#f4f1ea', marginBottom:4 }}>
          Create Your
        </h1>

        <div style={{
          fontSize:'clamp(56px,9.5vw,100px)', fontWeight:800, letterSpacing:'-3px', lineHeight:1.1,
          minHeight:'1.15em', display:'flex', alignItems:'center', justifyContent:'center', marginBottom:34,
        }}>
          <span style={{ background:'linear-gradient(120deg, #34D399 0%, #A7F3D0 45%, #F5C542 100%)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text' }}>
            {animatedWord}
          </span>
          <span style={{ display:'inline-block', width:4, height:'0.72em', background:'#34D399', marginLeft:7, borderRadius:2, animation:'blink 1s step-end infinite', verticalAlign:'middle', flexShrink:0 }}/>
        </div>

        <p style={{ fontSize:19, color:'rgba(244,241,234,0.5)', lineHeight:1.7, margin:'0 auto 48px', maxWidth:440, fontWeight:400 }}>
          Design a consistent AI persona, dress them in any outfit, and grow your presence — all in one studio.
        </p>

        <button
          onClick={() => navigate('/create')}
          style={{
            padding:'16px 54px', borderRadius:14,
            background:'linear-gradient(135deg, #34D399 0%, #10B981 100%)',
            color:'#052e21', fontSize:16, fontWeight:700, letterSpacing:'-0.2px',
            boxShadow:'0 0 34px rgba(52,211,153,0.35), 0 6px 22px rgba(0,0,0,0.45)',
            transition:'transform 0.18s, box-shadow 0.18s', border:'none', cursor:'pointer',
          }}
          onMouseEnter={e => { e.currentTarget.style.transform='translateY(-2px)'; e.currentTarget.style.boxShadow='0 0 54px rgba(52,211,153,0.5), 0 10px 30px rgba(0,0,0,0.45)' }}
          onMouseLeave={e => { e.currentTarget.style.transform='translateY(0)'; e.currentTarget.style.boxShadow='0 0 34px rgba(52,211,153,0.35), 0 6px 22px rgba(0,0,0,0.45)' }}
        >
          Get Started  →
        </button>

        <div style={{ marginTop:22, fontSize:13, color:'rgba(244,241,234,0.3)', letterSpacing:'0.2px' }}>
          No sign-up required · your data stays in your browser
        </div>
      </div>

      <style>{`
        @keyframes blink { 0%,100% { opacity:1; } 50% { opacity:0; } }
        @keyframes orb1 { 0%,100% { transform:translate(0,0) scale(1); } 40% { transform:translate(50px,-40px) scale(1.08); } 70% { transform:translate(-30px,34px) scale(0.94); } }
        @keyframes orb2 { 0%,100% { transform:translate(0,0) scale(1); } 50% { transform:translate(-42px,50px) scale(1.1); } }
        @keyframes cardFloat { 0%,100% { transform:translateY(0px); } 50% { transform:translateY(-16px); } }
        @keyframes cardSway { 0%,100% { transform:translateX(0px); } 25% { transform:translateX(5px); } 75% { transform:translateX(-4px); } }
        @keyframes cardAppear { from { opacity:0; } to { opacity:var(--target-opacity,0.5); } }
        .landing-card { display:block; }
        @media (max-width:860px) { .landing-card { display:none; } }
      `}</style>
    </div>
  )
}
