#!/usr/bin/env node
// agents/seo-agent.js — SEO Content Factory Loop (Loop 2)
// FIXED: Content generated locally (direct Groq) — bypasses Vercel 60s timeout
// Pushes only final HTML to GitHub via /api/github

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { fetchWithRetry } from '../lib/fetch-retry.js';
import { sendAlert } from '../lib/alert.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.AGENT_OS_URL || 'http://localhost:3000';
if (!process.env.AGENT_OS_URL) console.warn('[seo-agent] ⚠️  AGENT_OS_URL not set — add it to GitHub Secrets (your Vercel deployment URL)');
const QUEUE_FILE = join(__dirname, '../products/build-queue.json');
const SEO_LOG = join(__dirname, '../products/seo-agent.log');
const GITHUB_USERNAME = process.env.GITHUB_USERNAME;
const SEO_REPO = process.env.SEO_REPO || 'seo-pages';

// ─── Groq — direct call (no Vercel hop, no timeout) ──────────────────────────
const GROQ_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-70b-versatile',
  'llama-3.1-8b-instant',
  'gemma2-9b-it',
];

async function groq(prompt, maxTokens = 3000) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY not set');
  let lastErr;
  for (const model of GROQ_MODELS) {
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'You are an expert SEO content writer. Write clear, helpful, direct prose with no fluff.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.7,
          max_tokens: maxTokens,
        }),
      });
      const d = await r.json();
      if (d.error) {
        lastErr = d.error.message;
        // Rate limit — wait and retry on next model
        if (d.error.code === 'rate_limit_exceeded') await sleep(3000);
        continue;
      }
      const text = d.choices?.[0]?.message?.content || '';
      if (text) return text;
      lastErr = 'Empty response';
    } catch (e) {
      lastErr = e.message;
    }
  }
  throw new Error(lastErr || 'All Groq models failed');
}

async function run() {
  log('📝 seo-agent starting...');

  const queue = loadQueue();
  if (!queue) { log('❌ No build queue found. Run market-agent first.'); return; }

  const keywords = [
    ...queue.build_queue,
    ...queue.seo_queue.slice(0, 10),
  ];

  log(`Processing ${keywords.length} keywords for SEO content...`);

  const results = [];
  let pageCount = 0;

  for (const kw of keywords) {
    try {
      log(`Generating pages for: "${kw.keyword}"...`);
      const pages = await generatePagesForKeyword(kw);
      pageCount += pages.length;
      results.push({ keyword: kw.keyword, pages: pages.length, status: 'done' });

      if (pages.length > 0 && GITHUB_USERNAME) {
        await pushPagesToGitHub(pages, kw.keyword);
      }

      await sleep(2000); // Groq rate limit between keywords
    } catch (e) {
      log(`❌ Error on "${kw.keyword}": ${e.message}`);
      results.push({ keyword: kw.keyword, pages: 0, status: 'error', error: e.message });
    }
  }

  // Niche slug pages
  if (queue.niche_slugs?.length > 0) {
    log(`Generating ${Math.min(queue.niche_slugs.length, 20)} niche variant pages...`);
    await generateNichePages(queue.niche_slugs.slice(0, 20));
  }

  // Generate sitemap.xml + seo-links.json and push to main repo
  await generateSEOIndex(results, keywords);

  const summary = {
    date: new Date().toISOString().split('T')[0],
    keywords_processed: keywords.length,
    pages_generated: pageCount,
    results,
    run_at: new Date().toISOString(),
  };
  writeFileSync(join(__dirname, '../products/seo-results.json'), JSON.stringify(summary, null, 2));
  log(`✅ seo-agent complete. ${pageCount} pages across ${keywords.length} keywords.`);
  return summary;
}

// ─── Generate all page types locally (no Vercel API hop) ─────────────────────
async function generatePagesForKeyword(kw) {
  const keyword = kw.keyword;
  const portfolio = loadPortfolio();
  const matched = portfolio.find(p =>
    p.keywords?.includes(keyword) || p.name?.toLowerCase().includes(keyword.toLowerCase())
  );

  const toolName = matched?.name || `${capitalizeWords(keyword)} Tool`;
  const toolUrl = matched?.vercel_url || `https://agent-os-seven.vercel.app`;
  const competitor = getTopCompetitor(keyword);
  const category = guessCategory(keyword);

  const pageTypes = ['tool_landing', 'tutorial'];
  if ((kw.score || 5) >= 6.5) pageTypes.push('comparison', 'listicle');
  if (/template|example|sample/.test(keyword.toLowerCase())) pageTypes.push('template_page');

  const pages = [];
  for (const pageType of pageTypes) {
    try {
      const result = await generatePageLocally({
        action: pageType,
        keyword,
        toolName,
        toolUrl,
        productSlug: matched?.slug,
        competitor,
        category,
        useCase: keyword,
      });
      if (result?.html) pages.push(result);
      await sleep(1200); // Groq rate limit between page types
    } catch (e) {
      log(`  ⚠️ ${pageType} failed for "${keyword}": ${e.message}`);
    }
  }
  return pages;
}

