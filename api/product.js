// api/product.js — SaaS Product Spec Generation
// Takes keyword → generates complete product spec using Groq (free)
// Output feeds directly into builder-agent

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { action, ...p } = req.body || {};

    switch (action) {
      case 'generate_spec': return res.json(await generateSpec(p));
      case 'generate_copy': return res.json(await generateCopy(p));
      case 'generate_html': return res.json(await generateHTML(p));
      case 'validate_code': return res.json(await validateCode(p.html));
      case 'score_idea': return res.json(scoreIdea(p));
      case 'full_spec': return res.json(await fullSpec(p));
      case 'run': return res.json(await fullSpec(p));
      default: return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// ─── Groq (free inference) ────────────────────────────────────────────────────
async function groq(prompt, system, maxTokens = 2000) {
  const MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'gemma2-9b-it'];
  let lastErr;
  for (const model of MODELS) {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system || 'You are an expert SaaS product designer. Return only valid JSON.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        max_tokens: maxTokens,
      }),
    });
    const d = await r.json();
    if (d.error) { lastErr = d.error.message; continue; }
    return d.choices?.[0]?.message?.content || '';
  }
  throw new Error(lastErr || 'All Groq models rate-limited');
}

// ─── Claude Sonnet (Primary) with Moonshot/NVIDIA Kimi K2.5 (Fallback) ────────
async function claude(prompt, system) {
  const sysMsg = system || 'You are an expert frontend developer. Generate complete, production-ready HTML.';

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 8192,
          system: sysMsg,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      const d = await r.json();
      if (!d.error && d.content && d.content[0]) return d.content[0].text;
      console.warn('Anthropic Error:', d.error);
    } catch (e) { console.warn('Anthropic fetch failed:', e); }
  }

  if (process.env.MOONSHOT_API_KEY) {
    try {
      const r = await fetch('https://api.moonshot.cn/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.MOONSHOT_API_KEY}` },
        body: JSON.stringify({
          model: 'moonshot-v1-32k',
          messages: [{ role: 'system', content: sysMsg }, { role: 'user', content: prompt }]
        })
      });
      const d = await r.json();
      if (!d.error) return d.choices?.[0]?.message?.content || '';
      console.warn('Moonshot Error:', d.error);
    } catch (e) { console.warn('Moonshot fetch failed:', e); }
  }

  const r = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.NVIDIA_API_KEY}` },
    body: JSON.stringify({
      model: process.env.NVIDIA_MODEL || 'moonshotai/kimi-k2.5',
      max_tokens: 16384,
      temperature: 0.7,
      top_p: 1,
      stream: false,
      messages: [{ role: 'system', content: sysMsg }, { role: 'user', content: prompt }],
    }),
  });
  const d = await r.json();
  if (d.error) {
    try {
      // Last resort: Groq
      const rGroq = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'system', content: sysMsg }, { role: 'user', content: prompt }]
        })
      });
      const dGroq = await rGroq.json();
      if (!dGroq.error) return dGroq.choices?.[0]?.message?.content || '';
    } catch (_) { }
    throw new Error(d.error.message || JSON.stringify(d.error));
  }
  return d.choices?.[0]?.message?.content || '';
}

// ─── 1. Generate product spec from keyword ────────────────────────────────────
async function generateSpec({ keyword, sourceData }) {
  const raw = await groq(`Generate a complete product spec for a micro-SaaS tool targeting the keyword: "${keyword}"
Evidence from market research: ${JSON.stringify(sourceData || {}).slice(0, 400)}

Return this exact JSON structure (no markdown, no explanation):
{
  "name": "descriptive tool name (2-4 words, not generic)",
  "slug": "lowercase-hyphenated-unique-slug",
  "tagline": "pain-first tagline under 60 chars",
  "icp": "specific person: job title + context (e.g., 'freelance designer invoicing clients')",
  "pain_point": "exact problem in one sentence",
  "core_feature": "the single main thing this tool does",
  "secondary_features": ["feature 2", "feature 3"],
  "free_limit": 2,
  "pricing": { "monthly_usd": 9, "one_time_usd": 19 },
  "target_subreddit": "most relevant subreddit name (no r/)",
  "founder_story": "why I would personally have this problem (2 sentences, first person)",
  "viral_attribution": "Generated by [name] — [slug].vercel.app",
  "type": "stateless",
  "demand_score": 7.5,
  "keywords": ["primary keyword", "secondary keyword", "long-tail keyword"],
  "competitor": "main competitor name (e.g., ChatGPT, Copy.ai)",
  "category": "one of: resume|youtube|seo|email|marketing|image|pdf|coding|other"
}`);

  const spec = parseJSON(raw);
  if (!spec) throw new Error('Failed to parse spec JSON from Groq');
  return { spec, keyword, generatedAt: new Date().toISOString() };
}

// ─── 2. Generate landing page copy from spec ──────────────────────────────────
async function generateCopy({ spec }) {
  const raw = await groq(`Generate landing page copy for this SaaS tool. Return only valid JSON.

