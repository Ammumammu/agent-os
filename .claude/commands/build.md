# /project:build
# Usage: /project:build [keyword or pain point]
# Runs the complete 4-phase product build pipeline for the given keyword.

Run the full Agent OS v7 product build pipeline for the keyword or pain point provided.

## Steps to execute:

1. **Validate demand** — Check the demand score for the keyword using the pain scoring formula (frequency × 0.25 + intensity × 0.25 + willingness × 0.30 + solvability × 0.20). If score < 7.0, show the score and ask if user wants to proceed anyway.

2. **Check for duplicates** — Search Supabase builds table for `{slug}-{today's-date}`. If a non-failed build exists today, show its current status instead of starting a new one.

3. **Run Phase 1 (Start)** — Call `POST /api/build { action: 'start', keyword: '[KEYWORD]' }`. Show progress: "Phase 1/4: Creating spec + Stripe product..."

4. **Run Phase 2 (Build HTML)** — Call `POST /api/build { action: 'build_html', jobId }`. Show progress: "Phase 2/4: Generating HTML with Claude Sonnet..."

5. **Run Phase 3 (Deploy)** — Call `POST /api/build { action: 'deploy', jobId }`. Show progress: "Phase 3/4: Deploying to Vercel... (polling every 10s)"

6. **Run Phase 4 (Finalize)** — Call `POST /api/build { action: 'finalize', jobId }`. Show progress: "Phase 4/4: Publishing SEO + content..."

7. **Show result** — Display the complete product summary:
```
✅ [Product Name] is LIVE!

Live URL:    https://[slug].vercel.app
Stripe:      https://buy.stripe.com/...
Dev.to:      https://dev.to/...
GitHub:      https://github.com/[owner]/[slug]
Cost:        ~$0.06 (Sonnet) + $0.00 (Groq)
```

8. **Show next steps** — Suggest: "Post to Reddit using the copy in Traffic tab → open dashboard Traffic tab for pre-written post"

If any phase fails, show the error clearly and suggest the specific fix from `.claude/skills/build-product/SKILL.md`.
