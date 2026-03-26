// api/content.js — Programmatic SEO Content Factory
// Generates: tool landing pages, tutorials, comparisons, template galleries, listicles
// Engine: Groq (free, llama3-70b) for all content generation
// Output: HTML pages pushed to GitHub → served by Vercel

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { action, ...p } = req.body || {};
    switch (action) {
      case 'tool_landing':   return res.json(await generateToolLanding(p));
      case 'tutorial':       return res.json(await generateTutorial(p));
      case 'comparison':     return res.json(await generateComparison(p));
      case 'listicle':       return res.json(await generateListicle(p));
      case 'template_page':  return res.json(await generateTemplatePage(p));
      case 'dev_landing':    return res.json(await generateDevLanding(p));
      case 'niche_batch':    return res.json(await generateNicheBatch(p));
      case 'run':            return res.json(await generateNicheBatch({ keyword: 'ai productivity tools', toolName: 'AI Tool', toolUrl: 'https://example.vercel.app' }));
      default: return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// ─── Groq caller (free inference, auto-fallback across models) ───────────────
async function groq(prompt, system = 'You are an expert SEO content writer. Write in clear, helpful, direct prose.') {
  const MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'gemma2-9b-it'];
  let lastErr;
  for (const model of MODELS) {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 3000,
      }),
    });
    const d = await r.json();
    if (d.error) { lastErr = d.error.message; continue; }
    return d.choices?.[0]?.message?.content || '';
  }
  throw new Error(lastErr || 'All Groq models rate-limited');
}

// ─── 1. Tool Landing Page (/[keyword]) ───────────────────────────────────────
async function generateToolLanding({ keyword, toolName, toolUrl, productSlug }) {
  const content = await groq(`Write a compelling landing page for "${toolName}" that targets the keyword "${keyword}".

Include these sections:
1. Hero section (H1 with keyword, compelling subheadline, 2 CTAs)
2. Problem section (3 pain points this tool solves — be specific)
3. How it works (3 steps, very simple)
4. Features (5 bullet points with icons)
5. Social proof placeholder (we'll inject real PostHog numbers)
6. FAQ (5 Q&As, address real objections)
7. CTA section (final push to sign up)

Rules:
- Naturally include keyword "${keyword}" 4-6 times
- Target word count: 800-1000 words
- Tone: direct, helpful, no hype
- Include schema markup hints in HTML comments
- Format: clean HTML sections (no full page boilerplate, just content divs)`);

  return buildSEOPage({
    slug: productSlug || keyword.replace(/\s+/g, '-').toLowerCase(),
    title: `${toolName} — ${keyword}`,
    description: `${toolName} helps you ${keyword.toLowerCase()} in seconds. Free to try.`,
    keyword,
    content,
    toolUrl,
    pageType: 'tool_landing',
  });
}

// ─── 2. Tutorial Page (/blog/how-to-[keyword]) ───────────────────────────────
async function generateTutorial({ keyword, toolName, toolUrl }) {
  const content = await groq(`Write an in-depth tutorial: "How to ${keyword}" (target: 1200 words).

Structure:
## Why ${keyword} Matters (100 words — hook, why this skill/tool matters now)
## The Old Way (Manual Approach) (150 words — show the pain)
## How to ${keyword}: Step-by-Step (600 words — practical steps, numbered)
  Step 1: [actionable step]
  Step 2: [actionable step]
  Step 3: [actionable step]
  Step 4: [actionable step]
  Step 5: [final result]
## Common Mistakes to Avoid (200 words — 3 mistakes with fixes)
## Try It Free (100 words — CTA to ${toolName} at ${toolUrl})

Rules:
- Include "${keyword}" naturally 5-8 times
- Use subheadings (H2, H3)
- Include a tip box or callout
- Practical, actionable, no fluff
- End with internal links to related tools`);

  const slug = `how-to-${keyword.replace(/\s+/g, '-').toLowerCase()}`;
  return buildSEOPage({
    slug: `blog/${slug}`,
    title: `How to ${keyword} — Step-by-Step Guide`,
    description: `Learn how to ${keyword.toLowerCase()} with this step-by-step guide. Takes less than 5 minutes.`,
    keyword,
    content,
    toolUrl,
    pageType: 'tutorial',
  });
}

