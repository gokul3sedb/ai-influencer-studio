# Project context for Claude Code

This file gives a new Claude Code session enough context to be useful
immediately. Read this first before making changes.

## What this app is

A React+Vite single-page app for designing and generating AI influencers.
Local-first: every user's data lives in their own browser localStorage.
Image and video generation happens through the user's own Higgsfield
account (OAuth, PKCE).

## Tech stack

- **React 18** + **Vite 5** + **React Router 6**
- **No build-time API keys** — Higgsfield is OAuthed per-user; the optional
  Claude features call through a serverless proxy that expects an
  `x-api-key` header from the browser.
- **Vercel** is the intended host: `api/*.js` are Vercel serverless
  functions, and `vite.config.js` mirrors them as local dev proxies so
  the dev server behaves the same as production.

## Key files to know

| Path | What it does |
|---|---|
| `src/App.jsx` | Routes + `<ThemeProvider>` + `<StoreProvider>` |
| `src/store.jsx` | localStorage-backed contexts (`useInfluencers`, etc.) and the `Kayla` seed |
| `src/utils/higgsfieldAuth.js` | OAuth PKCE flow against `mcp.higgsfield.ai` |
| `src/utils/higgsfieldGenerate.js` | MCP-style image/video generation, polling, media uploads |
| `src/utils/systemPrompt.js` | Prompt templates — poses, wardrobe library, vibe palettes, Soul vs GPT Image 2 variants |
| `src/pages/Create.jsx` | Multi-step influencer creation wizard |
| `src/pages/Influencers.jsx` | Influencer profile + Content Studio + Video Studio (very large — known structural debt) |
| `api/hf/[...path].js` | Edge function that proxies all Higgsfield MCP traffic and forwards SSE streams |
| `api/claude.js` | Anthropic API proxy — caller supplies their own `x-api-key` |

## Conventions

- Inline styles with CSS variables (`var(--bg)`, `var(--text-primary)`).
  Theme tokens are set on `<html data-theme="dark|light">` from
  `src/context/theme.jsx`.
- IDs use `generateId()` from `store.jsx` (`Date.now() + random`).
- Higgsfield models supported: `soul_2`, `gpt_image_2`, `nano_banana_2`,
  `nano_banana_flash`, `seedance_2_0`. Soul has its own simplified
  pose set (`POSES_SOUL`) because it struggles with detailed spatial pose
  instructions.

## Things not to do

- **Never kill the Vite dev server** (port 5173). The owner wants it
  running at all times.
- Don't trust the comment in `modelBaseParams` saying resolution and
  quality conflict for `gpt_image_2` — they don't, the working code
  intentionally passes both.
- Don't refactor `Influencers.jsx` casually. It's 4,700+ lines and the
  state is tangled; any split needs its own dedicated session with
  in-browser verification of every flow.

## Dev workflow

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # production build
npm run preview      # preview the production build locally
```

To diagnose Higgsfield issues, flip `HF_DEBUG = true` at the top of
`src/utils/higgsfieldGenerate.js` for verbose request/response logs.

## Server-side generation stack (added 2026-09)

The app is mid-migration from browser-side generation to a server-side one.
**Both paths currently work.** Nothing below has replaced anything yet.

| Path | Status |
|---|---|
| Higgsfield via browser OAuth (`src/utils/higgsfield*.js`) | Live, untouched, still the one the UI uses |
| Server-side via kie.ai (`api/generate.js`) | Built and tested, not yet wired into any page |

### Why it exists
1. The prompt library (119 outfits, 100 archetypes) shipped in the client
   bundle — anyone could read it in devtools. Server-side prompting makes it private.
2. Higgsfield charged per-user credits, so there was no margin to take. Server-held
   keys mean we pay wholesale and can price the output.
3. A single undocumented MCP endpoint was a single point of failure.

### Layout
```
lib/providers/contract.js   Adapter interface + shared HTTP/retry + STATE enum
lib/providers/kie.js        kie.ai adapter (upload, image, video, status)
lib/providers/wavespeed.js  SCAFFOLD ONLY — deliberately throws, see file header
lib/providers/index.js      Registry. Higgsfield intentionally absent (see file)
lib/routing.js              Job type -> ordered model candidates. EDIT PRICES HERE.
lib/prompt/                 Server-side copy of the prompt engine
lib/jobs.js                 "<provider>:<taskId>" handle encode/decode
lib/auth.js                 Shared-secret gate — REQUIRED in production
api/upload.js               One data URL -> hosted URL
api/generate.js             Build prompt + dispatch -> job handles (returns immediately)
api/status.js               Poll many handles in one request
src/utils/studioApi.js      Client for the above (upload, start, poll)
scripts/verify-models.mjs   Checks every routing.js slug against the live API
```

### Required env
`KIE_API_KEY` and `APP_ACCESS_TOKEN` (see `.env.example`). Without the access
token in production, `/api/generate` is an open tap on the billing account —
`lib/auth.js` fails closed to prevent that.

### Known gaps
- Image model slugs in `lib/routing.js` are **unverified**. Run
  `node scripts/verify-models.mjs` before production use. Video slugs are confirmed.
- kie.ai deletes uploads and expires result URLs after **24 hours**. It is a
  generator, not storage — anything a user keeps must be copied to our own bucket.
- `src/utils/systemPrompt.js` is now DEPRECATED but still present and still used
  by the client pages. Until it is deleted the library still ships to the browser.
- Video prompt logic in `src/pages/Influencers.jsx` has not been ported;
  `lib/prompt/index.js` has a simpler placeholder builder.
- The access gate is one shared secret. It cannot meter or attribute usage.

