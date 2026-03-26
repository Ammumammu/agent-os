# Agent OS v7 — Project Constitution
# Layer 1: Compact project CLAUDE.md (auto-loaded every session)
# Full spec lives in parent D:/claude-code/CLAUDE.md — this file adds project-level overrides.

## What This Project Is
Autonomous SaaS factory: discovers pain points → builds single-file SaaS tools →
deploys to Vercel → attaches Stripe payments → generates SEO content → tracks revenue.

## Working Directory
```
D:/claude-code/agent-os/
├── index.html          ← React 18 CDN dashboard (single file, no build step)
├── api/*.js            ← Vercel serverless functions (secrets stay here)
├── agents/*.js         ← GitHub Actions cron agents
├── lib/*.js            ← Shared utilities (fetch-retry, alert)
├── agent_docs/         ← Architecture docs (read these first for context)
└── .claude/            ← Claude Code config (rules, agents, skills, commands)
```

## Modular Rules (load when relevant)
- Code style & naming → `.claude/rules/code-style.md`
- API function patterns → `.claude/rules/api-conventions.md`
- Agent structure patterns → `.claude/rules/agent-patterns.md`

## Critical Constraints
- NEVER put secrets in `index.html` beyond the ENV object (public dashboard)
- NEVER use raw `fetch()` in agents — always use `fetchWithRetry` from `lib/fetch-retry.js`
- NEVER deploy broken HTML — `validateCode()` must pass before GitHub push
- ALL agent failures MUST call `sendAlert()` from `lib/alert.js`
- Budget hard-stop at $9.50/day — switch to Groq-only mode

## Key API Endpoints
| Path | Purpose |
|------|---------|
| POST /api/build | 4-phase product pipeline (start→build_html→deploy→finalize) |
| POST /api/stripe | Stripe operations (createFull for dedup-safe product creation) |
| POST /api/github | GitHub repo/file operations |
| POST /api/deploy | Vercel project creation + status polling |
| POST /api/keywords | Market discovery + Google autosuggest |
| POST /api/content | SEO page generation (6 types per keyword) |
| POST /api/publish | Multi-channel auto-publish (Dev.to + Hashnode) |
| POST /api/analytics | Revenue aggregation (Stripe + Gumroad + PostHog) |
| GET  /api/health | Readiness check (env, Groq, Stripe, Supabase) |

## Model Routing
| Task | Model | Cost |
|------|-------|------|
| Research, scoring, content, copy | Groq llama-3.3-70b-versatile | Free |
| Code generation (HTML) | Claude Sonnet 4.6 | ~$0.06/product |
| Embeddings | Gemini text-embedding-004 | Free |

## Agent Schedule
```
00:00  market-agent    → discover 50 keywords
02:00  seo-agent       → generate 50 SEO pages
04:00  product-agent   → create 10 SaaS specs
05:00  builder-agent   → build 3 HTML tools
07:00  launch-agent    → deploy + monetize
09:00  traffic-agent   → distribute content
22:00  analytics-agent → track + optimize + plan tomorrow
```

## Agent Knowledge Docs (read before modifying architecture)
- `agent_docs/service_architecture.md` — system design + data flow
- `agent_docs/database_schema.md` — Supabase tables + RLS
- `agent_docs/service_communication_patterns.md` — how layers talk
- `agent_docs/building_the_project.md` — setup + deploy
- `agent_docs/running_tests.md` — smoke tests + validation