// ─── 3. Comparison Page (/blog/[competitor]-alternative) ─────────────────────
async function generateComparison({ keyword, toolName, toolUrl, competitor }) {
  const comp = competitor || `${keyword} tools`;
  const content = await groq(`Write a comparison article: "${toolName} vs ${comp} — Which Is Better?" (target: 900 words).

Structure:
## Overview (100 words — brief intro of both options)
## ${toolName} vs ${comp}: Feature Comparison (300 words — comparison table in HTML + prose)
  Features: ease of use, speed, price, AI quality, output formats, integrations
## When to Choose ${toolName} (200 words — specific use cases where we win)
## When to Choose ${comp} (150 words — be honest, builds trust)
## Pricing Comparison (100 words — fair comparison)
## Our Verdict (100 words — summary + CTA to try ${toolName})

Rules:
- Honest comparison — don't trash competitors, just be objective
- Naturally include "${keyword}" 4-6 times
- Include a proper HTML comparison table
- CTA at end: try ${toolName} free at ${toolUrl}`);

  const slug = `${comp.replace(/\s+/g, '-').toLowerCase()}-alternative`;
  return buildSEOPage({
    slug: `blog/${slug}`,
    title: `${toolName} vs ${comp} — Best ${keyword} Tool in 2025`,
    description: `Comparing ${toolName} and ${comp} for ${keyword}. See which is faster, cheaper, and easier.`,
    keyword,
    content,
    toolUrl,
    pageType: 'comparison',
  });
}

// ─── 4. Listicle (/blog/best-[category]-tools) ───────────────────────────────
async function generateListicle({ keyword, toolName, toolUrl, category }) {
  const cat = category || keyword;
  const content = await groq(`Write a listicle: "7 Best ${cat} Tools in 2025" (target: 1000 words).

Structure:
## Why You Need a ${cat} Tool (100 words — the problem)
## 7 Best ${cat} Tools (700 words — 7 tools, 100 words each)
  For each tool:
  ### [Tool Name] — [one-line tagline]
  **Best for:** [specific use case]
  **Pricing:** [price or free tier]
  [2-3 sentences about what makes it good/unique]

  IMPORTANT: Make ${toolName} (${toolUrl}) #1 on the list. Give it the most detail.
  Include 6 real competitor tools (HubSpot, Canva, Copy.ai, Jasper, etc. — pick relevant ones).

## How to Choose the Right Tool (150 words — decision framework)
## Final Recommendation (50 words — push ${toolName})

Rules:
- Keyword "${keyword}" used 5-7 times naturally
- Balanced coverage but ${toolName} clearly wins
- Include pricing info for all tools (builds trust)`);

  const slug = `best-${cat.replace(/\s+/g, '-').toLowerCase()}-tools`;
  return buildSEOPage({
    slug: `blog/${slug}`,
    title: `7 Best ${cat} Tools in 2025 (Ranked & Reviewed)`,
    description: `The best ${cat.toLowerCase()} tools compared. See pricing, features, and which one is right for you.`,
    keyword,
    content,
    toolUrl,
    pageType: 'listicle',
  });
}

// ─── 5. Template/Example Page (/examples/[use-case]-template) ────────────────
async function generateTemplatePage({ keyword, toolName, toolUrl, useCase }) {
  const uc = useCase || keyword;
  const content = await groq(`Write a template gallery page for "${uc}" (target: 800 words).

Structure:
## ${uc} Templates — Free & Ready to Use (hero section, 100 words)
## 5 ${uc} Templates (core content — 500 words)
  For each template:
  ### Template [N]: [Descriptive Name]
  **Use this when:** [specific situation]
  **Template:**
  \`\`\`
  [actual template content — make it genuinely useful]
  \`\`\`
  [1 sentence tip for customizing]
## How to Use These Templates (100 words — practical tips)
## Generate Custom Templates with ${toolName} (100 words — CTA)

Rules:
- Templates must be genuinely useful — not placeholder text
- Each template should be 50-150 words of real content
- Include the keyword "${keyword}" 4-5 times
- CTA to use ${toolName} at ${toolUrl} to generate unlimited templates`);

  const slug = `examples/${uc.replace(/\s+/g, '-').toLowerCase()}-template`;
  return buildSEOPage({
    slug,
    title: `${uc} Templates — 5 Free Examples (Copy & Use)`,
    description: `Free ${uc.toLowerCase()} templates you can copy and use immediately. Or generate custom ones with AI.`,
    keyword,
    content,
    toolUrl,
    pageType: 'template',
  });
}

// ─── 6. Developer Landing Page (/[product]/api) ──────────────────────────────
async function generateDevLanding({ toolName, toolUrl, productSlug, coreFeature }) {
  const content = await groq(`Write a developer-focused landing page for the ${toolName} API (target: 600 words).

Structure:
## ${toolName} API — Integrate ${coreFeature || toolName} into Your App (hero)
## Quick Start (code example in JavaScript — realistic, working-looking)
  \`\`\`js
  const response = await fetch('${toolUrl}/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer YOUR_API_KEY' },
    body: JSON.stringify({ input: 'your content here' })
  });
  const { output } = await response.json();
  \`\`\`
## API Reference (table: endpoint, method, description, example response)
## Pricing (free tier: 100 req/mo, pro: $9/mo unlimited)
## Get Your API Key (CTA → ${toolUrl}/api-key)

Rules:
- Clear, technical, no marketing fluff
- Show realistic code examples
- Include rate limits and authentication info`);

  return buildSEOPage({
    slug: `${productSlug || toolName.toLowerCase().replace(/\s+/g, '-')}/api`,
    title: `${toolName} API — Integrate AI ${coreFeature || toolName} into Your App`,
    description: `${toolName} API docs. Integrate AI-powered ${(coreFeature || toolName).toLowerCase()} into your app in minutes.`,
    keyword: `${toolName} API`,
    content,
    toolUrl,
    pageType: 'api_docs',
  });
}

