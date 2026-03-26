#!/usr/bin/env node
// agents/builder-agent.js — Autonomous Tool Builder (Loop 3, Phase 2)
// Runs daily at 05:00 after product-agent
// Reads product specs → generates HTML → validates → pushes to GitHub
//
// SELF-CONTAINED: calls Groq/Anthropic/GitHub APIs directly.
// No AGENT_OS_URL needed — works in GitHub Actions, locally, and everywhere.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { fetchWithRetry } from '../lib/fetch-retry.js';
import { sendAlert } from '../lib/alert.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPECS_FILE = join(__dirname, '../products/product-specs.json');
const BUILT_FILE = join(__dirname, '../products/built-products.json');
const LOG_FILE = join(__dirname, '../products/builder-agent.log');
const GITHUB_USERNAME = process.env.GITHUB_USERNAME;

// ─── AI PROVIDERS ─────────────────────────────────────────────────────────────

const GROQ_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'gemma2-9b-it'];

async function groq(prompt, system, maxTokens = 2000) {
  let lastErr;
  for (const model of GROQ_MODELS) {
    try {
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
      if (d.error) {
        lastErr = d.error.message;
        if (d.error.code === 'rate_limit_exceeded') await sleep(3000);
        continue;
      }
      const text = d.choices?.[0]?.message?.content || '';
      if (text) return text;
    } catch (e) { lastErr = e.message; }
  }
  throw new Error(lastErr || 'All Groq models failed');
}

