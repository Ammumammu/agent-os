# agent_docs/service_architecture.md
# System design overview for Agent OS v7

## Two-Layer Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                   BROWSER (index.html)                              │
│                                                                     │
│  React 18 CDN — no build step, no bundler, Babel standalone JSX    │
│                                                                     │
│  DIRECT API CALLS (CORS-safe, no proxy needed):                     │
│    Groq API        → market research, content gen, product specs    │
│    Gemini API      → text embeddings for Pinecone                   │
│    Pinecone API    → vector memory reads/writes                     │
│    HN Algolia API  → pain signal research (CORS: *)                 │
│    PostHog (write) → event tracking                                 │
│    Supabase (anon) → lead capture (RLS protects rows)               │
│                                                                     │
│  API CALLS TO /api/* (secrets stay server-side):                    │
│    All GitHub, Stripe, Vercel, Email operations                     │
│    All publishing, analytics reads                                  │
│                                                                     │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ fetch('/api/...') — same-origin, zero CORS
┌──────────────────────────▼──────────────────────────────────────────┐
│              VERCEL SERVERLESS FUNCTIONS (api/*.js)                 │
│                                                                     │
│  Secrets (NEVER in browser):                                        │
│    GITHUB_TOKEN, STRIPE_SECRET_KEY, VERCEL_API_KEY                  │
│    SUPABASE_SERVICE_KEY, RESEND_API_KEY, GROQ_API_KEY               │
│                                                                     │
│  Functions:                                                         │
│    /api/build     → 4-phase product pipeline (300s max)            │
│    /api/stripe    → Stripe CRUD + dedup (createFull)               │
│    /api/github    → repo + file management                         │
│    /api/deploy    → Vercel project lifecycle (120s max)            │
│    /api/keywords  → Google autosuggest + niche discovery           │
│    /api/content   → SEO page generation (Groq)                     │
│    /api/publish   → Dev.to + Hashnode auto-publish                 │
│    /api/analytics → Stripe + Gumroad + PostHog aggregation         │
│    /api/health    → readiness probe (env + 3 external checks)      │
│    /api/reddit    → CORS proxy for Reddit search                    │
│    /api/email     → Resend transactional email                     │
│    /api/gumroad   → Gumroad product management                     │
│    /api/posthog   → PostHog analytics reads (personal API key)     │
│    /api/devto     → Dev.to article publish + stats                 │
│    /api/hashnode  → Hashnode GraphQL publish                       │
│                                                                     │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────────┐
│              GITHUB ACTIONS (agents/*.js, cron)                     │
│                                                                     │
│  Runs on schedule, calls same /api/* endpoints as the browser       │
│  Uses fetchWithRetry — handles GitHub Actions network flakiness     │
│  Failure → Slack alert via lib/alert.js                            │
│                                                                     │
│  00:00  market-agent    → /api/keywords                            │
│  02:00  seo-agent       → /api/content → /api/github               │
│  04:00  product-agent   → /api/keywords (generate mode)            │
│  05:00  builder-agent   → /api/build (build_product)               │
│  07:00  launch-agent    → /api/stripe + /api/gumroad + /api/github │
│  09:00  traffic-agent   → /api/publish                             │
│  22:00  analytics-agent → /api/analytics → Pinecone                │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Data Flow: Keyword → Revenue

```
1. market-agent discovers keyword "invoice generator for freelancers"
   → scores 8.7/10 (above 7.0 gate)
   → writes to public/keyword-queue.json

2. product-agent converts keyword → SaaS spec (Groq, free)
   → name, slug, ICP, pricing, pain point, viral attribution

3. builder-agent calls /api/build (4 phases):
   start:      spec + Stripe createFull + Gumroad create + Supabase job record
   build_html: Claude Sonnet generates complete React app (~$0.06)
               GitHub repo created, index.html + vercel.json + README pushed
   deploy:     Vercel project linked to GitHub repo, polls until READY (~90s)
   finalize:   SEO pages generated + pushed, Dev.to + Hashnode articles posted
               portfolio.json updated, Pinecone memory written

4. Traffic: traffic-agent auto-posts Dev.to + Hashnode
            Copy drawer in dashboard queues Reddit/Twitter/IH for human posting

5. Revenue: visitors → free uses → paywall → Stripe subscription
            /api/analytics aggregates MRR across all products
            analytics-agent tracks winner/loser criteria daily

6. Memory: analytics-agent extracts lessons → Pinecone (768-dim vectors)
           planTomorrow() queries Pinecone → seeds next build queue
```

## State Persistence
| Data | Where | Who Reads | Who Writes |
|------|-------|-----------|-----------|
| Live products | public/portfolio.json (GitHub) | All agents, dashboard | launch-agent |
| Today's keywords | public/keyword-queue.json | seo, product, builder agents | market-agent |
| Build jobs | Supabase builds table | dashboard, builder-agent | api/build |
| Leads | Supabase leads table | analytics, dashboard | products (anon key) |
| MRR data | Stripe API (authoritative) | dashboard, analytics-agent | Stripe webhooks |
| Daily insights | Pinecone vectors | analytics-agent, dashboard | analytics-agent |
| Marketing copy | .claude/tmp/copy-queue.json | dashboard Traffic tab | analytics-agent, traffic-agent |

## Failure Isolation
- Each agent fails independently — one broken agent doesn't stop others
- Browser dashboard calls are completely independent of agent cron runs
- Supabase build table acts as coordination bus (no direct agent-to-agent calls)
- Slack alerts fire within 30s of any agent failure