// ─── All content generation done locally (FIXED: was going through /api/content) 
async function generatePageLocally({ action, keyword, toolName, toolUrl, productSlug, competitor, category, useCase }) {
  switch (action) {
    case 'tool_landing': return generateToolLanding({ keyword, toolName, toolUrl, productSlug });
    case 'tutorial': return generateTutorial({ keyword, toolName, toolUrl });
    case 'comparison': return generateComparison({ keyword, toolName, toolUrl, competitor });
    case 'listicle': return generateListicle({ keyword, toolName, toolUrl, category });
    case 'template_page': return generateTemplatePage({ keyword, toolName, toolUrl, useCase });
    default: throw new Error(`Unknown page type: ${action}`);
  }
}

// ─── 1. Tool Landing ──────────────────────────────────────────────────────────
async function generateToolLanding({ keyword, toolName, toolUrl, productSlug }) {
  const content = await groq(
    `Write a landing page for "${toolName}" targeting keyword "${keyword}".
Include: H1 with keyword, 3 pain points, 3 how-it-works steps, 5 feature bullets, 5 FAQs, CTA section.
Rules: keyword "${keyword}" 4-6 times, 800-1000 words, direct tone, clean HTML divs (no full page), no fluff.`, 2200);

  return buildSEOPage({
    slug: productSlug || keyword.replace(/\s+/g, '-').toLowerCase(),
    title: `${toolName} — ${keyword}`,
    description: `${toolName} helps you ${keyword.toLowerCase()} in seconds. Free to try.`,
    keyword, content, toolUrl, pageType: 'tool_landing',
  });
}

// ─── 2. Tutorial ──────────────────────────────────────────────────────────────
async function generateTutorial({ keyword, toolName, toolUrl }) {
  const content = await groq(
    `Write a tutorial: "How to ${keyword}" (1000 words).
Sections: Why It Matters (100w), The Old Manual Way (150w), Step-by-Step Guide (500w, 5 steps), Common Mistakes (150w), Try ${toolName} free (100w → ${toolUrl}).
Rules: keyword "${keyword}" 5-8 times, use H2/H3 headings, practical tips, no fluff.`, 2500);

  const slug = `how-to-${keyword.replace(/\s+/g, '-').toLowerCase()}`;
  return buildSEOPage({
    slug: `blog/${slug}`,
    title: `How to ${keyword} — Step-by-Step Guide`,
    description: `Learn how to ${keyword.toLowerCase()} with this step-by-step guide. Takes 5 minutes.`,
    keyword, content, toolUrl, pageType: 'tutorial',
  });
}

// ─── 3. Comparison ────────────────────────────────────────────────────────────
async function generateComparison({ keyword, toolName, toolUrl, competitor }) {
  const comp = competitor || `${keyword} tools`;
  const content = await groq(
    `Write a comparison: "${toolName} vs ${comp}" (800 words).
Sections: Overview (100w), Feature comparison table (HTML table) + prose (300w), When to choose ${toolName} (200w), When to choose ${comp} (100w, be honest), Verdict + CTA (100w → ${toolUrl}).
Rules: honest, keyword "${keyword}" 4-6 times, include HTML table with 6 feature rows.`, 2200);

  const slug = `${comp.replace(/\s+/g, '-').toLowerCase()}-alternative`;
  return buildSEOPage({
    slug: `blog/${slug}`,
    title: `${toolName} vs ${comp} — Best ${keyword} Tool 2025`,
    description: `Comparing ${toolName} and ${comp} for ${keyword}. See features, pricing, and which wins.`,
    keyword, content, toolUrl, pageType: 'comparison',
  });
}

// ─── 4. Listicle ──────────────────────────────────────────────────────────────
async function generateListicle({ keyword, toolName, toolUrl, category }) {
  const cat = category || keyword;
  const content = await groq(
    `Write a listicle: "7 Best ${cat} Tools in 2025" (900 words).
Structure: Why you need a ${cat} tool (100w), 7 tools listed (100w each — make ${toolName} #1, use 6 real competitors: HubSpot/Canva/Copy.ai/Jasper/Grammarly/ChatGPT), How to choose (100w), Final CTA ${toolUrl} (50w).
Rules: keyword "${keyword}" 5-7 times, include price for each tool, balanced but ${toolName} wins.`, 2500);

  const slug = `best-${cat.replace(/\s+/g, '-').toLowerCase()}-tools`;
  return buildSEOPage({
    slug: `blog/${slug}`,
    title: `7 Best ${cat} Tools in 2025 (Ranked & Reviewed)`,
    description: `Best ${cat.toLowerCase()} tools compared by price, features, and ease of use.`,
    keyword, content, toolUrl, pageType: 'listicle',
  });
}