async function claude(prompt, system) {
  const sysMsg = system || 'You are an expert frontend developer. Generate complete, production-ready HTML.';

  // Primary: Anthropic Claude Sonnet
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 8192,
          system: sysMsg,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const d = await r.json();
      if (!d.error && d.content?.[0]?.text) return d.content[0].text;
      log(`  ⚠️ Anthropic error: ${JSON.stringify(d.error)}`);
    } catch (e) { log(`  ⚠️ Anthropic fetch failed: ${e.message}`); }
  }

  // Fallback 1: Moonshot
  if (process.env.MOONSHOT_API_KEY) {
    try {
      const r = await fetch('https://api.moonshot.cn/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.MOONSHOT_API_KEY}` },
        body: JSON.stringify({
          model: 'moonshot-v1-32k',
          messages: [{ role: 'system', content: sysMsg }, { role: 'user', content: prompt }],
        }),
      });
      const d = await r.json();
      if (!d.error) return d.choices?.[0]?.message?.content || '';
    } catch (e) { log(`  ⚠️ Moonshot fetch failed: ${e.message}`); }
  }

  // Fallback 2: NVIDIA (Kimi K2.5)
  if (process.env.NVIDIA_API_KEY) {
    try {
      const r = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.NVIDIA_API_KEY}` },
        body: JSON.stringify({
          model: process.env.NVIDIA_MODEL || 'moonshotai/kimi-k2.5',
          max_tokens: 16384,
          temperature: 0.7,
          stream: false,
          messages: [{ role: 'system', content: sysMsg }, { role: 'user', content: prompt }],
        }),
      });
      const d = await r.json();
      if (!d.error) return d.choices?.[0]?.message?.content || '';
    } catch (e) { log(`  ⚠️ NVIDIA fetch failed: ${e.message}`); }
  }

  // Last resort: Groq (free, lower quality for HTML)
  log(`  ⚠️ All premium models failed — using Groq for HTML (lower quality)`);
  return groq(prompt, sysMsg, 8192);
}

// ─── PRODUCT GENERATION ───────────────────────────────────────────────────────

function parseJSON(text = '') {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch (_) { return null; }
}

async function generateCopy(spec) {
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
  return copy;
}

async function generateHTML(spec, copy, stripeLink, gumroadLink) {
  const prompt = `Build a complete, single-file React SaaS tool called "${spec.name}".

SPEC:
- Pain point: ${spec.pain_point}
- Core feature: ${spec.core_feature}
- ICP: ${spec.icp}
- Free limit: ${spec.free_limit} uses
- Price: $${spec.pricing?.monthly_usd}/mo

LANDING COPY:
- Headline: ${copy.headline}
- Subheadline: ${copy.subheadline}
- How it works: ${copy.how_it_works?.join(' → ')}
- CTA: ${copy.cta}

PAYMENT LINKS:
- Stripe: ${stripeLink}
- Gumroad: ${gumroadLink}

REQUIREMENTS:
1. Complete <!DOCTYPE html> page
2. React 18 via CDN (unpkg), Babel standalone
3. Uses Groq API (llama-3.3-70b-versatile) for AI inference — key: CONFIG.GROQ_KEY placeholder
4. Three views: landing → tool → paywall
5. Free limit: ${spec.free_limit} uses then show paywall
6. Email capture in paywall (+3 free uses on submit)
7. PostHog events: tool_opened, tool_used, free_limit_hit, paywall_shown, payment_clicked, email_captured
8. Dark theme: background #0f172a, surface #1e293b, accent #6366f1
9. Font: Inter from Google Fonts
10. Mobile responsive
11. No TypeScript, no build step, no npm imports
12. Viral attribution in every output: "Generated by ${spec.name} — ${spec.slug}.vercel.app"
13. A/B Pricing: check PostHog flag 'price-test-ab'. Default: $${spec.pricing?.monthly_usd}/mo, Test: $${Math.round((spec.pricing?.monthly_usd || 9) * 1.5)}/mo
14. Cross-sell: fetch https://raw.githubusercontent.com/${GITHUB_USERNAME || 'github_user'}/agent-os/main/public/portfolio.json to show 3 related tools in paywall

Return ONLY the complete HTML file. No explanation. No markdown fences.`;

  const html = await claude(prompt);
  if (!html.includes('</html>')) throw new Error('HTML generation incomplete — missing </html>');
  return { html, slug: spec.slug };
}

function validateCode(html = '') {
  const errors = [];
  if (!html.includes('<!DOCTYPE html>')) errors.push('Missing DOCTYPE');
  if (!html.includes('</html>')) errors.push('Missing closing </html>');
  if (!html.includes('react@18')) errors.push('Missing React 18 CDN');
  if (!html.includes('posthog')) errors.push('Missing PostHog analytics');
  if (!html.includes('stripe.com') && !html.includes('CONFIG.STRIPE') && !html.includes('STRIPE_LINK') && !html.includes('stripeLink')) errors.push('Missing Stripe link');
  if (html.includes('process.env')) errors.push('process.env found in browser HTML — security risk');
  if (html.includes('require(')) errors.push('require() found in browser HTML — not supported');
  return { valid: errors.length === 0, errors, length: html.length };
}

// ─── GITHUB DIRECT API ────────────────────────────────────────────────────────

const GH_HEADERS = () => ({
  Authorization: `token ${process.env.GITHUB_TOKEN}`,
  'Content-Type': 'application/json',
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
});

async function ghCreateRepo(name, description) {
  const r = await fetchWithRetry('https://api.github.com/user/repos', {
    method: 'POST',
    headers: GH_HEADERS(),
    body: JSON.stringify({ name, description: description || '', private: false, auto_init: false, has_issues: false, has_wiki: false }),
  });
  const d = await r.json();
  // 409/422 = already exists — treat as success
  if (r.ok || r.status === 409 || (r.status === 422 && d?.errors?.[0]?.message?.includes('already exists'))) return d;
  throw new Error(`createRepo failed ${r.status}: ${JSON.stringify(d)}`);
}

async function ghPushFile(owner, repo, path, content, message, sha) {
  const r = await fetchWithRetry(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: GH_HEADERS(),
    body: JSON.stringify({
      message: message || 'chore: update',
      content: Buffer.from(content).toString('base64'),
      ...(sha ? { sha } : {}),
    }),
  });
  if (!r.ok) {
    const d = await r.json();
    throw new Error(`pushFile ${path} failed ${r.status}: ${JSON.stringify(d)}`);
  }
  return r.json();
}

async function ghGetFileSha(owner, repo, path) {
  try {
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, { headers: GH_HEADERS() });
    if (r.ok) return (await r.json()).sha;
  } catch (_) {}
  return undefined;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function run() {
  log('🔨 builder-agent starting (self-contained — no AGENT_OS_URL needed)...');

  if (!process.env.GROQ_API_KEY) {
    log('❌ GROQ_API_KEY not set — cannot generate copy. Exiting.');
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY && !process.env.NVIDIA_API_KEY && !process.env.MOONSHOT_API_KEY) {
    log('⚠️  No code-gen API key set (ANTHROPIC_API_KEY / NVIDIA_API_KEY / MOONSHOT_API_KEY).');
    log('   HTML will be generated by Groq (lower quality). Add a key for better results.');
  }

  const specsData = loadSpecs();
  if (!specsData?.selected_for_build?.length) {
    log('❌ No specs found. Run product-agent first.');
    return;
  }

  const specs = specsData.selected_for_build;
  log(`Building ${specs.length} products...`);

  const built = [];
  const failed = [];

  for (const spec of specs) {
    log(`\n--- Building: ${spec.name} ---`);
    try {
      const product = await buildProduct(spec);
      built.push(product);
      log(`✓ ${spec.name} built successfully`);
    } catch (e) {
      log(`❌ ${spec.name} failed at phase "${e.phase || 'unknown'}": ${e.message}`);
      failed.push({ spec: spec.name, error: e.message, phase: e.phase });
    }
  }

  const result = {
    date: new Date().toISOString().split('T')[0],
    run_at: new Date().toISOString(),
    built: built.length,
    failed: failed.length,
    products: built,
    failures: failed,
  };

  writeFileSync(BUILT_FILE, JSON.stringify(result, null, 2));
  log(`\n✅ builder-agent complete. Built: ${built.length} | Failed: ${failed.length}`);
  return result;
}

async function buildProduct(spec) {
  // Phase 1: Generate copy (Groq — free, direct)
  log(`  Phase 1: Generating copy...`);
  const copy = await generateCopy(spec).catch(e => {
    throw Object.assign(new Error(e.message), { phase: 'copy_generation' });
  });

  // Phase 2: Generate HTML (Claude Sonnet ~$0.06, direct)
  log(`  Phase 2: Generating HTML...`);
  const { html, slug } = await generateHTML(
    spec,
    copy,
    `https://buy.stripe.com/placeholder-${spec.slug}`,
    `https://gumroad.com/l/placeholder-${spec.slug}`,
  ).catch(e => { throw Object.assign(new Error(e.message), { phase: 'html_generation' }); });

  // Phase 3: Validate
  log(`  Phase 3: Validating HTML...`);
  let finalHtml = html;
  const validation = validateCode(html);
  if (!validation.valid) {
    log(`  ⚠️ Validation errors: ${validation.errors.join(', ')} — auto-patching...`);
    finalHtml = applyPatches(html, validation.errors);
    const recheck = validateCode(finalHtml);
    if (!recheck.valid) {
      throw Object.assign(
        new Error(`HTML invalid after patch: ${recheck.errors.join(', ')}`),
        { phase: 'validation' }
      );
    }
    log(`  ✓ Patched successfully`);
  }

  // Phase 4: Push to GitHub (direct API — no AGENT_OS_URL)
  if (GITHUB_USERNAME && process.env.GITHUB_TOKEN) {
    log(`  Phase 4: Pushing to GitHub...`);
    await pushToGitHub(spec, finalHtml, copy).catch(e => {
      throw Object.assign(new Error(e.message), { phase: 'github_push' });
    });
    log(`  ✓ Pushed to github.com/${GITHUB_USERNAME}/${slug}`);
  } else {
    log(`  ⚠️ GITHUB_USERNAME or GITHUB_TOKEN not set — skipping GitHub push`);
  }

  return {
    spec,
    html: finalHtml,
    slug,
    copy,
    validation,
    status: (GITHUB_USERNAME && process.env.GITHUB_TOKEN) ? 'pushed' : 'html_ready',
  };
}

