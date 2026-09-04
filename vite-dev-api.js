import fs from 'node:fs'
import path from 'node:path'

// Dev-server bridge for the server-side generation API.
//
// The older plugins in vite.config.js re-implement their Vercel handlers by
// hand, which means dev and production can silently drift. This one imports
// the REAL handler from api/ and adapts Node's req/res to the Express-ish
// shape Vercel provides, so /api/generate behaves identically in both.

// Vercel injects environment variables into process.env for you. Vite does NOT
// — it only exposes VITE_-prefixed vars to *client* code via import.meta.env,
// and server-side middleware like this never sees .env at all. Without this,
// every generation in `npm run dev` fails with "KIE_API_KEY is not set" while
// the same code works perfectly in production, which is a genuinely confusing
// way to lose an afternoon.
function loadDotEnv() {
  const file = path.resolve(process.cwd(), '.env')
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
    if (!m) continue
    const [, key, rawValue] = m
    // Never clobber a variable that was already set in the real shell.
    if (process.env[key] !== undefined) continue
    process.env[key] = rawValue.replace(/^["']|["']$/g, '')
  }
}
loadDotEnv()

const ROUTES = {
  '/api/upload':   () => import('./api/upload.js'),
  '/api/generate': () => import('./api/generate.js'),
  '/api/status':   () => import('./api/status.js'),
  '/api/health':   () => import('./api/health.js'),
}

async function readJsonBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined
  const chunks = []
  for await (const c of req) chunks.push(c)
  const raw = Buffer.concat(chunks).toString()
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}

// Vercel's Node handlers expect res.status().json() — Node's ServerResponse
// has neither, so wrap it.
function adaptRes(res) {
  res.status = code => { res.statusCode = code; return res }
  res.json = obj => {
    if (!res.headersSent) res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(obj))
    return res
  }
  res.send = body => {
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : String(body))
    return res
  }
  return res
}

export const studioApiPlugin = {
  name: 'studio-api',
  configureServer(server) {
    for (const [route, load] of Object.entries(ROUTES)) {
      server.middlewares.use(route, async (req, res) => {
        try {
          const mod = await load()
          req.body = await readJsonBody(req)
          req.query = Object.fromEntries(new URLSearchParams((req.originalUrl || req.url).split('?')[1] || ''))
          await mod.default(req, adaptRes(res))
        } catch (e) {
          console.error(`[dev-api] ${route}:`, e)
          if (!res.headersSent) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
          }
          res.end(JSON.stringify({ error: e.message }))
        }
      })
    }
  },
}
