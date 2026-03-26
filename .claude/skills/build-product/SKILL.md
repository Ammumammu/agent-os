# SKILL: build-product
# Trigger: "build a product", "create a new SaaS tool", "build [keyword]"
# Use this skill to run the full 4-phase product build pipeline.

## Overview
Takes a keyword or pain point → generates spec → creates Stripe product → builds complete HTML tool → deploys to Vercel → publishes content.
Total time: ~2-3 minutes. Total AI cost: ~$0.06 (Sonnet for HTML generation only).

## Phase Checklist

### Phase 1: Start (~15s)
```
[ ] Validate keyword (demand score ≥ 7.0 unless force=true)
[ ] Check Supabase builds table for today's dedup (slug + YYYY-MM-DD)
[ ] Generate product spec with Groq (name, slug, ICP, price, pain)
[ ] Call /api/stripe { action: 'createFull', slug, name, monthly_usd }
[ ] Call /api/gumroad { action: 'createProduct', ...spec }
[ ] Create Supabase builds record { id: slug-date, status: 'running', phase: 'start' }
[ ] Return: { jobId, spec, stripeLink, gumroadLink }
```

### Phase 2: Build HTML (~30s)
```
[ ] Generate landing copy with Groq (headline, subhead, how-it-works, FAQs)
[ ] Call Claude Sonnet via /api/build { action: 'build_html' }
[ ] Validate HTML: </html> present, no Node.js APIs, GROQ_KEY set
[ ] Create GitHub repo via /api/github { action: 'createRepo' }
[ ] Push index.html, vercel.json, README.md via /api/github { action: 'pushFile' }
[ ] Update Supabase builds: { phase: 'build_html', phase2_data: { github_url } }
[ ] Return: { github_url, html_lines }
```

### Phase 3: Deploy (~45s)
```
[ ] Create Vercel project via /api/deploy { action: 'createProject' }
[ ] Poll deployment status every 10s until state === 'READY' (max 90s)
[ ] Test live URL returns 200 with curl
[ ] Update Supabase builds: { phase: 'deploy', phase3_data: { vercel_url } }
[ ] Return: { vercel_url, deployment_id }
```

### Phase 4: Finalize (~30s)
```
[ ] Generate 6 SEO pages with Groq (tutorial, comparison, template, listicle, examples, api)
[ ] Push SEO pages to GitHub under /blog/ and /examples/
[ ] Post Dev.to article via /api/devto { title, body_markdown }
[ ] Post Hashnode article via /api/hashnode { title, contentMarkdown }
[ ] Update public/portfolio.json with new product
[ ] Upsert to Pinecone memory: { type: 'product_launch', slug, ...metrics }
[ ] Update Supabase builds: { status: 'completed', phase4_data: { devto_url, ... } }
[ ] Return: { devto_url, hashnode_url, seo_pages: 6 }
```

## Success Output
```
✅ [product-name] LIVE!

🔗 Live URL:      https://[slug].vercel.app
💳 Stripe:        https://buy.stripe.com/...
🛍️ Gumroad:       https://[seller].gumroad.com/l/[slug]
📝 Dev.to:        https://dev.to/[username]/...
📊 PostHog:       https://app.posthog.com (events arriving)
🧠 Memory:        Pinecone updated
📦 GitHub:        https://github.com/[owner]/[slug]
```

## Error Recovery
| Error | Recovery |
|-------|----------|
| Stripe createFull fails | Check if existing Stripe product already has this slug |
| GitHub repo already exists | Use existing repo — check for sha and push with sha |
| Vercel deploy timeout | Wait 30s, check status again — usually resolves |
| Dev.to 422 | Title too long or duplicate — truncate title |
| Demand score < 7.0 | Don't skip — explain low score, ask if user wants to force build |

## Companion Files
None — this skill is self-contained.
