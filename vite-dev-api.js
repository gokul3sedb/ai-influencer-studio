// Dev-server bridge for the server-side generation API.
//
// The older plugins in vite.config.js re-implement their Vercel handlers by
// hand, which means dev and production can silently drift. This one imports
// the REAL handler from api/ and adapts Node's req/res to the Express-ish
// shape Vercel provides, so /api/generate behaves identically in both.

const ROUTES = {
  '/api/upload':   () => import('./api/upload.js'),
  '/api/generate': () => import('./api/generate.js'),
  '/api/status':   () => import('./api/status.js'),
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