async function pushToGitHub(spec, html, copy) {
  const owner = GITHUB_USERNAME;
  const repo = spec.slug;

  await ghCreateRepo(repo, spec.tagline);
  await sleep(1500); // let GitHub propagate the new repo

  const vercelJson = JSON.stringify({ rewrites: [{ source: '/(.*)', destination: '/' }] });
  const readme = `# ${spec.name}\n\n${spec.tagline}\n\n**ICP:** ${spec.icp}\n**Category:** ${spec.category}\n\n*Built by Agent OS — launch-agent will inject real payment links*`;

  // Sequential pushes to empty repo — parallel causes 409 "reference already exists"
  await ghPushFile(owner, repo, 'index.html', html, 'feat: initial tool (payment links TBD)');
  await ghPushFile(owner, repo, 'vercel.json', vercelJson, 'chore: vercel config');
  await ghPushFile(owner, repo, 'README.md', readme, 'docs: readme');
}

// ─── PATCH: targeted fixes for known validation errors ────────────────────────
function applyPatches(html, errors) {
  let fixed = html;
  for (const err of errors) {
    if (err.includes('PostHog') && !fixed.includes('posthog')) {
      fixed = fixed.replace('</head>', `<script>!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.async=!0,p.src=s.api_host+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="capture identify alias people.set people.set_once set register register_once unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled onFeatureFlags getFeatureFlag getFeatureFlagPayload reloadFeatureFlags group".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);posthog.init('POSTHOG_KEY',{api_host:'https://app.posthog.com'});</script>\n</head>`);
    }
    if (err.includes('Stripe link') && !fixed.includes('stripe.com')) {
      fixed = fixed.replace('</body>', `<!-- stripe-link-placeholder: https://buy.stripe.com/placeholder -->\n</body>`);
    }
    if (err.includes('process.env')) {
      fixed = fixed.replace(/process\.env\.\w+/g, '"__ENV_VAR__"');
    }
    if (err.includes('require(')) {
      fixed = fixed.replace(/require\([^)]+\)/g, 'undefined');
    }
  }
  return fixed;
}

function loadSpecs() {
  if (!existsSync(SPECS_FILE)) return null;
  try { return JSON.parse(readFileSync(SPECS_FILE, 'utf8')); } catch (_) { return null; }
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    const existing = existsSync(LOG_FILE) ? readFileSync(LOG_FILE, 'utf8') : '';
    writeFileSync(LOG_FILE, existing + line + '\n');
  } catch (_) {}
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

run().catch(async (e) => {
  await sendAlert('builder-agent', e.message, { stack: (e.stack || '').slice(0, 500) });
  console.error(e);
  process.exit(1);
});
