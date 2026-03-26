# agent_docs/DEPLOYMENT.md — Agent OS v7
# CI/CD pipeline, deploy commands, rollback steps. All paths to production.
# Last updated: 2026-03-26

---

## Three Things to Deploy

1. **Agent OS dashboard** — `agent-os/` repo → Vercel (serves `index.html` + `/api/*` functions)
2. **Built products** — `[slug]/` repos → Vercel (auto-deployed on GitHub push)
3. **Cron agents** — `.github/workflows/*.yml` → GitHub Actions (run on schedule)

---

## 1. Deploy Agent OS Dashboard to Vercel

### First-time setup
```bash
# From agent-os/ directory
vercel login           # follow browser OAuth
vercel link            # link to existing project or create new
vercel env pull .env   # pull existing env vars (if project already exists)
```

### Production deploy
```bash
vercel --prod
# Vercel reads vercel.json for routing config
# Builds nothing (static HTML + serverless functions)
# Deploy completes in ~30 seconds
```

### What `vercel.json` does
```json
{
  "functions": {
    "api/*.js": { "maxDuration": 300 }
  },
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/$1" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```
- `/api/*` routes to serverless functions (300s max — needed for build pipeline)
- Everything else serves `index.html` (single-page app routing)

### Auto-deploy on push
Connect repo to Vercel via GitHub integration:
Vercel Dashboard → Project Settings → Git → Connect to GitHub → Select repo → Enable auto-deploy on push to `main`.
After this, every `git push` to main auto-deploys in ~30s.

### Verify dashboard is live
```bash
curl https://[your-dashboard].vercel.app/api/health | jq .
# All checks should be ok: true
```

---

## 2. Deploy a Built Product

Products are deployed automatically by the build pipeline (`/api/build` → `finalize` phase).
Manual deploy is only needed for debugging or re-deploying an existing product.

### Manual product deploy
```bash
# Products are in separate GitHub repos: github.com/[USERNAME]/[product-slug]
# Vercel auto-deploys them when builder-agent pushes to the repo

# To manually trigger a re-deploy:
curl -X POST https://[your-dashboard].vercel.app/api/deploy \
  -H "Content-Type: application/json" \
  -d '{"action":"triggerDeploy","repo":"[product-slug]","owner":"[USERNAME]"}'
```

### Check deploy status
```bash
curl -X POST https://[your-dashboard].vercel.app/api/deploy \
  -H "Content-Type: application/json" \
  -d '{"action":"checkStatus","repo":"[product-slug]"}' | jq .state
# Expected: "READY"
```

### Vercel project settings for products
Each product repo needs this `vercel.json`:
```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/" }] }
```
The build pipeline pushes this automatically. If missing, add it via:
```bash
curl -X POST https://[your-dashboard].vercel.app/api/github \
  -H "Content-Type: application/json" \
  -d '{"action":"pushFile","owner":"[USERNAME]","repo":"[slug]","path":"vercel.json","content":"{\"rewrites\":[{\"source\":\"/(.*)\",\"destination\":\"/\"}]}","message":"chore: vercel config"}'
```

---

## 3. Deploy Cron Agents (GitHub Actions)

### First-time setup
Agents live in `agents/*.js`. Their workflows live in `.github/workflows/`.

Each workflow file follows this pattern:
```yaml
# .github/workflows/market-agent.yml
name: Market Agent
on:
  schedule:
    - cron: '0 0 * * *'  # 00:00 UTC daily
  workflow_dispatch:       # allow manual trigger
jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: node agents/market-agent.js
        env:
          DASHBOARD_URL: ${{ secrets.DASHBOARD_URL }}
          GROQ_API_KEY: ${{ secrets.GROQ_API_KEY }}
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

### Set GitHub Actions secrets
GitHub repo → Settings → Secrets and variables → Actions → New repository secret:
- `DASHBOARD_URL` = `https://[your-dashboard].vercel.app`
- `GROQ_API_KEY` = `gsk_...`
- `SLACK_WEBHOOK_URL` = `https://hooks.slack.com/services/...`

### Verify agents are running
GitHub repo → Actions tab → Select workflow → Check last run status.
Green = success. Red = failure (check logs + Slack for alert).

### Manual agent trigger (debugging)
GitHub repo → Actions → [Workflow name] → Run workflow → Run workflow.
Useful for testing a single agent without waiting for the scheduled time.

### Agent cron schedule (UTC)
| Agent | Cron | UTC Time |
|-------|------|---------|
| market-agent | `0 0 * * *` | 00:00 |
| seo-agent | `0 2 * * *` | 02:00 |
| product-agent | `0 4 * * *` | 04:00 |
| builder-agent | `0 5 * * *` | 05:00 |
| launch-agent | `0 7 * * *` | 07:00 |
| traffic-agent | `0 9 * * *` | 09:00 |
| analytics-agent | `0 22 * * *` | 22:00 |

---

## Rollback Procedures

### Roll back dashboard (Vercel)
Vercel Dashboard → Project → Deployments → Find previous deployment → "..." menu → Promote to Production.
Takes ~10 seconds. No code changes needed.

### Roll back a product's HTML
```bash
# Get the file's git history
curl -X POST https://[your-dashboard].vercel.app/api/github \
  -H "Content-Type: application/json" \
  -d '{"action":"getFile","owner":"[USERNAME]","repo":"[slug]","path":"index.html"}' | jq .sha
# Then push the previous version with the old content
```

Or: go to the product's GitHub repo → `index.html` → History → find previous commit → copy content → push via `api/github`.

### Disable a failing agent
GitHub repo → Actions → [Workflow name] → "..." → Disable workflow.
The agent stops running on schedule. Re-enable when fixed.

---

## Health Check Runbook

Run this sequence after any deploy:

```bash
DASHBOARD="https://[your-dashboard].vercel.app"

# 1. Check all services
curl $DASHBOARD/api/health | jq .

# 2. Verify Stripe connection
curl -X POST $DASHBOARD/api/stripe \
  -H "Content-Type: application/json" \
  -d '{"action":"getSubscriptions"}' | jq .data | head -5

# 3. Verify GitHub connection
curl -X POST $DASHBOARD/api/github \
  -H "Content-Type: application/json" \
  -d '{"action":"getStats","owner":"[USERNAME]","repo":"agent-os"}' | jq .name

# 4. Verify Groq connection (build pipeline dependency)
curl -X POST $DASHBOARD/api/keywords \
  -H "Content-Type: application/json" \
  -d '{"action":"discover","seed":"test"}' | jq .keywords[0]
```

All four should return valid data. If any fail, check:
1. Vercel env vars are set for the failing service
2. API key is valid and not expired
3. Service itself is not down (check status pages)
