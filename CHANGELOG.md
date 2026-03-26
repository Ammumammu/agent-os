# CHANGELOG.md — Agent OS v7
# Versioned log of what shipped. Agent updates this after each merged feature.
# Format: newest first. One entry per meaningful deployment or feature completion.
# Last updated: 2026-03-26

---

## [Unreleased]

### Added
- `PRD.md` — product requirements document (source of truth for all sessions)
- `ROADMAP.md` — phase-gated checkbox roadmap
- `IMPLEMENTATION_STATUS.md` — per-component delivery state
- `DECISIONS.md` — architecture decision log (10 ADRs)
- `ERRORS_LOG.md` — recurring failures and dead ends
- `HANDOFF.md` — session continuity document
- `CHANGELOG.md` — this file
- `agent_docs/ENVIRONMENT.md` — complete env var reference with security classification
- `agent_docs/DEPLOYMENT.md` — CI/CD pipeline and deploy steps
- `.claude/agents/qa-validator.md` — read-only validation sub-agent
- `.claude/agents/planner.md` — orchestrator sub-agent for epic decomposition
- `HOOKS.md` — Claude Code hooks configuration for auto-validation
- `ACCEPTANCE_CRITERIA.md` — done-definitions per feature
- `specs/` directory with epic template format

---

## [0.8.0] — 2026-03-10

### Added
- 8 products launched in email + youtube niche:
  - Cold Email Writer (slug: `cold-email-writer-tool`)
  - FollowUp Writer (slug: `followup-writer`)
  - SubjectLine Pro (slug: `subjectline-pro`)
  - Cold Email Pro (slug: `cold-email-pro`)
  - Subject Craft Pro (slug: `subject-craft-pro`)
  - ApologyPro (slug: `apologypro`)
  - VidSpark (slug: `vidspark`)
  - Vid Title Pro (slug: `vid-title-pro`)
- All products: Stripe payment links attached (test mode)
- All products: PostHog + Supabase lead capture in HTML
- `public/portfolio.json` — portfolio tracking all live products

### Infrastructure
- `api/build.js` — 4-phase product pipeline (start, build_html, deploy, finalize)
- `api/stripe.js` — Stripe operations with createFull dedup
- `api/github.js` — repo + file management
- `api/deploy.js` — Vercel lifecycle with 120s polling
- `api/keywords.js` — market discovery entry point
- `api/content.js` — 6-type SEO page generation
- `api/publish.js` — Dev.to + Hashnode auto-publish
- `api/analytics.js` — revenue aggregation
- `api/health.js` — readiness probe
- `api/reddit.js`, `api/email.js`, `api/gumroad.js`, `api/posthog.js`
- `api/commerce.js`, `api/discover.js`, `api/viral.js`, `api/jobs.js`
- `lib/fetch-retry.js` — exponential backoff (10s, 30s, 60s)
- `lib/alert.js` — Slack + email failure alerts
- All 8 cron agents deployed as GitHub Actions workflows

### Configuration
- `CLAUDE.md` (project) — v7 project constitution
- `CLAUDE.local.md` — private local overrides template
- `AGENTS.md` — universal cross-tool brief
- `.claude/rules/` — code-style, api-conventions, agent-patterns
- `.claude/agents/` — builder-agent, market-researcher, analytics-reviewer
- `.claude/skills/` — build, daily-review
- `.claude/commands/` — build-product, deploy-pipeline, seo-factory
- `agent_docs/` — service_architecture, database_schema, service_communication_patterns, building_the_project, running_tests
- `supabase-schema.sql` — leads, products, builds, sales, payments tables

---

## [0.1.0] — Project initialization

### Added
- `index.html` — React 18 CDN dashboard (14 tabs)
- `vercel.json` — routing config
- `package.json` — `{ "type": "module" }`
- Initial `.env.example` with all required variables
- GitHub repo: agent-os