Tool: ${spec.name}
Pain: ${spec.pain_point}
ICP: ${spec.icp}
Price: $${spec.pricing?.monthly_usd}/mo or $${spec.pricing?.one_time_usd} one-time
Core feature: ${spec.core_feature}

Return this exact JSON:
{
  "headline": "pain-first, ≤8 words, no 'is' as verb",
  "subheadline": "who + what + how fast, ≤15 words",
  "how_it_works": ["step1 (5 sec)", "step2 (10 sec)", "result (instant)"],
  "benefits": ["specific benefit with number or timeframe", "benefit 2", "benefit 3"],
  "objections": [
    {"q": "biggest objection", "a": "specific, honest answer"},
    {"q": "second objection", "a": "honest answer"}
  ],
  "cta": "action verb + immediate benefit (≤5 words)",
  "trust_signal": "specific claim (e.g., '2,341 outputs generated this week')",
  "paywall_headline": "You've used your N free [outputs] 🎉",
  "paywall_sub": "Clearly useful. Unlock unlimited for $X/mo."
}`);

  const copy = parseJSON(raw);
  if (!copy) throw new Error('Failed to parse copy JSON from Groq');
  return { copy, spec_name: spec.name };
}

// ─── 3. Generate complete product HTML (Claude Sonnet ~$0.06) ─────────────────
async function generateHTML({ spec, copy, stripeLink, gumroadLink }) {
  const groqKey = process.env.GROQ_API_KEY || '';
  const posthogKey = process.env.POSTHOG_WRITE_KEY || '';
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseAnon = process.env.SUPABASE_ANON_KEY || '';

  const prompt = `Build a complete, single-file React SaaS tool called "${spec.name}".

SPEC:
- Pain point: ${spec.pain_point}
- Core feature: ${spec.core_feature}
- ICP: ${spec.icp}
- Free limit: ${spec.free_limit || 3} uses
- Price: $${spec.pricing?.monthly_usd || 9}/mo

LANDING COPY:
- Headline: ${copy.headline}
- Subheadline: ${copy.subheadline}
- How it works: ${copy.how_it_works?.join(' → ')}
- CTA: ${copy.cta}

PAYMENT LINKS (use these EXACT URLs — do NOT invent placeholder URLs):
- Stripe: ${stripeLink || 'STRIPE_LINK_NOT_SET'}
- Gumroad: ${gumroadLink || 'GUMROAD_LINK_NOT_SET'}

═══════════════════════════════════════════════════════════════════════
CRITICAL CDN URLS — USE THESE EXACT URLS, DO NOT INVENT YOUR OWN:
═══════════════════════════════════════════════════════════════════════

<script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>

═══════════════════════════════════════════════════════════════════════
CRITICAL: BABEL IS REQUIRED — WITHOUT IT THE PAGE WILL BE BLANK
═══════════════════════════════════════════════════════════════════════

The React component script tag MUST be: <script type="text/babel">
Without type="text/babel", the browser cannot parse JSX and the page renders BLANK.

═══════════════════════════════════════════════════════════════════════
GROQ API — USE THIS EXACT CODE FOR AI CALLS (CORS-enabled, works in browser):
═══════════════════════════════════════════════════════════════════════

async function callGroq(userPrompt, systemPrompt) {
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + CONFIG.GROQ_KEY
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt || "You are a helpful assistant." },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 2000
    })
  });
  const d = await r.json();
  return d.choices?.[0]?.message?.content || "";
}

═══════════════════════════════════════════════════════════════════════
CONFIG OBJECT — USE THESE EXACT VALUES (not placeholders):
═══════════════════════════════════════════════════════════════════════

const CONFIG = {
  GROQ_KEY: "${groqKey}",
  SUPABASE_URL: "${supabaseUrl}",
  SUPABASE_ANON: "${supabaseAnon}",
  POSTHOG_KEY: "${posthogKey}",
  STRIPE_LINK: "${stripeLink || ''}",
  GUMROAD_LINK: "${gumroadLink || ''}",
  FREE_LIMIT: ${spec.free_limit || 3},
  PRODUCT_NAME: "${spec.name}",
  PRODUCT_URL: "https://${spec.slug}.vercel.app",
};

═══════════════════════════════════════════════════════════════════════

REQUIREMENTS:
1. Complete <!DOCTYPE html> page with the EXACT CDN urls above
2. All React JSX inside <script type="text/babel"> (MANDATORY)
3. Groq calls use the EXACT callGroq function above (CORS-enabled, direct browser fetch)
4. Three views: landing → tool → paywall
5. Free limit: ${spec.free_limit || 3} uses tracked in localStorage, then show paywall
6. Email capture in paywall (+3 free uses on submit)
7. PostHog: init with CONFIG.POSTHOG_KEY, events: tool_opened, tool_used, free_limit_hit, paywall_shown, payment_clicked, email_captured
8. Supabase lead capture: const sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON)
9. Viral attribution in every AI output: "Generated by ${spec.name} — ${spec.slug}.vercel.app"
10. Dark theme: background #0f172a, surface #1e293b, accent #6366f1
11. Font: Inter from Google Fonts CDN
12. Mobile responsive
13. ReactDOM.createRoot(document.getElementById('root')).render(<App />)
14. The Stripe paywall link must use the EXACT CONFIG.STRIPE_LINK value
15. No TypeScript, no build step, no imports, no require()

