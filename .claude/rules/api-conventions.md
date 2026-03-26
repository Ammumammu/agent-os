# .claude/rules/api-conventions.md
# Serverless function patterns for api/*.js

## Standard Function Template
```js
// api/[name].js — [What it does]
// Actions: action1, action2, action3

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, ...p } = req.body;

  const actions = {
    actionName: async () => {
      // implementation
      return { result: 'data' };
    },
  };

  try {
    const actionFn = actions[action];
    if (!actionFn) return res.status(400).json({ error: `Unknown action: ${action}` });
    const result = await actionFn();
    // Handle both raw Response objects and plain objects
    if (result instanceof Response || typeof result?.json === 'function') {
      const data = await result.json();
      return res.status(result.ok ? 200 : result.status).json(data);
    }
    return res.status(200).json(result);
  } catch (e) {
    console.error(`[api/${action}] Error:`, e.message);
    return res.status(500).json({ error: e.message });
  }
}
```

## External API Calls (inside serverless functions)
- Use raw `fetch()` — serverless functions don't need fetchWithRetry (Vercel handles retries)
- EXCEPTION: agents calling `/api/*` DO need fetchWithRetry (GitHub Actions are less reliable)
- Always check `res.ok` before calling `res.json()`
- Set `Content-Type: application/x-www-form-urlencoded` for Stripe, `application/json` for everything else

## Stripe Patterns
```js
// Form encoding for Stripe
const qs = (obj) => new URLSearchParams(flattenForStripe(obj)).toString();
const sh = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' };

// Dedup pattern — always use createFull, not separate createProduct+createPrice
// createFull searches metadata[slug] before creating
await fetch('/api/stripe', { body: JSON.stringify({ action: 'createFull', slug, name, monthly_usd }) });
```

## GitHub Patterns
```js
// File content must be base64 encoded
content: Buffer.from(fileContent).toString('base64')

// To update a file, sha is required — always getFile first
const existing = await actions.getFile();
const { sha } = await existing.json();
await actions.pushFile({ ...params, sha });
```

## Vercel Deploy Pattern
```js
// 1. Create project (links to GitHub repo)
POST /v9/projects — { name, gitRepository: { type: 'github', repo: 'owner/repo' } }

// 2. Poll until deployment is live
GET /v6/deployments?projectId=X — check state === 'READY'

// 3. Max timeout: 120s for deployments (set in vercel.json maxDuration)
```

## Response Shape Conventions
```js
// Success
{ ...data, ok: true }

// Error
{ error: 'human-readable message', code: 'MACHINE_CODE' }

// Dedup (already exists)
{ ...existingData, reused: true }

// Skipped (demand score too low)
{ skipped: true, reason: 'demand_score_too_low', score: 6.2 }

// Build job (async pipeline)
{ jobId: 'slug-2026-03-26', phase: 'deploy', status: 'running', progress: 70 }
```

## Timeout Limits (vercel.json)
| Function | maxDuration |
|----------|-------------|
| api/build.js | 300s |
| api/deploy.js | 120s |
| api/*.js (all others) | 60s |

## Environment Variable Access
- Server-side only: `process.env.STRIPE_SECRET_KEY`, etc.
- Never pass secrets to the response body
- Log only: `Key loaded: ${KEY ? '✓' : '✗'}` — never the key value
