// GET /api/health — deployment diagnostics.
//
// Reports whether required configuration is PRESENT, never what it contains.
// Existence and length only: enough to tell "not set" from "set but wrong",
// which is the difference between a Vercel settings problem and a typo, and
// impossible to determine from the outside otherwise.

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', 'no-store')

  const check = name => {
    const v = process.env[name]
    return v ? { set: true, length: v.length, endsWith: v.slice(-4) } : { set: false }
  }

  return res.status(200).json({
    ok: true,
    env: {
      KIE_API_KEY: check('KIE_API_KEY'),
      APP_ACCESS_TOKEN: check('APP_ACCESS_TOKEN'),
      BLOB_READ_WRITE_TOKEN: check('BLOB_READ_WRITE_TOKEN'),
      BLOB_STORE_ID: check('BLOB_STORE_ID'),
      VERCEL_OIDC_TOKEN: check('VERCEL_OIDC_TOKEN'),
    },
    // Which commit is actually running — catches a redeploy that silently
    // rebuilt an older commit.
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || null,
    branch: process.env.VERCEL_GIT_COMMIT_REF || null,
    vercelEnv: process.env.VERCEL_ENV || null,
    // Any BLOB_* variable at all — catches a store that was created but linked
    // under a different variable name than the code expects.
    blobVars: Object.keys(process.env).filter(k => k.includes('BLOB')),
  })
}
