// api/build.js — Phased Build Pipeline (timeout-safe, idempotent)
//
// The full pipeline is split into 4 phases, each designed to complete within 60s.
// The dashboard chains them: start → build_html → deploy → finalize
// State is persisted in Supabase (builds table) so any phase can resume after failure.
//
// Phase 1 — start:       spec + Stripe + Gumroad product creation  (~15s)
// Phase 2 — build_html:  HTML generation + GitHub push             (~30s)
// Phase 3 — deploy:      Vercel project creation + deploy poll     (~45s)
// Phase 4 — finalize:    SEO pages + marketing content + portfolio (~30s)
//
// Dedup: buildId = "${slug}-${YYYY-MM-DD}". If a non-failed job exists
//        for this slug today, returns the existing job instead of re-running.

import { createJob, getJob, updateJob, checkDuplicate } from './jobs.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, ...p } = req.body || {};

  try {
    switch (action) {
      case 'start':       return res.json(await phaseStart(p));
      case 'build_html':  return res.json(await phaseBuildHtml(p));
      case 'deploy':      return res.json(await phaseDeploy(p));
      case 'finalize':    return res.json(await phaseFinalize(p));
      case 'get_job':     return res.json(await getJob(p.jobId));
      case 'check_budget':return res.json(checkBudget());
      // Legacy single-shot action — delegates to phased pipeline
      case 'build_product': return res.json(await buildProductLegacy(p, res));
      // Groq proxy (merged from groq.js) — products call this instead of Groq directly
      case 'groq_proxy': return res.json(await groqProxy(p));
      default: return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (e) {
    // Update job status to failed if we have a jobId
    if (p.jobId) {
      await updateJob(p.jobId, { status: 'failed', error: e.message }).catch(() => {});
    }
    return res.status(500).json({ error: e.message, phase: e.phase || action });
  }
}

// ─── Phase 1: Spec + Stripe + Gumroad ────────────────────────────────────────
async function phaseStart({ keyword, sourceData, githubUsername }) {
  const api = makeApiCaller();

  // Generate spec first to get the slug for dedup
  const { spec } = await api('/api/product', { action: 'full_spec', keyword, sourceData });
  if (spec.demand_score < 7.0) {
    return { skipped: true, reason: 'demand_score_too_low', score: spec.demand_score, keyword };
  }

  // ── Dedup check: has this slug already been built today? ──────────────────
  const today = new Date().toISOString().slice(0, 10);
  const jobId = `${spec.slug}-${today}`;
  const dupCheck = await checkDuplicate(spec.slug).catch(() => ({ duplicate: false, jobId }));

  if (dupCheck.duplicate) {
    return {
      duplicate: true,
      jobId: dupCheck.jobId,
      status: dupCheck.status,
      message: `${spec.slug} already built today (${dupCheck.status}). Use jobId to check status.`,
      product: dupCheck.product || null,
    };
  }

  // Create job record (idempotent upsert — safe to call twice)
  await createJob(jobId, spec.slug, keyword).catch(() => {});

  // ── Create Stripe product + payment link ──────────────────────────────────
  const stripeResult = await api('/api/stripe', {
    action: 'createFull',
    name: spec.name,
    description: spec.tagline,
    slug: spec.slug,
    monthly_usd: spec.pricing?.monthly_usd || 9,
    successUrl: `https://${spec.slug}.vercel.app/success`,
  }).catch(e => { console.warn(`[build] Stripe error: ${e.message}`); return null; });

  // ── Create Gumroad listing ─────────────────────────────────────────────────
  const gumroadResult = await api('/api/commerce', {
    action: 'createProduct',
    name: spec.name,
    description: spec.tagline,
    price_usd: spec.pricing?.one_time_usd || 19,
    productUrl: `https://${spec.slug}${process.env.VERCEL_SCOPE ? '-' + process.env.VERCEL_SCOPE : ''}.vercel.app`,
  }).catch(() => null);

  const stripeLink = stripeResult?.payment_url || stripeResult?.link?.url || '';
  const gumroadLink = gumroadResult?.product?.short_url || '';

  const phase1Data = { spec, stripeLink, gumroadLink, stripeProductId: stripeResult?.product?.id };
  await updateJob(jobId, { status: 'phase1_done', phase1_data: phase1Data }).catch(() => {});

  return { jobId, status: 'phase1_done', ...phase1Data };
}

// ─── Phase 2: HTML generation + GitHub push ───────────────────────────────────
async function phaseBuildHtml({ jobId, spec, stripeLink, gumroadLink, githubUsername }) {
  // Resume from Supabase if called with just jobId
  if (jobId && !spec) {
    const job = await getJob(jobId);
    if (!job) throw Object.assign(new Error(`Job ${jobId} not found`), { phase: 'build_html' });
    ({ spec, stripeLink, gumroadLink } = job.phase1_data || {});
  }

  const api = makeApiCaller();

  // Generate copy + HTML
  const copyResult = await api('/api/product', { action: 'generate_copy', spec });
  const { html } = await api('/api/product', {
    action: 'generate_html',
    spec,
    copy: copyResult.copy,
    stripeLink: stripeLink || '',
    gumroadLink: gumroadLink || '',
  });

  // Validate before deploying
  const validation = await api('/api/product', { action: 'validate_code', html });
  if (!validation.valid) {
    throw Object.assign(
      new Error(`Invalid HTML: ${(validation.errors || []).join(', ')}`),
      { phase: 'build_html' }
    );
  }

  // Push to GitHub
  const owner = githubUsername || process.env.GITHUB_USERNAME;
  await api('/api/github', { action: 'createRepo', name: spec.slug, description: spec.tagline });
  await sleep(1500);

  const vercelJson = JSON.stringify({ rewrites: [{ source: '/(.*)', destination: '/' }] });
  const readme = `# ${spec.name}\n\n${spec.tagline}\n\n**Try it:** https://${spec.slug}.vercel.app\n**Get Pro:** ${stripeLink}\n\n---\n*Built by Agent OS*`;

  await Promise.all([
    api('/api/github', { action: 'pushFile', owner, repo: spec.slug, path: 'index.html', content: html, message: 'feat: initial launch' }),
    api('/api/github', { action: 'pushFile', owner, repo: spec.slug, path: 'vercel.json', content: vercelJson, message: 'chore: vercel config' }),
    api('/api/github', { action: 'pushFile', owner, repo: spec.slug, path: 'README.md', content: readme, message: 'docs: readme' }),
  ]);

  const phase2Data = { owner, githubUrl: `https://github.com/${owner}/${spec.slug}` };
  if (jobId) await updateJob(jobId, { status: 'phase2_done', phase2_data: phase2Data }).catch(() => {});

  return { jobId, status: 'phase2_done', githubUrl: phase2Data.githubUrl };
}

// ─── Phase 3: Vercel deploy + wait for live URL ───────────────────────────────
async function phaseDeploy({ jobId, githubUsername }) {
  // Load context from Supabase
  const job = jobId ? await getJob(jobId) : null;
  const spec = job?.phase1_data?.spec;
  const owner = githubUsername || job?.phase2_data?.owner || process.env.GITHUB_USERNAME;

  if (!spec) throw Object.assign(new Error('spec not found — run phase 1 first'), { phase: 'deploy' });

  const api = makeApiCaller();

  await api('/api/deploy', { action: 'createProject', name: spec.slug, repo: `${owner}/${spec.slug}` });

  // pollUntilLive waits up to 2 min inside deploy.js — fits within 60s Vercel limit
  // because the poll is on their end; we just await the result
  const { url: liveUrl } = await api('/api/deploy', {
    action: 'pollUntilLive',
    name: spec.slug,
    maxAttempts: 12,   // 12 × 5s = 60s — safe within Vercel function limit
    intervalMs: 5000,
  });

  const phase3Data = { liveUrl: liveUrl || `https://${spec.slug}${process.env.VERCEL_SCOPE ? '-' + process.env.VERCEL_SCOPE : ''}.vercel.app` };
  if (jobId) await updateJob(jobId, { status: 'phase3_done', phase3_data: phase3Data }).catch(() => {});

  return { jobId, status: 'phase3_done', liveUrl: phase3Data.liveUrl };
}

// ─── Phase 4: SEO pages + marketing content + portfolio update ────────────────
async function phaseFinalize({ jobId, githubUsername }) {
  const job = jobId ? await getJob(jobId) : null;
  if (!job) throw Object.assign(new Error(`Job ${jobId} not found`), { phase: 'finalize' });

  const spec = job.phase1_data?.spec;
  const stripeLink = job.phase1_data?.stripeLink || '';
  const gumroadLink = job.phase1_data?.gumroadLink || '';
  const liveUrl = job.phase3_data?.liveUrl || `https://${spec.slug}${process.env.VERCEL_SCOPE ? '-' + process.env.VERCEL_SCOPE : ''}.vercel.app`;
  const owner = githubUsername || job.phase2_data?.owner || process.env.GITHUB_USERNAME;

  const api = makeApiCaller();

  // SEO pages (non-blocking — failure doesn't abort launch)
  const seoPages = await api('/api/content', {
    action: 'niche_batch',
    keyword: spec.keywords?.[0] || spec.slug,
    toolName: spec.name,
    toolUrl: liveUrl,
    productSlug: spec.slug,
    competitor: spec.competitor,
  }).catch(() => null);

  if (seoPages?.pages) {
    const pageFiles = Object.values(seoPages.pages)
      .filter(p => p.html)
      .map(p => ({ path: `${p.slug}.html`, content: p.html, message: `feat: SEO page ${p.slug}` }));

    if (pageFiles.length > 0) {
      const sitemap = buildSitemap(liveUrl, pageFiles);
      pageFiles.push({ path: 'sitemap.xml', content: sitemap, message: 'feat: sitemap' });
      await api('/api/github', { action: 'pushMultipleFiles', owner, repo: spec.slug, files: pageFiles }).catch(() => {});
    }
  }

  // Marketing content (parallel, all on Groq — free)
  const [devtoContent, twitterThread, redditPost, ihPost] = await Promise.allSettled([
    groq(devtoPrompt(spec, liveUrl)),
    groq(twitterPrompt(spec, liveUrl)),
    groq(redditPrompt(spec, liveUrl)),
    groq(ihPrompt(spec, liveUrl)),
  ]);

  // Auto-post to Dev.to + Hashnode
  const articleMd = devtoContent.status === 'fulfilled' ? devtoContent.value : `# ${spec.name}\n\n${spec.tagline}`;
  const [devtoResult, hashnodeResult] = await Promise.allSettled([
    api('/api/devto', { action: 'publishArticle', title: `I built ${spec.name} to ${spec.pain_point}`, body_markdown: articleMd, tags: ['saas', 'tools', 'ai', spec.category || 'productivity'] }),
    api('/api/hashnode', { action: 'publishPost', title: `I built ${spec.name} — ${spec.tagline}`, contentMarkdown: articleMd, tags: ['saas', 'tools', 'ai'] }),
  ]);

  // Build final product entry
  const product = {
    id: Date.now(),
    name: spec.name,
    slug: spec.slug,
    tagline: spec.tagline,
    icp: spec.icp,
    status: 'live',
    github_url: `https://github.com/${owner}/${spec.slug}`,
    vercel_url: liveUrl,
    stripe_link: stripeLink,
    gumroad_link: gumroadLink,
    stripe_product_id: job.phase1_data?.stripeProductId,
    mrr_usd: 0,
    visitors: 0,
    conversion_rate: 0,
    demand_score: spec.demand_score,
    keywords: spec.keywords || [],
    category: spec.category || 'other',
    launched_at: new Date().toISOString(),
    seo_pages: seoPages ? Object.keys(seoPages.pages || {}).length : 0,
    // Semi-auto copy (human pastes into Reddit, IH, Twitter)
    reddit_post: redditPost.status === 'fulfilled' ? redditPost.value : '',
    twitter_thread: twitterThread.status === 'fulfilled' ? twitterThread.value : '',
    ih_post: ihPost.status === 'fulfilled' ? ihPost.value : '',
    // Auto-posted
    devto_url: devtoResult.status === 'fulfilled' ? devtoResult.value?.url : null,
    hashnode_url: hashnodeResult.status === 'fulfilled' ? hashnodeResult.value?.data?.publishPost?.post?.url : null,
  };

  if (jobId) {
    await updateJob(jobId, {
      status: 'live',
      phase3_data: { ...job.phase3_data, product },
    }).catch(() => {});
  }

  console.log(`✅ [build] ${spec.name} LIVE: ${liveUrl}`);
  return { jobId, status: 'live', product };
}

// ─── Legacy single-shot (agents use this path) ───────────────────────────────
// Runs all phases sequentially. Used by agents in GitHub Actions (no timeout).
async function buildProductLegacy({ keyword, sourceData, githubUsername }) {
  const p1 = await phaseStart({ keyword, sourceData, githubUsername });
  if (p1.skipped || p1.duplicate) return p1;

  const { jobId, spec, stripeLink, gumroadLink } = p1;

  await phaseBuildHtml({ jobId, spec, stripeLink, gumroadLink, githubUsername });
  await phaseDeploy({ jobId, githubUsername });
  return phaseFinalize({ jobId, githubUsername });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeApiCaller() {
  return async function apiCall(path, body) {
    const base = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : (process.env.AGENT_OS_URL || 'http://localhost:3000');

    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(`${base}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (r.status === 429 || r.status >= 500) {
          if (attempt < 2) { await sleep(1000 * Math.pow(2, attempt)); continue; }
        }
        if (!r.ok) {
          const text = await r.text().catch(() => '');
          throw new Error(`${path} → ${r.status}: ${text.slice(0, 200)}`);
        }
        return r.json();
      } catch (e) {
        lastErr = e;
        if (attempt < 2) await sleep(1000 * Math.pow(2, attempt));
      }
    }
    throw lastErr;
  };
}

function buildSitemap(domain, pageFiles) {
  const pages = pageFiles
    .filter(p => p.path.endsWith('.html'))
    .map(p => `  <url><loc>${domain}/${p.path.replace('.html', '')}</loc><priority>0.8</priority></url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${domain}/</loc><priority>1.0</priority></url>\n${pages}\n</urlset>`;
}

function checkBudget() {
  return {
    daily_limit_usd: parseFloat(process.env.DAILY_BUDGET_USD || '10'),
    warn_threshold: 7.00,
    hard_stop: 9.50,
    groq_calls_today: 0,
    sonnet_calls_today: 0,
    estimated_cost_usd: 0,
  };
}

async function groq(prompt) {
  const models = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
  let lastErr;
  for (const model of models) {
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.7, max_tokens: 2000 }),
      });
      const d = await r.json();
      if (d.error) { lastErr = d.error.message; if (d.error.code === 'rate_limit_exceeded') await sleep(3000); continue; }
      return d.choices?.[0]?.message?.content || '';
    } catch (e) { lastErr = e.message; }
  }
  return ''; // graceful degradation — content is non-critical in finalize
}

function devtoPrompt(spec, url) {
  return `Write a Dev.to article (800 words) about building ${spec.name}.
Structure:
## The Problem I Kept Running Into (200 words — personal, specific)
## What I Tried First (100 words — tools that didn't work)
## How I Built the Solution (300 words — technical approach)
## What I Learned (100 words — specific insights)
## Try It (100 words — CTA to ${url})
Tone: senior developer sharing learnings. Humble, specific, no marketing fluff.`;
}

function twitterPrompt(spec, url) {
  return `Write a 7-tweet thread launching ${spec.name}.
Tweet 1 (hook): Bold claim about ${spec.pain_point}
Tweets 2-6: problem, attempt, solution, demo, lesson
Tweet 7 (CTA): Try free → ${url}
Format: numbered tweets ≤280 chars each.`;
}

function redditPrompt(spec, url) {
  return `Write authentic Reddit post for r/${spec.target_subreddit || 'SideProject'}.
Open with personal story, no product mention until paragraph 3. Max 300 words.
End: "Built ${spec.name} to fix this. ${url}"`;
}

function ihPrompt(spec, url) {
  return `Write IndieHackers post: "I built ${spec.name} to solve my own ${(spec.pain_point || '').split(' ').slice(0, 4).join(' ')} problem"
Background, problem, what I built, early results, link: ${url}. Max 250 words.`;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Groq proxy (merged from groq.js) ─────────────────────────────────────
async function groqProxy({ messages, model = 'llama-3.3-70b-versatile', max_tokens = 2000, temperature = 0.7, system }) {
  const KEY = process.env.GROQ_API_KEY;
  if (!KEY) throw new Error('GROQ_API_KEY not configured');
  const msgs = system ? [{ role: 'system', content: system }, ...(messages || [])] : (messages || []);
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model, messages: msgs, temperature, max_tokens }),
  });
  return r.json();
}
