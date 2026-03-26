# PRD.md — Agent OS v7 Product Requirements Document
# Layer 2: Immutable source of truth. Re-read this at the start of every session.
# Do NOT modify this file during a build session. Update only when requirements change.
# Last updated: 2026-03-26

---

## What Agent OS Is

An autonomous SaaS factory that runs daily without human intervention.
It discovers pain points → builds single-file SaaS tools → deploys to live URLs →
attaches Stripe payments → generates SEO content → tracks revenue → self-improves.

**Human time required per day: 15 minutes** (paste Reddit/Twitter copy that system generates).
Everything else is autonomous.

---

## Who It's For

**Primary user:** The owner/operator (single person, technical founder).
No multi-tenant. No team features. Personal dashboard, personal API keys.

**End customers of built products:** Freelancers, founders, marketers, sales teams.
ICPs are defined per product, not for the system itself.

---

## Core Requirements (non-negotiable)

### R1 — Build pipeline must complete end-to-end without human input
1. Keyword → SaaS spec (Groq, free)
2. Spec → complete HTML with real payment links injected (Sonnet)
3. HTML → GitHub repo → Vercel deployment → live URL (serverless)
4. Live URL → Dev.to + Hashnode articles auto-published (serverless)

**Acceptance:** `/api/build` called with a keyword returns a live URL within 180 seconds.

### R2 — Budget hard ceiling: $10/day total API spend
- Groq: free (token-based, ~14,400 tokens/day)
- Sonnet: ~$0.06/product × 5 products/day = $0.30 maximum
- Budget tracking must be visible in the dashboard header at all times
- Hard stop at $9.50 → Groq-only mode for remainder of day

### R3 — Secrets never reach the browser
- GITHUB_TOKEN, STRIPE_SECRET_KEY, VERCEL_API_KEY, SUPABASE_SERVICE_KEY → `/api/*` only
- Browser-safe keys: GROQ_API_KEY, SUPABASE_ANON_KEY, POSTHOG_WRITE_KEY, GEMINI_API_KEY
- Violation of this rule is a P0 bug. Fix before anything else.

### R4 — Every product must have a working paywall
- 2 free uses → email capture offer → paywall with Stripe link
- Stripe payment link must be real (not placeholder) before product goes live
- Gumroad link as one-time fallback (optional if Gumroad API is unavailable)

### R5 — Agent failures must alert
- Every agent must call `sendAlert()` from `lib/alert.js` on unhandled errors
- Alerts go to Slack webhook + email via Resend
- A silent agent failure is worse than a loud one

### R6 — Code quality gate before deploy
- `validateCode(html)` must pass before GitHub push
- Checks: `</html>` present, no Node.js server APIs (`require`, `fs.`, `path.`), no empty payment links
- Broken HTML deployed to production = P0 bug

---

## Success Metrics

| Metric | Week 1 Target | Month 1 Target | Month 3 Target |
|--------|--------------|----------------|----------------|
| Products live | 5–8 | 20–30 | 50–80 |
| SEO pages published | 30–50 | 150–200 | 500+ |
| MRR | $0–$90 | $200–$800 | $1,500–$5,000 |
| Paying customers | 0–5 | 20–50 | 100–200 |
| Daily visitors (total) | 50–200 | 500–2,000 | 5,000–20,000 |
| Activation rate (best product) | — | ≥ 30% | ≥ 40% |

**Winner signal:** any product with 40%+ activation rate AND $200+ MRR for 7 consecutive days.
**Action on winner:** double all marketing, build TYPE B version, set up Rewardful affiliate.

---

## Out of Scope (forever)

- Multi-user / team accounts for the dashboard itself
- Custom domain per product (Vercel subdomain is sufficient until $1k+ MRR per product)
- Native mobile app
- Building TYPE B or TYPE C products before a TYPE A proves $200+ MRR
- Any data scraping that violates ToS (Upwork, G2, Capterra, LinkedIn)

---

## Architecture Constraints (hard)

1. Dashboard is a single `index.html` — no build step, no bundler, React 18 CDN only
2. All server-side logic lives in `api/*.js` — Vercel serverless, Node.js 18+
3. Agents run as GitHub Actions cron jobs — they call `/api/*` endpoints, not each other directly
4. Shared state via Supabase `builds` table — no direct agent-to-agent communication
5. All agents use `fetchWithRetry` from `lib/fetch-retry.js` — no raw `fetch()` in agents
6. Content generation: Groq for everything except HTML code (Sonnet only for code)

---

## Dependency Map

```
market-agent → keyword-queue.json
             ↓
product-agent → SaaS specs (Groq)
             ↓
builder-agent → /api/build → /api/stripe → /api/github → /api/deploy
             ↓
launch-agent → payment links injected → portfolio.json updated
             ↓
traffic-agent → /api/publish (Dev.to + Hashnode auto)
             ↓ (human)
              → Reddit post copy pasted → Twitter thread pasted
             ↓
analytics-agent → /api/analytics → Pinecone insights → tomorrow's queue
```

---

## Revision History

| Date | Change | Author |
|------|--------|--------|
| 2026-03-26 | Initial PRD created from CLAUDE.md master spec | Claude |
