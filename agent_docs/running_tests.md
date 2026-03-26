# agent_docs/running_tests.md
# How to test Agent OS v7 (no formal test framework — smoke tests + manual validation)

## Health Check (run this first, always)
```bash
curl https://your-dashboard.vercel.app/api/health | jq .
# Expected:
# {
#   "status": "ok",
#   "checks": {
#     "env": { "ok": true, "details": { "github": true, "stripe": true, "groq": true } },
#     "groq": { "ok": true, "status": 200 },
#     "stripe": { "ok": true, "status": 200 },
#     "supabase": { "ok": true, "status": 200 }
#   }
# }
```

## API Endpoint Smoke Tests

### Build pipeline (phased)
```bash
# Phase 1: start
curl -X POST https://your-dashboard.vercel.app/api/build \
  -H "Content-Type: application/json" \
  -d '{"action":"start","keyword":"test-tool-smoke","force":true}' | jq .
# Expected: { "jobId": "test-tool-smoke-2026-03-26", "phase": "start", "status": "running" }

# Phase 2: build_html
curl -X POST https://your-dashboard.vercel.app/api/build \
  -H "Content-Type: application/json" \
  -d '{"action":"build_html","jobId":"test-tool-smoke-2026-03-26"}' | jq .

# Check job status
curl -X POST https://your-dashboard.vercel.app/api/build \
  -H "Content-Type: application/json" \
  -d '{"action":"get_job","jobId":"test-tool-smoke-2026-03-26"}' | jq .
```

### Stripe (use test keys)
```bash
curl -X POST https://your-dashboard.vercel.app/api/stripe \
  -H "Content-Type: application/json" \
  -d '{"action":"getSubscriptions"}' | jq .data[0]
```

### GitHub
```bash
curl -X POST https://your-dashboard.vercel.app/api/github \
  -H "Content-Type: application/json" \
  -d '{"action":"getStats","owner":"YOUR_USERNAME","repo":"YOUR_REPO"}' | jq .name
```

### Keywords (market discovery)
```bash
curl -X POST https://your-dashboard.vercel.app/api/keywords \
  -H "Content-Type: application/json" \
  -d '{"action":"discover","seed":"invoice generator"}' | jq .keywords[0]
```

## Agent Tests (run locally)
```bash
# Set env vars for local agent run
export DASHBOARD_URL=https://your-dashboard.vercel.app
export GROQ_API_KEY=gsk_...

# Test market-agent (read-only, safe to run anytime)
node agents/market-agent.js
# Expected: "[market-agent] ✓ Done. 10 keywords queued."

# Test analytics-agent (read-only reporting)
node agents/revenue-agent.js
# Expected: "[revenue-agent] ✓ MRR: $XXX"
```

## Dashboard UI Checks
| What to test | How |
|---|---|
| Build pipeline | Build tab → enter keyword → watch 4 phases complete |
| Portfolio loads | Portfolio tab → products table with live URLs |
| Revenue chart | Revenue tab → MRR chart with real Stripe data |
| Analytics funnel | Analytics tab → PostHog activation/paywall funnel |
| Health pill | Dashboard header → status pill shows green |
| Budget bar | Header → shows $X / $10.00 |

## Dedup Validation
```bash
# Run same build twice — second should return reused=true
curl -X POST .../api/stripe \
  -d '{"action":"createFull","slug":"test-slug","name":"Test","monthly_usd":9}' | jq .reused
# First call: false, second call: true
```

## What "Done" Looks Like Per Phase
| Phase | Success Indicator |
|-------|------------------|
| start | Supabase builds row exists, Stripe product created, jobId returned |
| build_html | GitHub repo has index.html with payment links injected |
| deploy | Vercel deployment state === 'READY', live URL returns 200 |
| finalize | Dev.to article published, SEO pages on GitHub, portfolio.json updated |

## Common Failure Modes
| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| health check groq: false | GROQ_API_KEY not set | Add to Vercel env vars |
| build phase stuck at deploy | Vercel rate limit | Wait 60s, retry |
| Stripe createFull fails | Invalid monthly_usd | Must be a number, not string |
| agent exits with 401 | GitHub token expired | Rotate GH_TOKEN in GitHub Secrets |
| /api/health returns 503 | Any check failing | Read `checks` object for which service |
