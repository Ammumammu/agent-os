# SKILL: seo-factory
# Trigger: "generate SEO pages", "create blog posts", "write SEO content for [keyword]"
# Generates 6 SEO pages per keyword and pushes to product GitHub repo.

## Overview
For each keyword/product: generates 6 types of SEO pages using Groq (free), pushes to GitHub,
Vercel auto-deploys. Pages start ranking 6-8 weeks after publish. Target: 50 pages/day at scale.

## 6 Page Types Per Keyword
```
/blog/how-to-[keyword]                ← tutorial, 1200 words, problem-first
/blog/best-[keyword]-tools            ← listicle, 800 words, include your tool
/blog/[competitor]-alternative        ← comparison, 800 words, your tool wins
/examples/[use-case]-template         ← template gallery, 400 words + template
/[product]/api                        ← developer landing, 600 words
/blog/[keyword]-for-[niche]           ← niche variant, 800 words
```

## Groq Prompt Templates

### Tutorial (how-to)
```
Write a 1200-word SEO tutorial about "[keyword]".
Structure:
  ## What Is [Keyword] and Why It Matters (200 words)
  ## The Old Way: Why Manual Methods Fail (150 words)
  ## Step-by-Step: How to [Keyword] in 2026 (500 words, 5 steps)
  ## Pro Tips and Common Mistakes (200 words)
  ## The Faster Way: [Tool Name] (150 words — soft pitch with URL)
Tone: practical guide, no fluff. First paragraph must contain target keyword.
Include 3 internal links to related blog posts on the same site.
```

### Comparison (alternative)
```
Write an 800-word SEO comparison: "[Competitor] vs [Our Tool]".
Structure:
  ## [Competitor] — What It Does Well (150 words — be fair)
  ## Where [Competitor] Falls Short (200 words — real limitations, not invented ones)
  ## How [Our Tool] Compares (300 words — feature table + narrative)
  ## Which Should You Choose? (150 words — honest recommendation)
Be objective. Real limitations only. Dishonest comparisons get flagged by Google.
Target keyword: "[competitor] alternative"
```

### Listicle (best tools)
```
Write an 800-word "Best [keyword] tools in 2026" list post.
Include: 7 tools total. [Our Tool] at position 2 or 3 (not #1 — that's less credible).
For each tool: name, what it does, price, best for, one limitation.
End with a comparison table.
Our tool should win on: ease of use + price.
```

## Page HTML Template
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>[PAGE_TITLE] — [PRODUCT_NAME]</title>
  <meta name="description" content="[META_DESCRIPTION_MAX_155_CHARS]">
  <link rel="canonical" href="https://[SLUG].vercel.app/[PATH]">
  <meta property="og:title" content="[PAGE_TITLE]">
  <meta property="og:description" content="[META_DESCRIPTION]">
  <script type="application/ld+json">
  { "@context": "https://schema.org", "@type": "Article",
    "headline": "[PAGE_TITLE]", "author": { "@type": "Organization", "name": "[PRODUCT_NAME]" } }
  </script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; max-width: 800px; margin: 0 auto; padding: 40px 20px; line-height: 1.7; }
    h1 { font-size: 2rem; margin-bottom: 1rem; }
    h2 { font-size: 1.4rem; margin-top: 2rem; }
    .cta { background: #6366f1; color: white; padding: 16px 32px; border-radius: 8px;
           text-decoration: none; display: inline-block; margin: 24px 0; font-weight: 600; }
  </style>
</head>
<body>
  <h1>[PAGE_TITLE]</h1>
  [CONTENT_HTML]
  <a href="https://[SLUG].vercel.app" class="cta">Try [PRODUCT_NAME] Free →</a>
  <footer style="margin-top:60px;color:#666;font-size:14px">
    <p><a href="https://[SLUG].vercel.app">← Back to [PRODUCT_NAME]</a></p>
  </footer>
</body>
</html>
```

## Push to GitHub
```js
for (const page of seoPages) {
  await apiCall('/api/github', {
    action: 'pushFile',
    owner: GITHUB_USERNAME,
    repo: slug,
    path: page.path,          // e.g., 'blog/how-to-invoice-freelancers.html'
    content: page.html,
    message: `seo: add ${page.type} page for "${keyword}"`,
  });
}
```

## vercel.json Update (ensure all routes served)
The product's vercel.json must NOT redirect blog/ and examples/ to index.html.
Check if it contains `"source": "/(.*)"` catch-all — if so, SEO pages won't be served.
Fix: add explicit routes before the catch-all.

## Output
```
✓ Generated 6 SEO pages for "[keyword]":
  /blog/how-to-[keyword].html         (1247 words)
  /blog/best-[keyword]-tools.html     (834 words)
  /blog/[competitor]-alternative.html (801 words)
  /examples/[use-case]-template.html  (423 words)
  /[product]/api.html                 (612 words)
  /blog/[keyword]-for-[niche].html    (789 words)
All pushed to GitHub. Vercel auto-deploying...
Indexing expected: 6-8 weeks.
```
