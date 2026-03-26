# agent_docs/ENVIRONMENT.md — Agent OS v7
# Complete environment variable reference. Every secret, where it lives, and what breaks without it.
# Last updated: 2026-03-26

---

## Security Classification

| Zone | Who can read | Where to store |
|------|-------------|----------------|
| SERVER-ONLY | Vercel serverless functions + GitHub Actions | Vercel env dashboard + GitHub Secrets |
| BROWSER-SAFE | `index.html` ENV object | Hardcoded in HTML (not in git — use CLAUDE.local.md) |
| GITIGNORED | Local machine only | `.env` file (never commit) |

**Rule:** If a key prefix is `sk_`, `ghp_`, `vcp_`, `eyJ...` (service role), or `re_` — it's SERVER-ONLY.
**Rule:** If losing the key means losing $0 in revenue (read-only or write-only to non-sensitive data) — it can be BROWSER-SAFE.

---

## Server-Side Secrets (Vercel Environment Variables)

Set these in: Vercel Dashboard → Project Settings → Environment Variables → Production

| Variable | Service | How to get | Impact if missing |
|----------|---------|-----------|------------------|
| `GITHUB_TOKEN` | GitHub | Settings → Developer Settings → PATs (Classic) → repo + workflow scopes | `/api/github` returns 401. No repos created, no files pushed. |
| `VERCEL_API_KEY` | Vercel | Account Settings → Tokens | `/api/deploy` fails. Products can't be deployed. |
| `STRIPE_SECRET_KEY` | Stripe | Dashboard → Developers → API Keys → Secret key | `/api/stripe` returns 401. No payment links created. |
| `STRIPE_WEBHOOK_SECRET` | Stripe | Dashboard → Webhooks → Signing secret | `/api/webhook/stripe` rejects all events. Revenue not recorded. |
| `SUPABASE_SERVICE_KEY` | Supabase | Project → Settings → API → service_role key | Server-side Supabase reads fail. Agent state tracking broken. |
| `RESEND_API_KEY` | Resend | resend.com → API Keys | `/api/email` fails. No lead nurture emails sent. |
| `GUMROAD_ACCESS_TOKEN` | Gumroad | gumroad.com → Settings → Advanced → Generate | `/api/gumroad` fails. One-time payment fallback unavailable. |
| `DEVTO_API_KEY` | Dev.to | dev.to → Settings → Account → DEV Community API Keys | `/api/devto` + `/api/publish` fail. Auto-blogging disabled. |
| `HASHNODE_TOKEN` | Hashnode | hashnode.com → Account Settings → Developer | `/api/hashnode` fails. Hashnode auto-post disabled. |
| `HASHNODE_PUBLICATION_ID` | Hashnode | hashnode.com → Your Blog → Settings → General (ID in URL) | Hashnode posts publish to wrong blog. |
| `POSTHOG_PERSONAL_API_KEY` | PostHog | app.posthog.com → Settings → Personal API Keys | `/api/posthog` fails. Analytics tab shows no data. |
| `PH_TOKEN` | ProductHunt | producthunt.com/v2/oauth/applications | `/api/ph` fails. ProductHunt trending disabled. |
| `GROQ_API_KEY` | Groq | console.groq.com → API Keys | All content generation fails. Build pipeline can't generate specs or copy. |

**Note on GROQ_API_KEY:** This is also in the browser ENV object. Server-side is needed for agents (GitHub Actions).

---

## GitHub Actions Secrets

Set these in: GitHub repo → Settings → Secrets and variables → Actions → New repository secret

| Secret | Maps to | Notes |
|--------|---------|-------|
| `DASHBOARD_URL` | `https://[your-dashboard].vercel.app` | Agents call this to reach `/api/*` endpoints |
| `GROQ_API_KEY` | Same as Vercel GROQ_API_KEY | Agents use this directly for Groq calls |
| `SLACK_WEBHOOK_URL` | Slack Incoming Webhooks | Required for `lib/alert.js` to send failure alerts |

