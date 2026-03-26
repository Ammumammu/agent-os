# ERRORS_LOG.md — Agent OS v7
# Recurring failures, dead ends, and attempted fixes. Read before retrying any known-failed operation.
# Format: each entry has symptom, root cause, fix, and status.
# Last updated: 2026-03-26

---

## How to Use This File

Before attempting an operation that has failed before:
1. Search this file for the error message or symptom
2. Read the root cause and what was tried
3. Apply the documented fix — do not retry the failed approach

When you encounter a new failure:
1. Add it here with full symptom + root cause + what you tried
2. Mark it OPEN until resolved, then RESOLVED with the fix

---

## OPEN ERRORS

### ERR-001: Stripe duplicate products on retry
**Symptom:** Running the build pipeline twice for the same keyword creates duplicate Stripe products (two products with the same name in Stripe dashboard).
**Root cause:** Build pipeline called `createProduct` without checking if a product for this slug already exists.
**Fix implemented:** `api/stripe.js createFull` now checks Supabase `builds` table for existing `stripe_product_id` before creating. Returns `{ reused: true }` if found.
**Status:** RESOLVED — but verify with dedup test: `POST /api/stripe {"action":"createFull","slug":"cold-email-writer-tool","name":"Cold Email Writer","monthly_usd":9}` — second call must return `reused: true`.
**Test command:**
```bash
curl -X POST https://[dashboard]/api/stripe \
  -H "Content-Type: application/json" \
  -d '{"action":"createFull","slug":"cold-email-writer-tool","name":"Cold Email Writer","monthly_usd":9}' | jq .reused
# Expected: true (not false, not undefined)
```

---

### ERR-002: Reddit fetch fails in Firefox with strict tracking protection
**Symptom:** `fetch('https://www.reddit.com/r/entrepreneur/search.json?q=...')` returns CORS error in Firefox. Works in Chrome.
**Root cause:** Firefox's Enhanced Tracking Protection blocks reddit.com API calls from non-Reddit origins.
**Fix:** Always use `/api/reddit` proxy, never call Reddit directly from browser code.
**Status:** RESOLVED — `api/reddit.js` is the authoritative path. Do not add direct Reddit fetches to any browser code.
**Do not retry:** Direct browser calls to `reddit.com/*.json` will fail for some users. Never add them back.

---

### ERR-003: Vercel deploy polling timeout too short
**Symptom:** `/api/deploy` returns `{ status: "timeout" }` even though Vercel eventually deploys successfully (~90–120 seconds later).
**Root cause:** Initial poll interval was 5s with 30s total timeout — insufficient for cold Vercel deployments.
**Fix:** Polling is now 10s interval, 120s total max (12 polls). Returns `{ status: "ready", url: "..." }` when done.
**Status:** RESOLVED — if you see timeout errors, check if `api/deploy.js` polling loop runs 12 iterations.

---