// ─── 7. Niche Batch — generate all 6 page types for a keyword ────────────────
async function generateNicheBatch({ keyword, toolName, toolUrl, productSlug, competitor }) {
  const [landing, tutorial, comparison, listicle, template] = await Promise.allSettled([
    generateToolLanding({ keyword, toolName, toolUrl, productSlug }),
    generateTutorial({ keyword, toolName, toolUrl }),
    generateComparison({ keyword, toolName, toolUrl, competitor }),
    generateListicle({ keyword, toolName, toolUrl }),
    generateTemplatePage({ keyword, toolName, toolUrl }),
  ]);

  return {
    keyword,
    toolName,
    pages: {
      landing:    landing.status === 'fulfilled' ? landing.value : { error: landing.reason?.message },
      tutorial:   tutorial.status === 'fulfilled' ? tutorial.value : { error: tutorial.reason?.message },
      comparison: comparison.status === 'fulfilled' ? comparison.value : { error: comparison.reason?.message },
      listicle:   listicle.status === 'fulfilled' ? listicle.value : { error: listicle.reason?.message },
      template:   template.status === 'fulfilled' ? template.value : { error: template.reason?.message },
    },
    total: 5,
    generatedAt: new Date().toISOString(),
  };
}

// ─── Page builder: wraps content in full SEO-optimized HTML ──────────────────
function buildSEOPage({ slug, title, description, keyword, content, toolUrl, pageType }) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(title)}</title>
  <meta name="description" content="${escHtml(description)}">
  <meta property="og:title" content="${escHtml(title)}">
  <meta property="og:description" content="${escHtml(description)}">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary">
  <link rel="canonical" href="${toolUrl}/${slug}">
  <!-- Schema.org -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "${pageType === 'tutorial' ? 'HowTo' : 'WebPage'}",
    "name": "${escJson(title)}",
    "description": "${escJson(description)}",
    "url": "${toolUrl}/${slug}"
  }
  </script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Inter',sans-serif;background:#fff;color:#1a1a1a;line-height:1.7;max-width:800px;margin:0 auto;padding:40px 24px}
    h1{font-size:2.2rem;font-weight:800;line-height:1.2;margin-bottom:16px;color:#0f172a}
    h2{font-size:1.6rem;font-weight:700;margin:40px 0 16px;color:#0f172a}
    h3{font-size:1.2rem;font-weight:600;margin:24px 0 12px;color:#1e293b}
    p{margin-bottom:16px;color:#374151}
    ul,ol{padding-left:24px;margin-bottom:16px}
    li{margin-bottom:8px;color:#374151}
    table{width:100%;border-collapse:collapse;margin:24px 0}
    th,td{padding:12px;text-align:left;border:1px solid #e5e7eb}
    th{background:#f9fafb;font-weight:600}
    code{background:#f1f5f9;padding:2px 6px;border-radius:4px;font-family:monospace;font-size:.9em}
    pre{background:#1e293b;color:#e2e8f0;padding:20px;border-radius:8px;overflow-x:auto;margin:24px 0}
    pre code{background:none;padding:0;color:inherit}
    .cta{display:inline-block;background:#6366f1;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:1rem;margin:8px 0}
    .cta:hover{opacity:.9}
    nav a{color:#6366f1;text-decoration:none;margin-right:16px;font-size:.9rem}
    footer{margin-top:64px;padding-top:24px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:.875rem;text-align:center}
    blockquote{border-left:4px solid #6366f1;padding:12px 20px;background:#f8f9ff;margin:24px 0;border-radius:0 8px 8px 0}
  </style>
</head>
<body>
  <nav>
    <a href="${toolUrl}">← Back to Tool</a>
    <a href="${toolUrl}/blog">Blog</a>
  </nav>
  <article>
    ${content}
  </article>
  <div style="margin:48px 0;padding:32px;background:#f8f9ff;border-radius:12px;text-align:center">
    <h3 style="margin-bottom:12px">Try it free — no signup required</h3>
    <a href="${toolUrl}" class="cta">Open ${escHtml(title.split('—')[0].trim())} →</a>
  </div>
  <footer>
    <p>Generated by Agent OS · <a href="${toolUrl}">${toolUrl}</a></p>
  </footer>
</body>
</html>`;

  return { slug, title, description, keyword, html, pageType, generatedAt: new Date().toISOString() };
}

function escHtml(str = '') { return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function escJson(str = '') { return str.replace(/"/g, '\\"').replace(/\n/g, '\\n'); }
