# ROADMAP.md — Agent OS v7
# Format: [ ] = todo | [-] = in progress | [x] = done (YYYY-MM-DD)
# Agent reads this on session start to know where to resume. Update checkboxes as work completes.
# Last updated: 2026-03-26

---

## Phase 1 — Infrastructure Foundation
**Goal:** All systems operational, one product successfully deployed end-to-end.
**Status: COMPLETE**

- [x] 2026-03-10 `index.html` React 18 CDN dashboard with 14 tabs
- [x] 2026-03-10 `api/build.js` — 4-phase pipeline (start → build_html → deploy → finalize)
- [x] 2026-03-10 `api/stripe.js` — createFull with dedup, getSubscriptions, getRevenue
- [x] 2026-03-10 `api/github.js` — createRepo, pushFile, updateFile, getStats
- [x] 2026-03-10 `api/deploy.js` — createProject, pollStatus (120s timeout), getAnalytics
- [x] 2026-03-10 `api/keywords.js` — Google autosuggest + niche cluster discovery
- [x] 2026-03-10 `api/content.js` — 6-type SEO page generation (Groq)
- [x] 2026-03-10 `api/publish.js` — Dev.to + Hashnode auto-publish
- [x] 2026-03-10 `api/analytics.js` — Stripe + Gumroad + PostHog aggregation
- [x] 2026-03-10 `api/health.js` — readiness probe (env + Groq + Stripe + Supabase)
- [x] 2026-03-10 `api/reddit.js`, `api/email.js`, `api/gumroad.js`, `api/posthog.js`
- [x] 2026-03-10 `lib/fetch-retry.js` — exponential backoff for all agents
- [x] 2026-03-10 `lib/alert.js` — Slack + email failure alerts
- [x] 2026-03-10 `agents/market-agent.js` — 00:00 UTC cron
- [x] 2026-03-10 `agents/seo-agent.js` — 02:00 UTC cron
- [x] 2026-03-10 `agents/product-agent.js` — 04:00 UTC cron
- [x] 2026-03-10 `agents/builder-agent.js` — 05:00 UTC cron
- [x] 2026-03-10 `agents/launch-agent.js` — 07:00 UTC cron
- [x] 2026-03-10 `agents/traffic-agent.js` — 09:00 UTC cron
- [x] 2026-03-10 `agents/analytics-agent.js` — 22:00 UTC cron
- [x] 2026-03-10 `agents/revenue-agent.js` — revenue reporting
- [x] 2026-03-10 Supabase schema deployed (leads, products, builds, sales, payments tables)
- [x] 2026-03-10 8 products live: Cold Email Writer, FollowUp Writer, SubjectLine Pro, Cold Email Pro, Subject Craft Pro, ApologyPro, VidSpark, Vid Title Pro
- [x] 2026-03-10 `.claude/` config: rules, agents, skills, commands all scaffolded

---

## Phase 2 — Traffic & Conversion (Current Phase)
**Goal:** First paying customer. At least 1 product with ≥ 30% activation rate.
**Target:** 2026-03-26 → 2026-04-09
**Status: IN PROGRESS**

### Traffic
- [ ] Verify Dev.to articles published for all 8 products (check /api/publish logs)
- [ ] Verify Hashnode posts published for all 8 products
- [ ] Post Reddit "I built this" copy for top 3 products (manual, 15 min)
- [ ] Post Twitter threads for top 3 products (manual, 15 min)
- [ ] Submit all 8 products to free AI directories (manual: There's An AI For That, Toolify, AI Scout)
- [ ] SEO pages: verify 6 pages per product pushed to GitHub (48 pages total)

### Conversion
- [ ] Verify PostHog is receiving events from all 8 live products (check posthog.com dashboard)
- [ ] Verify paywall triggers at correct free limit (2 uses) on each product
- [ ] Verify Stripe payment links are working (not test mode) on all products
- [ ] A/B test paywall copy on highest-traffic product
- [ ] Cross-sell module: verify portfolio.json is being fetched at runtime by products

### Analytics
- [ ] Dashboard Analytics tab: verify PostHog funnel shows real data
- [ ] Revenue tab: verify Stripe MRR chart renders with real subscription data
- [ ] Winner detection: wire `checkWinnerCriteria()` to fire Slack alert automatically

---

## Phase 3 — First Revenue ($50–$500 MRR)
**Goal:** At least 5 paying customers. Identify the top-performing product.
**Target:** 2026-04-10 → 2026-04-30
**Status: NOT STARTED**

- [ ] Daily PostHog review → identify product with highest activation_rate
- [ ] Product with ≥ $100 MRR → submit to ProductHunt (Tuesday 12:01am PST)
- [ ] Product with ≥ $100 MRR → submit to Futurepedia ($247, worth it above $500 MRR)
- [ ] Top product → IH milestone post ("I made my first $X")
- [ ] Supabase `leads` table: send first email sequence via Resend to captured leads
- [ ] Build 10 additional products focused on SEO niches (resume, youtube, coding tools)

---

## Phase 4 — Scale to $500 MRR
**Goal:** Winner product identified. TYPE B version of winner planned.
**Target:** 2026-05-01 → 2026-05-31
**Status: NOT STARTED**

- [ ] Winner product: 40%+ activation_rate for 7 consecutive days
- [ ] Set up Rewardful affiliate program ($49/mo) for winner product
- [ ] Build TYPE B version of winner (Supabase auth + persistence + team features)
- [ ] SEO compounding: 150+ pages indexed, monitor with /api/serp
- [ ] Portfolio SEO: push remaining niche clusters (image, pdf, coding)

---

## Backlog (unscheduled)

- [ ] Chrome extension distribution for tools that make sense as extensions
- [ ] CREEM.io as Stripe alternative for global sales (0% fee first €1k)
- [ ] Enterprise tier ($199/mo) when any product reaches 100+ customers
- [ ] Pricing optimization agent: run weekly, auto-adjust based on PostHog data
- [ ] `agents/acos-orchestrator.js` — meta-agent that coordinates all agents

---

## Retired / Cancelled

(none yet — too early to retire products; allow 30-day evaluation window)