### ERR-004: GitHub push fails with 422 "SHA required for update"
**Symptom:** Pushing `index.html` to an existing repo fails with HTTP 422.
**Root cause:** GitHub's Contents API requires a `sha` field when updating an existing file. Missing on first update attempt.
**Fix:** `api/github.js pushFile` now calls `getFile` first to retrieve current SHA, then includes it in the PUT request.
**Status:** RESOLVED — pattern is: `getFile(path)` → extract `sha` from response → `pushFile(path, content, sha)`.
**Watch for:** If `getFile` returns 404 (file doesn't exist yet), omit `sha` from PUT. Both paths must work.

---

### ERR-005: Groq 429 rate limit during parallel content generation
**Symptom:** Running 5 parallel `callGroq()` requests causes 429 Too Many Requests. Some return empty strings silently.
**Root cause:** Groq's free tier has per-minute token limits. Concurrent requests can exceed this.
**Fix applied:** `lib/fetch-retry.js` handles 429 with exponential backoff (10s, 30s, 60s). Groq-specific: also respect `retry-after` header.
**Status:** PARTIALLY RESOLVED — backoff handles transient spikes but sequential generation is safer for >5 concurrent Groq calls. Consider adding 500ms delay between concurrent requests in high-load scenarios.

---

### ERR-006: PostHog events not appearing in dashboard
**Symptom:** Products are being used (verified by Supabase leads inserting) but PostHog shows 0 events.
**Root cause (suspected):** Live product HTML files have placeholder `POSTHOG_WRITE_KEY` instead of real key. This can happen if the `finalize` phase of the build runs before ENV values are injected.
**Diagnosis steps:**
1. Open any live product URL in browser
2. Open DevTools → Network tab → filter by "posthog"
3. If no requests appear: the PostHog key in that product's HTML is empty or wrong
4. Check the raw HTML: `curl https://[product-url] | grep POSTHOG_WRITE_KEY`
**Fix:** Re-push `index.html` with real PostHog key via `api/github.js pushFile` + trigger re-deploy.
**Status:** OPEN — not verified whether PostHog keys are real in all 8 live products.

---

### ERR-007: HN Algolia returns empty results for some queries
**Symptom:** `fetchHNPainData("invoice generator")` returns `hits: []` despite posts existing on HN.
**Root cause:** Algolia index doesn't include very old posts. Query must include recency filter.
**Fix:** Add `&numericFilters=created_at_i>UNIX_TIMESTAMP` where timestamp = 90 days ago.
```js
const ninetyDaysAgo = Math.floor((Date.now() - 90 * 24 * 60 * 60 * 1000) / 1000);
const url = `https://hn.algolia.com/api/v1/search?query=${q}&tags=story&numericFilters=created_at_i>${ninetyDaysAgo}`;
```
**Status:** RESOLVED — verify `api/discover.js` and `agents/market-agent.js` both include this filter.

---

## CONFIRMED DEAD ENDS (do not attempt)

### DEAD-001: Calling Stripe from browser directly
**What was tried:** Calling `https://api.stripe.com/v1/products` directly from `index.html`.
**Why it fails:** Stripe rejects browser requests for server-side endpoints. CORS error even with correct auth header.
**Also:** Exposing `sk_live_` key in browser HTML is a critical security vulnerability.
**Solution:** Always route Stripe through `/api/stripe`. No exceptions.

### DEAD-002: Scraping G2/Capterra for pain signals
**What was tried:** Fetching `g2.com/categories` to find negative reviews and pain points.
**Why it fails:** Both sites block programmatic access. No CORS headers. IP bans on repeated requests.
**Also:** ToS violation on both platforms.
**Solution:** Use HN Algolia + Reddit `/api/reddit` proxy + YouTube Data API. These are confirmed working.

### DEAD-003: Auto-submitting to AI directories via API
**What was tried:** Programmatic form submission to Futurepedia, There's An AI For That, Toolify.
**Why it fails:** All AI directories use human review + form submission. No public API exists.
**Futurepedia:** $247 manual listing fee, editorial review.
**Solution:** Generate submission copy (product name, tagline, description, screenshot URL) and let human submit manually. Budget 5 minutes per directory.

### DEAD-004: Using Vercel Cron for agent scheduling
**What was tried:** Moving agent cron jobs from GitHub Actions to Vercel's built-in cron.
**Why abandoned:** Vercel Cron on free plan has severe limitations. Agent jobs need up to 300s — Vercel serverless max. GitHub Actions is free and more flexible.
**Solution:** Keep all cron agents in `.github/workflows/`. Do not migrate.

### DEAD-005: Sending email via Gmail API from browser
**What was tried:** Using Gmail API directly from `index.html` for lead nurture sequences.
**Why it fails:** Gmail API requires OAuth2 — not feasible for server-less browser calls.
**Solution:** Use Resend via `/api/email`. 3,000/mo free tier is sufficient.
