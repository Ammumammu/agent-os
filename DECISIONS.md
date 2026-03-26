# DECISIONS.md — Agent OS v7 Architecture Decision Log
# Why each key decision was made. Read this before re-litigating architecture choices.
# Format: ADR (Architecture Decision Record) — lightweight version.
# Last updated: 2026-03-26

---

## ADR-001: React 18 CDN, no build step
**Decision:** Dashboard is a single `index.html` with React 18 from CDN + Babel standalone.
**Alternatives considered:** Next.js, Vite + React, vanilla JS.
**Why CDN:**
- Zero build infrastructure to maintain or debug
- Instant local development (`npx serve .` or `vercel dev`)
- Vercel serves it as a static file — no build minutes consumed
- The dashboard is a personal tool, not a production SaaS — bundle size doesn't matter
**Trade-off accepted:** Babel standalone adds ~900KB to page load. Acceptable for a personal dashboard accessed by one user.
**Do not revisit unless:** Dashboard grows beyond 5,000 lines of JSX and becomes unmaintainable.

---

## ADR-002: Groq over OpenAI for 90% of tasks
**Decision:** Use Groq llama-3.3-70b-versatile for all research, copy, content, and spec generation.
**Why Groq:**
- Free tier with token-based daily limits (not request-based)
- CORS-enabled — can be called directly from browser without proxy
- Fast inference (llama-3.3-70b is fast on Groq hardware)
- Zero cost for 90% of system operations
**Why Claude Sonnet for code generation:**
- Code quality for React single-file apps is measurably better
- Cost: ~$0.06/product — justified by quality difference
- Only used for `build_html` phase of the build pipeline
**Do not switch:** Don't use OpenAI GPT-4o — same cost as Sonnet with worse code quality for this use case.

---

## ADR-003: Vercel serverless over Edge Functions
**Decision:** All `/api/*` functions are standard Vercel serverless (Node.js runtime), not Edge Functions.
**Why serverless (not Edge):**
- Edge Functions can't use `process.env` the same way — secret access is more complex
- Build pipeline needs up to 300s execution — Edge Functions have much shorter timeouts
- `Buffer.from()` for base64 encoding is available in Node.js — not guaranteed in Edge
**Trade-off accepted:** Cold starts are slower (~300ms) vs Edge (<50ms). Acceptable for an API called by a single user.
**Do not switch to Edge unless:** A specific endpoint needs sub-50ms global latency.

---

## ADR-004: GitHub Actions for agent cron, not Vercel Cron
**Decision:** All 8 agents run as GitHub Actions workflows on cron schedule.
**Why GitHub Actions:**
- Free for public repos (unlimited minutes)
- No lock-in to Vercel's cron pricing
- Each agent is a separate workflow — independent failure isolation
- Agents can be triggered manually from GitHub UI for debugging
- GitHub Actions has good logging and retry UX
**Why not Vercel Cron:**
- Vercel Cron runs serverless functions — 300s max, can't chain phases
- Requires Vercel Pro plan for anything beyond basic crons
**Do not switch unless:** Repo goes private and GitHub Actions minutes become costly.

---

## ADR-005: Supabase as coordination bus between agents
**Decision:** Agents share state via Supabase `builds` table, not via direct API calls or message queues.
**Why Supabase:**
- Agents don't call each other (failure isolation)
- Dashboard can read job state directly (no separate status API needed)
- Supabase free tier (500MB) is sufficient for job records + leads
- RLS means anon key is safe for browser-side lead capture
**Pattern:** `builder-agent` writes a build record → `launch-agent` reads it → `analytics-agent` reads it.
No direct function-to-function calls between agents.
**Do not add:** No Redis, no SQS, no Kafka. Supabase is sufficient for this scale.

---

## ADR-006: Stripe primary + Gumroad fallback
**Decision:** Every product has a Stripe subscription link (primary) AND a Gumroad one-time link (secondary).
**Why both:**
- Stripe: recurring revenue, better for SaaS subscriptions, webhooks for tracking
- Gumroad: built-in marketplace traffic (10-100 visitors/product), one-time payment option for price-sensitive users
- Some users won't enter card for recurring — Gumroad removes friction
**Why not LemonSqueezy as primary:**
- Acquired by Stripe July 2024, some instability reported
- Stripe is more reliable and widely trusted
- LemonSqueezy's built-in affiliates are useful but not needed until $500 MRR
**Affiliate strategy:** Set up Rewardful ($49/mo) when first product hits $500 MRR. Not before.

---

## ADR-007: Email niche as first product cluster
**Decision:** First 8 products all target email writing (cold email, follow-up, subject lines, apology emails).
**Why email tools first:**
- High demand score (8.5+) across all variants
- Clear ICP: sales teams, freelancers, founders doing outreach
- Proven willingness to pay (Lavender = $29/mo, Reply.io = $49/mo)
- Cross-sell opportunity: cold email writer → follow-up writer → subject line tester
- Single ICP means cross-sell module shows high-relevance recommendations
**Next niche:** YouTube tools (title generator, description writer, script writer) — validated by VidSpark and Vid Title Pro being in portfolio.
**Do not abandon** email cluster until at least one product shows 20+ paying customers. Niching compounds.

---

## ADR-008: No authentication on the dashboard
**Decision:** `index.html` has no login. It's deployed as a public URL but treated as private by security-through-obscurity.
**Why no auth:**
- This is a personal tool. Adding auth adds maintenance burden.
- The ENV object in the HTML contains browser-safe keys only (no secrets)
- Vercel URL is not indexed by Google (no sitemap, no public links)
**Risk accepted:** If someone discovers the dashboard URL, they can see portfolio metrics and marketing copy. Not a meaningful risk.
**Add auth if:** Dashboard ever becomes multi-user OR if it contains personally identifiable customer data.

---

## ADR-009: `validateCode()` gate before every GitHub push
**Decision:** The `validateCode(html)` check is mandatory before any `pushFile` call in the build pipeline.
**Why mandatory:**
- Broken HTML deployed = product is dead until manually fixed
- A failed deployment wastes a Stripe product creation, a Gumroad product, and a GitHub repo
- The cost of validation (100ms Groq call) is trivially small vs cost of a broken deploy
**Checks:** `</html>` present, no `require()`, no `fs.`, no empty payment link placeholders, no unclosed JSX tags.
**Do not skip this gate** under any circumstances, including when `force: true` is passed to the build API.

---

## ADR-010: Portfolio.json as cross-sell source of truth
**Decision:** All live products are listed in `public/portfolio.json` (hosted on GitHub, served by Vercel).
**Why public JSON:**
- Every product can fetch it at runtime: `fetch('/portfolio.json')` → show related products
- No database query needed for cross-sell — static JSON is faster
- `launch-agent` updates it on every new product launch
**Pattern:** Product HTML fetches `portfolio.json`, filters for same ICP or adjacent category, shows top 3.
**Do not store** product metadata only in Supabase — the JSON must be the canonical list for cross-sell.