// ─── 5. Template Page ─────────────────────────────────────────────────────────
async function generateTemplatePage({ keyword, toolName, toolUrl, useCase }) {
  const uc = useCase || keyword;
  const content = await groq(
    `Write a template gallery page for "${uc}" (700 words).
Sections: Hero (100w), 5 templates (each: ### name, Use when: ..., the actual template text in a code block, 1 customization tip), How to use (100w), CTA to ${toolName} at ${toolUrl} (100w).
Rules: templates must be REAL usable content (not placeholder text), keyword "${keyword}" 4-5 times.`, 2200);

  const slug = `examples/${uc.replace(/\s+/g, '-').toLowerCase()}-template`;
  return buildSEOPage({
    slug,
    title: `${uc} Templates — 5 Free Examples (Copy & Use)`,
    description: `Free ${uc.toLowerCase()} templates ready to copy. Or generate unlimited custom ones with AI.`,
    keyword, content, toolUrl, pageType: 'template',
  });
}

// ─── Niche variant pages ──────────────────────────────────────────────────────
async function generateNichePages(nicheSlugs) {
  for (const item of nicheSlugs) {
    const keyword = item.slug.replace(/-/g, ' ');
    const toolName = `${capitalizeWords(item.niche)} Tool`;
    const toolUrl = `https://agent-os-seven.vercel.app/${item.niche}`;
    try {
      const result = await generateTemplatePage({ keyword, toolName, toolUrl, useCase: keyword });
      if (result?.html && GITHUB_USERNAME) {
        await pushSinglePage(result, item.niche);
      }
      await sleep(1200);
    } catch (_) { }
  }
}

