# specs/epic-template.md
# Copy this file to specs/[epic-name].md when starting a new multi-session epic.
# The planner agent reads all specs/ files to understand in-flight work.
# Last updated: 2026-03-26

---

# Epic: [Epic Name]
**Status:** [ ] Not Started | [-] In Progress | [x] Done
**Owner:** Claude (autonomous) | Human-assisted | Human-required
**Started:** YYYY-MM-DD
**Target:** YYYY-MM-DD
**Phase:** [ROADMAP.md phase this belongs to]

## Goal
[One paragraph: what does success look like? What problem does this epic solve?]

## Acceptance Criteria
[Reference the relevant section from ACCEPTANCE_CRITERIA.md]
- All criteria from ACCEPTANCE_CRITERIA.md "[Feature Name]" section must pass

## Context
[What prior work does this depend on? What decisions from DECISIONS.md apply?]
- Builds on: [prior epic or ADR]
- Blocked by: [dependency or none]

---

## Task Breakdown

### TASK-001: [Task Name]
- **Status:** [ ] Not Started | [-] In Progress | [x] Done YYYY-MM-DD
- **Agent:** [qa-validator | builder-agent | market-researcher | analytics-reviewer | planner | human]
- **Depends on:** [TASK-XXX | none]
- **Parallel with:** [TASK-XXX | none]
- **Conflicts with:** [TASK-XXX | none]
- **Input:** [what this task needs to start]
- **Output:** [what this task produces — be specific]
- **Description:**
  [Specific, actionable instructions. Enough that an agent can execute this without asking questions.
   Include: exact API calls, file paths, expected outputs, validation steps.]

### TASK-002: [Task Name]
- **Status:** [ ] Not Started
- **Agent:** [agent]
- **Depends on:** TASK-001
- **Parallel with:** none
- **Conflicts with:** none
- **Input:** Output from TASK-001
- **Output:** [specific deliverable]
- **Description:**
  [Specific instructions]

### TASK-003: [Task Name — Human Required]
- **Status:** [ ] Not Started
- **Agent:** HUMAN
- **Depends on:** TASK-002
- **Parallel with:** none
- **Time required:** [N minutes]
- **Description:**
  [Exact steps the human needs to take. Copy-paste ready.]

---

## Execution Graph

```
TASK-001 ──→ TASK-002 ──→ TASK-004
              ↓
            TASK-003 (parallel with TASK-002)
              ↓
            TASK-005
```

## Lessons Learned
[Updated when epic is complete. What worked? What would you do differently?]
[Copy the most important lesson to ERRORS_LOG.md or DECISIONS.md if applicable.]

---

# Example: Real Epic — "Fix PostHog + Launch Reddit Traffic"

# Epic: PostHog Verification and Reddit Launch
**Status:** [-] In Progress
**Owner:** Claude (autonomous) + Human-assisted
**Started:** 2026-03-26
**Target:** 2026-03-28
**Phase:** Phase 2 — Traffic & Conversion

## Goal
Verify PostHog is receiving real events from all 8 live products, fix any placeholder keys,
then generate and post Reddit content for the top 3 products to drive first traffic.

## Acceptance Criteria
- All criteria from ACCEPTANCE_CRITERIA.md "PostHog Analytics" section pass
- All criteria from ACCEPTANCE_CRITERIA.md "Marketing Copy Delivered" section pass for 3 products

## Context
- 8 products live since 2026-03-10, $0 MRR — traffic problem not product problem
- ERRORS_LOG ERR-006: PostHog keys may be placeholders in live HTML
- DECISIONS ADR-008: No dashboard auth — product URLs are public

---

## Task Breakdown

### TASK-001: Audit PostHog in all 8 live products
- **Status:** [ ] Not Started
- **Agent:** qa-validator
- **Depends on:** none
- **Parallel with:** TASK-002
- **Conflicts with:** none
- **Input:** `public/portfolio.json` (list of live products with vercel_url)
- **Output:** Report listing which products have real vs placeholder PostHog key
- **Description:**
  For each product in portfolio.json: fetch the vercel_url HTML, grep for POSTHOG_KEY value.
  If value starts with "phc_" and is longer than 20 chars: REAL. Otherwise: PLACEHOLDER.
  Report format: product name | key status | vercel_url.

### TASK-002: Audit Stripe payment links in all 8 products
- **Status:** [ ] Not Started
- **Agent:** qa-validator
- **Depends on:** none
- **Parallel with:** TASK-001
- **Conflicts with:** none
- **Input:** `public/portfolio.json`
- **Output:** Report listing which products have real vs test Stripe links
- **Description:**
  For each product: check stripe_link in portfolio.json. If it contains "test_": TEST MODE.
  If it contains "buy.stripe.com/[a-z0-9]+": LIVE. If empty: MISSING.

### TASK-003: Fix placeholder PostHog keys
- **Status:** [ ] Not Started
- **Agent:** builder-agent
- **Depends on:** TASK-001
- **Parallel with:** none
- **Conflicts with:** none
- **Input:** TASK-001 report of products with placeholder keys; real PostHog write key from CLAUDE.local.md
- **Output:** Updated index.html files pushed to GitHub; re-deploys triggered
- **Description:**
  For each product where TASK-001 found PLACEHOLDER:
  1. GET current index.html via /api/github getFile (save SHA)
  2. Replace placeholder PostHog key with real key
  3. PUT updated file via /api/github pushFile (include SHA)
  4. Trigger re-deploy via /api/deploy triggerDeploy
  5. Wait for READY state (max 120s)
  6. Verify: curl product URL, check browser DevTools Network shows posthog requests

### TASK-004: Generate Reddit copy for top 3 products
- **Status:** [ ] Not Started
- **Agent:** market-researcher
- **Depends on:** TASK-001 (need to know which products are verified working)
- **Parallel with:** none
- **Conflicts with:** none
- **Input:** List of verified products from TASK-001; product specs from portfolio.json
- **Output:** 3 Reddit posts (authentic founder voice, ready to paste)
- **Description:**
  Select top 3 products where TASK-001 shows REAL PostHog key (verified working).
  Use generateRedditPost() pattern from CLAUDE.md. Target subreddits:
    - Email tools → r/entrepreneur, r/SideProject
    - YouTube tools → r/youtubers, r/NewTubers
  Format: personal story (no product mention) → attempt → discovery → link.
  Max 300 words. No bullet points. No marketing language.

### TASK-005: Post to Reddit [HUMAN]
- **Status:** [ ] Not Started
- **Agent:** HUMAN
- **Depends on:** TASK-004
- **Time required:** 15 minutes (3 products × 5 min each)
- **Description:**
  1. Open dashboard Traffic tab → copy Reddit post for each of the 3 products
  2. Navigate to the target subreddit (shown in each post's header)
  3. Paste post, submit
  4. Screenshot confirmation and save to .claude/tmp/reddit-posts-YYYY-MM-DD.txt
  5. Update this task to [x] Done with the Reddit post URLs

---

## Execution Graph

```
TASK-001 (audit PostHog) ──┐
                           ├──→ TASK-003 (fix placeholders) ──→ verify live
TASK-002 (audit Stripe) ───┘
                           ↓
                        TASK-004 (generate Reddit copy) ──→ TASK-005 [HUMAN: post]
```

## Lessons Learned
*(to be filled when epic is complete)*
