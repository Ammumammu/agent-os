# AGENTS.md — Universal Cross-Tool Brief
# Supported by: Claude Code, Cursor, GitHub Copilot, Gemini CLI, Windsurf, Aider, Zed, Warp
# No special schema required. Keep this file current — it's the single truth for all AI tools.

## Project: Agent OS v7

Autonomous SaaS factory. Researches pain points → builds single-file SaaS tools →
deploys to live URLs → attaches Stripe payments → publishes SEO content → tracks revenue.
Daily target: 3-5 new products live, 50 SEO pages published.

## Stack
| Layer | Technology |
|-------|-----------|
| Dashboard | React 18 CDN (no build step), single `index.html` |
| Backend | Vercel serverless functions (`api/*.js`) |
| AI (free) | Groq llama-3.3-70b-versatile (90% of tasks) |
| AI (paid) | Claude Sonnet 4.6 (code generation only, ~$0.06/product) |
| Embeddings | Gemini text-embedding-004 (free, CORS-enabled) |
| Vector store | Pinecone (free 100k vectors) |
| Payments | Stripe (primary) + Gumroad (one-time fallback) |
| Database | Supabase (leads, products, builds tables) |
| Analytics | PostHog (1M events/mo free) |
| Email | Resend (3k/mo free) |
| Cron | GitHub Actions (8 agents, daily schedule) |
| Hosting | Vercel (dashboard + serverless) |

## File Structure
```
agent-os/
├── index.html               ← Full React dashboard
├── api/
│   ├── build.js             ← 4-phase build pipeline
│   ├── stripe.js            ← Stripe operations + dedup
│   ├── github.js            ← Repo + file management
│   ├── deploy.js            ← Vercel project lifecycle
│   ├── keywords.js          ← Market discovery
│   ├── content.js           ← SEO page generation
│   ├── publish.js           ← Multi-channel publishing
│   ├── analytics.js         ← Revenue aggregation
│   ├── health.js            ← Readiness probe
│   └── ...8 more
├── agents/
│   ├── market-agent.js      ← Keyword discovery (00:00 UTC)
│   ├── seo-agent.js         ← SEO page factory (02:00 UTC)
│   ├── product-agent.js     ← SaaS spec generator (04:00 UTC)
│   ├── builder-agent.js     ← HTML builder (05:00 UTC)
│   ├── launch-agent.js      ← Deploy + monetize (07:00 UTC)
│   ├── traffic-agent.js     ← Content distribution (09:00 UTC)
│   ├── analytics-agent.js   ← Track + optimize (22:00 UTC)
│   └── revenue-agent.js     ← Revenue reporting
├── lib/
│   ├── fetch-retry.js       ← Exponential backoff (REQUIRED for all agents)
│   └── alert.js             ← Slack + email failure alerts
├── agent_docs/              ← Architecture docs (read before modifying)
└── .claude/                 ← Claude Code config
    ├── rules/               ← Modular coding rules
    ├── agents/              ← Sub-agent personas
    ├── skills/              ← On-demand playbooks
    └── commands/            ← Slash commands
```

## Key Commands
```bash
# Local dev (no build step needed — serve index.html directly)
npx serve . -p 3000

# Deploy to Vercel
vercel --prod

# Run a single agent locally
node agents/market-agent.js

# Check health
curl https://your-dashboard.vercel.app/api/health

# Run Supabase schema migration
# Paste supabase-schema.sql into Supabase SQL Editor
```

## Non-Negotiable Rules
1. Never put secret keys in `index.html` (use ENV object for browser-safe keys only)
2. Always use `fetchWithRetry` in agents — never raw `fetch()`
3. Always call `sendAlert()` on agent failure
4. Validate HTML with `validateCode()` before GitHub push
5. Use `createFull` (not separate createProduct/createPrice) to avoid Stripe duplicates
6. Build dedup: check Supabase `builds` table before starting a new build
7. Model budget: $9.50/day hard stop → Groq-only fallback

## Environment Variables
See `.env.example` for all required keys.
Browser-safe keys go in `const ENV = {...}` in `index.html`.
Server secrets go in `.env` / Vercel project settings / GitHub Secrets.
