# ACCEPTANCE_CRITERIA.md — Agent OS v7
# Precise done-definitions per feature. An agent marks work complete ONLY when ALL criteria pass.
# Read the relevant section before marking any task complete.
# Last updated: 2026-03-26

---

## How to Use This File

1. Find the feature you just completed below
2. Verify EVERY criterion — no partial credit
3. If any criterion fails: the task is NOT complete. Fix it first.
4. Mark the ROADMAP.md checkbox only after all criteria pass

---

## Feature: Product Build Pipeline (single product)

**Complete when ALL of the following are true:**

### Phase: start
- [ ] Supabase `builds` table has a row with `job_id` matching the slug
- [ ] `builds.phase` = `"start"` or later
- [ ] Stripe product exists (confirmed via `/api/stripe {"action":"getRevenue"}` or Stripe dashboard)
- [ ] Stripe price exists for the product (monthly, correct amount in cents)
- [ ] Stripe payment link URL is a real `buy.stripe.com/...` link (not test mode for production)
- [ ] Gumroad product created (link is not empty in Supabase record)

### Phase: build_html
- [ ] GitHub repo `[slug]` exists under `GITHUB_USERNAME`
- [ ] `index.html` in repo contains real Stripe link (not `STRIPE_LINK_PRO` placeholder)
- [ ] `index.html` contains real PostHog write key (not `POSTHOG_WRITE_KEY` placeholder)
- [ ] `index.html` contains real Supabase URL and anon key (not placeholders)
- [ ] `index.html` passes `validateCode()`: no `require()`, no `fs.`, no `</html>` missing
- [ ] `vercel.json` exists in repo with correct rewrite rule
- [ ] `README.md` exists with live URL, Stripe link, and Gumroad link

### Phase: deploy
- [ ] Vercel project linked to the GitHub repo
- [ ] Vercel deployment state = `"READY"` (verified via `/api/deploy checkStatus`)
- [ ] `curl https://[slug].vercel.app` returns HTTP 200
- [ ] Page renders (no blank white screen — React loads without error)

### Phase: finalize
- [ ] `public/portfolio.json` updated with this product's entry
- [ ] Portfolio entry has: `vercel_url`, `stripe_link`, `github_url`, `launched_at`
- [ ] At least one Dev.to or Hashnode article published for this product
- [ ] SEO pages pushed to GitHub repo (at minimum: `/blog/how-to-[keyword]` page)

---

## Feature: Agent Cron Job

**Complete when ALL of the following are true:**

- [ ] GitHub Actions workflow file exists in `.github/workflows/[agent-name].yml`
- [ ] Workflow has `workflow_dispatch:` trigger (manual trigger enabled for debugging)
- [ ] Workflow has `schedule:` cron matching the agent's designated time
- [ ] Agent imports `fetchWithRetry` (not raw `fetch`)
- [ ] Agent imports `sendAlert` and calls it in the catch block
- [ ] At least one successful GitHub Actions run visible in Actions tab (green checkmark)
- [ ] Slack receives alert message if agent is manually triggered with a forced failure condition

---

## Feature: Supabase Database

**Complete when ALL of the following are true:**

- [ ] All tables exist: `leads`, `products`, `builds`, `sales`, `payments`
- [ ] RLS is enabled on all tables (verify: Supabase Dashboard → Table Editor → each table → RLS = ON)
- [ ] `leads` table: anon role can INSERT, service_role can SELECT
- [ ] `builds` table: service_role can INSERT and SELECT (no anon access)
- [ ] Test insert: `curl -X POST [supabase-url]/rest/v1/leads` with anon key succeeds
- [ ] Test read from browser fails (anon key cannot SELECT from `builds`)

---

## Feature: PostHog Analytics

**Complete when ALL of the following are true:**