Return ONLY the complete HTML file. No explanation. No markdown fences.`;

  let html = await claude(prompt);

  // Strip markdown fences if model wrapped the output
  html = html.replace(/^```html?\s*\n?/i, '').replace(/\n?```\s*$/i, '');

  if (!html.includes('</html>')) throw new Error('HTML generation incomplete — missing </html>');
  return { html, spec_name: spec.name, slug: spec.slug };
}

// ─── 4. Validate HTML for common issues ──────────────────────────────────────
function validateCode(html = '') {
  const errors = [];
  const warnings = [];

  // Structure
  if (!html.includes('<!DOCTYPE html>')) errors.push('Missing DOCTYPE');
  if (!html.includes('</html>')) errors.push('Missing closing </html>');
  if (!html.includes('<div id="root"')) errors.push('Missing <div id="root"> mount point');

  // React + Babel CDN (CRITICAL — without Babel, JSX = blank page)
  if (!html.includes('react@18') && !html.includes('react.production'))
    errors.push('Missing React 18 CDN');
  if (!html.includes('react-dom@18') && !html.includes('react-dom.production'))
    errors.push('Missing ReactDOM 18 CDN');
  if (!html.includes('@babel/standalone') && !html.includes('babel.min.js'))
    errors.push('Missing Babel standalone — JSX will not compile, page will be BLANK');
  if (!html.includes('type="text/babel"'))
    errors.push('Missing type="text/babel" on script tag — JSX will not compile');

  // Fake/placeholder CDN URLs
  if (html.includes('example.com'))
    errors.push('Contains example.com placeholder URL — will fail to load');

  // Groq API (must use the correct CORS-enabled endpoint)
  if (html.includes('api.groq.com') && !html.includes('api.groq.com/openai/v1/chat/completions'))
    errors.push('Wrong Groq API endpoint — must use api.groq.com/openai/v1/chat/completions');
  if (html.includes('/api/groq'))
    warnings.push('/api/groq called but product repos have no serverless functions — use direct Groq CORS call instead');

  // Placeholder detection
  const placeholders = [
    'CONFIG.GROQ_KEY"', "CONFIG.GROQ_KEY'",
    'your-supabase', 'YOUR_SUPABASE', 'your-posthog', 'YOUR_POSTHOG',
    'placeholder-', 'PLACEHOLDER',
  ];
  for (const p of placeholders) {
    if (html.includes(p)) errors.push(`Placeholder value detected: "${p}" — real keys must be injected`);
  }

  // Analytics
  if (!html.includes('posthog')) warnings.push('Missing PostHog analytics');

  // Payment
  if (!html.includes('stripe.com') && !html.includes('CONFIG.STRIPE') && !html.includes('STRIPE_LINK'))
    warnings.push('No Stripe payment link found');

  // Security
  if (html.includes('process.env')) errors.push('process.env found in browser HTML — security risk');
  if (html.includes('require(')) errors.push('require() found in browser HTML — not supported');

  // React API
  if (html.includes('ReactDOM.render(') && !html.includes('createRoot'))
    warnings.push('Using deprecated ReactDOM.render() — use ReactDOM.createRoot() for React 18');

  const valid = errors.length === 0;
  return { valid, errors, warnings, length: html.length };
}

// ─── 5. Score a product idea (0-10) ──────────────────────────────────────────
function scoreIdea({ keyword = '', pain_signals = 0, competition = 'medium', icp = '' }) {
  let score = 5.0;
  if (/ai|gpt|automat|generat/.test(keyword.toLowerCase())) score += 1.0;
  if (/resume|email|seo|youtube|invoice/.test(keyword.toLowerCase())) score += 1.5;
  if (pain_signals > 100) score += 1.0;
  if (pain_signals > 500) score += 0.5;
  if (competition === 'low') score += 1.0;
  if (competition === 'high') score -= 1.0;
  if (icp.includes('freelance') || icp.includes('solopreneur')) score += 0.5;
  return { score: Math.min(10, Math.max(1, Math.round(score * 10) / 10)), keyword, recommended: score >= 7.0 };
}

// ─── 6. Full spec pipeline (spec + copy + score) in one call ─────────────────
async function fullSpec({ keyword, sourceData }) {
  const { spec } = await generateSpec({ keyword, sourceData });
  const { copy } = await generateCopy({ spec });
  const scored = scoreIdea({ keyword, icp: spec.icp });
  return { spec: { ...spec, demand_score: scored.score }, copy, keyword };
}

function parseJSON(text = '') {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch (_) { return null; }
}