// ─── SEO index files (sitemap + seo-links.json) ───────────────────────────────
async function generateSEOIndex(results, keywords) {
  const successfulKeywords = results.filter(r => r.pages > 0);
  if (!successfulKeywords.length) return;

  const seoBaseUrl = `https://${GITHUB_USERNAME}.github.io/${SEO_REPO}`;

  // seo-links.json — used by product HTML footer
  const seoLinks = successfulKeywords.flatMap(r => {
    const kw = r.keyword;
    return [
      { url: `${seoBaseUrl}/${kw.replace(/\s+/g, '-').toLowerCase()}`, title: `${capitalizeWords(kw)} Tool` },
      { url: `${seoBaseUrl}/blog/how-to-${kw.replace(/\s+/g, '-').toLowerCase()}`, title: `How to ${capitalizeWords(kw)} — Guide` },
    ];
  }).slice(0, 50);

  // sitemap.xml
  const sitemapUrls = seoLinks.map(l =>
    `  <url><loc>${l.url}</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>`
  ).join('\n');
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls}
</urlset>`;

  // Push both to the main agent-os repo /public folder
  if (GITHUB_USERNAME) {
    const mainRepo = process.env.MAIN_REPO || 'agent-os';
    try {
      await callAPI('/api/github', {
        action: 'pushMultipleFiles',
        owner: GITHUB_USERNAME,
        repo: mainRepo,
        files: [
          { path: 'public/seo-links.json', content: JSON.stringify(seoLinks, null, 2), message: `feat: update seo-links.json (${seoLinks.length} links)` },
          { path: 'public/sitemap.xml', content: sitemap, message: `feat: update sitemap.xml (${seoLinks.length} urls)` },
        ],
      });
      log(`  ✓ seo-links.json + sitemap.xml pushed (${seoLinks.length} urls)`);
    } catch (e) {
      log(`  ⚠️ SEO index push failed: ${e.message}`);
    }
  }
}

// ─── GitHub push via /api/github (short call — just sends pre-rendered HTML) ──
async function pushPagesToGitHub(pages, keyword) {
  if (!GITHUB_USERNAME) { log('  ⚠️ GITHUB_USERNAME not set — skipping'); return; }
  const files = pages.map(p => ({
    path: `${p.slug || keyword.replace(/\s+/g, '-')}.html`,
    content: p.html,
    message: `feat: SEO page for "${keyword}"`,
  }));
  try {
    await callAPI('/api/github', { action: 'pushMultipleFiles', owner: GITHUB_USERNAME, repo: SEO_REPO, files });
    log(`  ✓ Pushed ${files.length} pages to github.com/${GITHUB_USERNAME}/${SEO_REPO}`);
  } catch (e) {
    log(`  ⚠️ GitHub push failed: ${e.message}`);
  }
}

async function pushSinglePage(page, subfolder) {
  if (!GITHUB_USERNAME) return;
  try {
    await callAPI('/api/github', {
      action: 'pushFile',
      owner: GITHUB_USERNAME,
      repo: SEO_REPO,
      path: `${subfolder}/${page.slug}.html`,
      content: page.html,
      message: `feat: niche page ${page.slug}`,
    });
  } catch (_) { }
}

// ─── SEO Page HTML builder ────────────────────────────────────────────────────
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
    body{font-family:'Inter',sans-serif;background:#fff;color:#1a1a1a;line-height:1.7;max-width:820px;margin:0 auto;padding:40px 24px}
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
    .cta:hover{background:#4f46e5}
    nav{margin-bottom:32px}
    nav a{color:#6366f1;text-decoration:none;margin-right:16px;font-size:.9rem}
    footer{margin-top:64px;padding-top:24px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:.875rem;text-align:center}
    blockquote{border-left:4px solid #6366f1;padding:12px 20px;background:#f8f9ff;margin:24px 0;border-radius:0 8px 8px 0}
    .cta-box{margin:48px 0;padding:32px;background:#f8f9ff;border-radius:12px;text-align:center}
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
  <div class="cta-box">
    <h3 style="margin-bottom:12px">Try it free — no signup required</h3>
    <a href="${toolUrl}" class="cta">Open ${escHtml(title.split('—')[0].trim())} →</a>
  </div>
  <footer>
    <p>Generated by Agent OS · <a href="${toolUrl}">${toolUrl}</a></p>
    <ul id="seo-links-container" style="list-style:none;margin-top:12px;display:flex;flex-wrap:wrap;gap:8px;justify-content:center"></ul>
    <script>
      fetch('/seo-links.json').then(r=>r.ok?r.json():null).then(links=>{
        if(!links) return;
        const ul=document.getElementById('seo-links-container');
        links.slice(0,20).forEach(l=>{
          const li=document.createElement('li');
          li.innerHTML='<a href="'+l.url+'" style="color:#9ca3af;font-size:.8rem">'+l.title+'</a>';
          ul.appendChild(li);
        });
      }).catch(()=>{});
    </script>
  </footer>
</body>
</html>`;

  return { slug, title, description, keyword, html, pageType, generatedAt: new Date().toISOString() };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function loadQueue() {
  if (!existsSync(QUEUE_FILE)) return null;
  try { return JSON.parse(readFileSync(QUEUE_FILE, 'utf8')); } catch (_) { return null; }
}

function loadPortfolio() {
  const f = join(__dirname, '../public/portfolio.json');
  if (!existsSync(f)) return [];
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch (_) { return []; }
}

async function callAPI(path, body) {
  const r = await fetchWithRetry(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`API ${path} → ${r.status}`);
  return r.json();
}

function getTopCompetitor(keyword) {
  const k = keyword.toLowerCase();
  if (/resume|cv/.test(k)) return 'Resume.io';
  if (/youtube|video/.test(k)) return 'TubeBuddy';
  if (/email/.test(k)) return 'Copy.ai';
  if (/seo|rank/.test(k)) return 'Semrush';
  if (/image|logo/.test(k)) return 'Canva';
  if (/code|script/.test(k)) return 'GitHub Copilot';
  return 'ChatGPT';
}

function guessCategory(keyword) {
  const k = keyword.toLowerCase();
  if (/resume|cv/.test(k)) return 'resume';
  if (/youtube|video/.test(k)) return 'youtube';
  if (/seo|rank/.test(k)) return 'seo';
  if (/email/.test(k)) return 'email';
  if (/marketing|social/.test(k)) return 'marketing';
  if (/image|photo|design/.test(k)) return 'image';
  if (/pdf|doc/.test(k)) return 'pdf';
  if (/code|script/.test(k)) return 'coding';
  return 'other';
}

function capitalizeWords(str) {
  return str.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function escHtml(str = '') {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escJson(str = '') {
  return str.replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    const existing = existsSync(SEO_LOG) ? readFileSync(SEO_LOG, 'utf8') : '';
    writeFileSync(SEO_LOG, existing + line + '\n');
  } catch (_) { }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

run().catch(async (e) => {
  log(`💥 Fatal: ${e.message}`);
  await sendAlert('seo-agent', e.message, { stack: (e.stack || '').slice(0, 500) });
  console.error(e);
  process.exit(1);
});