- [ ] PostHog project exists at app.posthog.com
- [ ] Write key (`phc_...`) is set in all live product HTML files
- [ ] At least one `tool_opened` event appears in PostHog Insights within 5 minutes of manually opening a product URL
- [ ] `paywall_shown` event appears after using the product twice (hitting free limit)
- [ ] PostHog Funnels: can build a funnel `tool_opened → tool_used → paywall_shown → payment_clicked`
- [ ] `/api/posthog` returns real data (not empty arrays) when called with a valid event name

---

## Feature: Stripe Payment Flow

**Complete when ALL of the following are true:**

- [ ] Stripe is in LIVE mode (not test mode) for production dashboard
- [ ] Payment link opens in browser (no 404, no expired link)
- [ ] Clicking "Subscribe" on a payment link reaches a real Stripe checkout
- [ ] Stripe webhook registered at `/api/webhook/stripe` in Stripe Dashboard → Webhooks
- [ ] Webhook secret matches `STRIPE_WEBHOOK_SECRET` env var
- [ ] Test payment: use Stripe test card `4242 4242 4242 4242` → verify `sales` table gets a new row in Supabase

---

## Feature: SEO Content Published

**Complete when ALL of the following are true:**

- [ ] GitHub repo for the product has at least 5 pages under `/blog/` or `/examples/`
- [ ] Vercel serves these pages (e.g., `https://[slug].vercel.app/blog/how-to-[keyword]` returns 200)
- [ ] Dev.to article published and visible at `dev.to/[username]/[title-slug]`
- [ ] Hashnode post published and visible at `[username].hashnode.dev/[title-slug]`
- [ ] Each article links back to the product's live URL

---

## Feature: Marketing Copy Delivered (Semi-Auto Channels)

**Complete when ALL of the following are true:**

- [ ] Reddit post copy generated for the product (viewable in dashboard Traffic tab)
- [ ] Reddit copy follows authentic founder voice (personal story first, link last, no marketing language)
- [ ] Twitter thread copy generated (7 tweets: hook → problem → attempt → solution → demo → result → CTA)
- [ ] IH post copy generated ("I built X to solve Y")
- [ ] ProductHunt submission copy ready: name (≤60 chars tagline), description, first comment

---

## Feature: Winner Detection Automated

**Complete when ALL of the following are true:**

- [ ] `analytics-agent.js` calls `checkWinnerCriteria()` on all products daily (22:00 UTC run)
- [ ] Winner criteria: `daily_visitors ≥ 200 AND activation_rate ≥ 40% AND paywall_ctr ≥ 15% AND mrr ≥ $200`
- [ ] When winner detected: Slack alert fires with product name and metrics
- [ ] Winner marked in `portfolio.json` with `"winner": true`
- [ ] ROADMAP.md Phase 4 tasks auto-queued when winner detected (or Slack prompts human to do so)

---

## Feature: Documentation Layer (13 new files)

**Complete when ALL of the following exist and have real project-specific content (not generic templates):**

- [x] `PRD.md` — requirements, success metrics, out-of-scope items
- [x] `ROADMAP.md` — phase checkboxes with 2026 dates
- [x] `IMPLEMENTATION_STATUS.md` — per-component status table
- [x] `DECISIONS.md` — at least 5 ADRs with why + trade-offs
- [x] `ERRORS_LOG.md` — known failures with root causes and fixes
- [x] `HANDOFF.md` — last session summary + next steps
- [x] `CHANGELOG.md` — version history
- [x] `agent_docs/ENVIRONMENT.md` — all env vars classified by security zone
- [x] `agent_docs/DEPLOYMENT.md` — deploy commands for dashboard, products, and agents
- [x] `.claude/agents/qa-validator.md` — read-only validation sub-agent
- [x] `.claude/agents/planner.md` — orchestrator with session start protocol
- [x] `HOOKS.md` — Claude Code hook configuration
- [x] `ACCEPTANCE_CRITERIA.md` — this file
- [x] `specs/` — epic template with depends_on/parallel metadata