**If `DASHBOARD_URL` is wrong:** All agents will fail silently (HTTP errors, no Slack alert until alert.js also fails).
**Verify:** After setting, trigger `market-agent.js` manually from GitHub Actions UI and confirm it completes.

---

## Browser-Safe Keys (in `index.html` ENV object)

These live in the `const ENV = { ... }` block in `index.html`. They are visible to anyone who views page source — only use keys that are safe to expose.

| Variable | Service | Security notes |
|----------|---------|---------------|
| `ANTHROPIC_API_KEY` | Anthropic | Requires `anthropic-dangerous-direct-browser-access: true` header. Rate-limited by key. Monitor usage — anyone with the URL can run Sonnet calls. |
| `GROQ_API_KEY` | Groq | CORS-enabled, free tier. Low risk. Worst case: someone burns your daily token limit. |
| `GEMINI_API_KEY` | Google Gemini | CORS-enabled, free tier. Used for embeddings only. |
| `PINECONE_API_KEY` | Pinecone | CORS-enabled. Can read/write vectors. Low-sensitivity data. |
| `PINECONE_HOST` | Pinecone | Your index host URL. |
| `YOUTUBE_API_KEY` | YouTube Data API | Read-only. 10,000 units/day free. |
| `POSTHOG_WRITE_KEY` | PostHog | Write-only (event tracking). Safe to expose. |
| `SUPABASE_URL` | Supabase | Public URL. Always exposed. |
| `SUPABASE_ANON_KEY` | Supabase | Anon key with RLS. Safe ONLY if RLS policies are correct on all tables. |
| `OWNER_EMAIL` | Email | Used for viral attribution. Not sensitive. |
| `GITHUB_USERNAME` | GitHub | Public. Used to construct repo URLs. |

**Critical:** Never put `GITHUB_TOKEN`, `STRIPE_SECRET_KEY`, or `SUPABASE_SERVICE_KEY` in the browser ENV object.

---

## `.env` File (Local Development Only — Never Commit)

```bash
# Copy this to .env and fill in your values
# This file is gitignored. Never commit it.

# Server-side (same as Vercel env vars)
GITHUB_TOKEN=github_pat_...
VERCEL_API_KEY=vcp_...
STRIPE_SECRET_KEY=sk_test_...        # use sk_test_ locally, sk_live_ in Vercel prod
STRIPE_WEBHOOK_SECRET=whsec_...
SUPABASE_SERVICE_KEY=eyJ...
RESEND_API_KEY=re_...
GUMROAD_ACCESS_TOKEN=...
DEVTO_API_KEY=...
HASHNODE_TOKEN=...
HASHNODE_PUBLICATION_ID=...
POSTHOG_PERSONAL_API_KEY=phx_...
GROQ_API_KEY=gsk_...
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
DASHBOARD_URL=http://localhost:3000  # for local agent testing

# Not needed in .env — these go in index.html ENV object directly
# ANTHROPIC_API_KEY, GEMINI_API_KEY, PINECONE_API_KEY, POSTHOG_WRITE_KEY, etc.
```

---

## Environment Verification

Run this to check all required server-side env vars are set:
```bash
curl https://[your-dashboard-url]/api/health | jq .checks
```

Expected response:
```json
{
  "env": { "ok": true, "details": { "github": true, "stripe": true, "groq": true, "supabase": true } },
  "groq": { "ok": true, "status": 200 },
  "stripe": { "ok": true, "status": 200 },
  "supabase": { "ok": true, "status": 200 }
}
```

If any check is `false`: the corresponding env var is missing or wrong in Vercel dashboard.

---

## Staging vs Production

| Key | Local | Vercel Production |
|-----|-------|------------------|
| `STRIPE_SECRET_KEY` | `sk_test_...` | `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | Local webhook CLI secret | Production webhook secret |
| `SUPABASE_SERVICE_KEY` | Dev project key | Production project key |
| `DASHBOARD_URL` | `http://localhost:3000` | `https://[your-project].vercel.app` |

**Never mix test and live Stripe keys.** A test key on production means no real payments. A live key locally means real charges from smoke tests.
