#!/usr/bin/env node
// fix-all-products.js — Full production fix for all 8 products
// 1. Pushes api/groq.js to each product repo (no key in code)
// 2. Sets GROQ_API_KEY env var on each Vercel project
// 3. Updates product vercel.json to route /api/*
// 4. Rebuilds product HTML with real values + uses /api/groq (no key in HTML)
// 5. Pushes updated HTML to GitHub + triggers redeploy

import { readFileSync, writeFileSync } from 'fs';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_USERNAME = process.env.GITHUB_USERNAME || 'Ammumammu';
const VERCEL_TOKEN = process.env.VERCEL_API_KEY;
const VERCEL_TEAM = process.env.VERCEL_TEAM_ID;
const GROQ_KEY = process.env.GROQ_API_KEY;
const POSTHOG_WRITE_KEY = process.env.POSTHOG_WRITE_KEY || 'phc_pg2BYO7sa22tvbyefuV1eFpatr5P2SOt45BrjuQQv9l';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hprhgfhylkykkawszgba.supabase.co';
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || 'sb_publishable_-nQFIe4lTMWbqi6U0mgWwQ_rcvssvD-';

const GROQ_PROXY_URL = 'https://agent-os-seven.vercel.app/api/groq';

const PORTFOLIO = JSON.parse(readFileSync('./public/portfolio.json', 'utf8'));

// Maps slug → GitHub repo name (as they appear in github.com/Ammumammu/)
const SLUG_TO_REPO = {
  'cold-email-writer-tool': 'cold-email-writer-tool',
  'followup-writer-tool': 'followup-writer-tool',
  'email-subject-writer': 'email-subject-writer',
  'cold-email-writer': 'cold-email-writer',
  'subject-craft-pro': 'subject-craft-pro',
  'apology-email-generator': 'apology-email-generator',
  'youtube-thumbnail-ideas': 'youtube-thumbnail-ideas',
  'youtube-title-ideas': 'youtube-title-ideas',
};

// Maps slug → Vercel project ID
const SLUG_TO_VERCEL = {
  'cold-email-writer-tool': 'prj_oVperPv22XjO57cN8lh4ZlPo8PA9',
  'followup-writer-tool': 'prj_K94JzWKaIlopYVVbLW4pYQP2XHZn',
  'email-subject-writer': 'prj_vRzR4A7JVpFQh8KoDJijjjFbYRpw',
  'cold-email-writer': 'prj_1WHk57QgdUgM6Gmf88SMMWDnYa4b',
  'subject-craft-pro': 'prj_nPmgxYckKZEApX6vj7Mw0WB8umqM',
  'apology-email-generator': 'prj_9t5AS529tcw0MQ6323ZNBvGAoK3K',
  'youtube-thumbnail-ideas': 'prj_Kv0aLaG5M8jbdRb4DeaPBxfAwdUV',
  'youtube-title-ideas': 'prj_O0pKN9kBKOmebVFNEx2ZoFM3HFNj',
};

// api/groq.js that goes into each product repo — no key hardcoded
const PRODUCT_GROQ_JS = `// api/groq.js — Groq proxy for this product
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const KEY = process.env.GROQ_API_KEY;
  if (!KEY) return res.status(500).json({ error: 'GROQ_API_KEY not set' });
  try {
    const { messages, model = 'llama-3.3-70b-versatile', max_tokens = 2000, temperature = 0.7, system } = req.body;
    const msgs = system ? [{ role: 'system', content: system }, ...(messages || [])] : (messages || []);
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: \`Bearer \${KEY}\` },
      body: JSON.stringify({ model, messages: msgs, temperature, max_tokens }),
    });
    const data = await r.json();
    return res.status(r.ok ? 200 : r.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
`;

// vercel.json for product repos
const PRODUCT_VERCEL_JSON = JSON.stringify({
  functions: { 'api/groq.js': { maxDuration: 30 } },
  rewrites: [
    { source: '/api/(.*)', destination: '/api/$1' },
    { source: '/(.*)', destination: '/index.html' },
  ],
}, null, 2);

const GH_HEADERS = {
  Authorization: `token ${GITHUB_TOKEN}`,
  'Content-Type': 'application/json',
  Accept: 'application/vnd.github+json',
};

async function ghPush(repo, path, content, message) {
  const url = `https://api.github.com/repos/${GITHUB_USERNAME}/${repo}/contents/${path}`;
  const existing = await fetch(url, { headers: GH_HEADERS }).then(r => r.json());
  const body = {
    message,
    content: Buffer.from(content).toString('base64'),
    ...(existing.sha ? { sha: existing.sha } : {}),
  };
  const r = await fetch(url, { method: 'PUT', headers: GH_HEADERS, body: JSON.stringify(body) });
  const d = await r.json();
  if (!r.ok) throw new Error(`GitHub push failed (${path}): ${d.message}`);
  return d.commit?.sha;
}

async function vercelSetEnv(projectId, key, value) {
  const url = `https://api.vercel.com/v10/projects/${projectId}/env?teamId=${VERCEL_TEAM}`;
  // Try to create; if conflict, update
  let r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value, type: 'encrypted', target: ['production', 'preview'] }),
  });
  let d = await r.json();
  if (d.error?.code === 'ENV_CONFLICT') {
    // Get existing env id and patch
    const listR = await fetch(url, { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } });
    const list = await listR.json();
    const existing = list.envs?.find(e => e.key === key);
    if (existing) {
      const patchR = await fetch(
        `https://api.vercel.com/v10/projects/${projectId}/env/${existing.id}?teamId=${VERCEL_TEAM}`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ value, type: 'encrypted', target: ['production', 'preview'] }),
        }
      );
      d = await patchR.json();
    }
  }
  return d;
}

async function groq(prompt, system = 'You are a helpful AI assistant. Be concise.') {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_KEY}` },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
      temperature: 0.7, max_tokens: 400,
    }),
  });
  const d = await r.json();
  return d.choices?.[0]?.message?.content?.trim() || '';
}

function buildProductHTML(product, stripeLink, features, toolSystemPrompt, inputPlaceholder) {
  const price = product.pricing?.monthly_usd || 9;
  const oneTime = product.pricing?.one_time_usd || 19;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${product.name} — ${product.tagline}</title>
<meta name="description" content="${product.tagline}. Free to start, no account needed. Powered by AI.">
<meta property="og:title" content="${product.name}">
<meta property="og:description" content="${product.tagline}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary">
<script>
  !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]);t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="capture identify alias people.set people.set_once set register register_once unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled onFeatureFlags getFeatureFlag getFeatureFlagPayload reloadFeatureFlags group updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures getActiveMatchingSurveys getSurveys".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
  posthog.init('${POSTHOG_WRITE_KEY}',{api_host:'https://app.posthog.com'});
</script>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --purple: #7c3aed; --purple-light: #a78bfa; --dark: #0f172a;
    --card: #1e293b; --border: #334155; --text: #e2e8f0; --muted: #94a3b8; --green: #10b981;
  }
  body { background: var(--dark); color: var(--text); font-family: 'Segoe UI', system-ui, sans-serif; min-height: 100vh; }
  nav { display: flex; justify-content: space-between; align-items: center; padding: 14px 28px; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: rgba(15,23,42,.96); backdrop-filter: blur(12px); z-index: 100; }
  .logo { font-weight: 700; font-size: 18px; color: var(--purple-light); }
  .hero { max-width: 760px; margin: 64px auto 0; padding: 0 24px; text-align: center; }
  h1 { font-size: clamp(28px, 5vw, 48px); font-weight: 800; line-height: 1.15; margin-bottom: 16px; }
  .sub { font-size: 18px; color: var(--muted); margin-bottom: 36px; line-height: 1.6; }
  .tool-box { max-width: 680px; margin: 0 auto; padding: 0 24px 80px; }
  textarea, input[type=text] { width: 100%; padding: 14px 16px; background: var(--card); border: 1px solid var(--border); border-radius: 10px; color: var(--text); font-size: 15px; font-family: inherit; outline: none; resize: vertical; transition: border-color .2s; }
  textarea:focus, input[type=text]:focus { border-color: var(--purple-light); }
  .btn { width: 100%; padding: 14px; border: none; border-radius: 10px; font-size: 16px; font-weight: 700; cursor: pointer; transition: opacity .15s, transform .1s; margin-top: 12px; }
  .btn:hover { opacity: .9; }
  .btn:active { transform: scale(.98); }
  .btn-primary { background: linear-gradient(135deg, var(--purple), #4f46e5); color: #fff; }
  .btn-secondary { background: var(--card); color: var(--muted); border: 1px solid var(--border); font-size: 14px; padding: 11px; }
  .output-box { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 20px; margin-top: 20px; min-height: 120px; font-size: 15px; line-height: 1.7; white-space: pre-wrap; }
  .features { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; max-width: 760px; margin: 48px auto; padding: 0 24px; }
  .feature { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 20px; }
  .feature-emoji { font-size: 24px; margin-bottom: 8px; }
  .feature-title { font-weight: 600; margin-bottom: 6px; }
  .feature-desc { font-size: 13px; color: var(--muted); line-height: 1.5; }
  .paywall { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.8); z-index: 200; align-items: center; justify-content: center; }
  .paywall.open { display: flex; }
  .paywall-card { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 36px; max-width: 440px; width: 90%; text-align: center; }
  .paywall-card h2 { font-size: 24px; font-weight: 800; margin-bottom: 10px; }
  .paywall-card p { color: var(--muted); margin-bottom: 24px; font-size: 15px; }
  .pay-btn { display: block; background: linear-gradient(135deg, var(--purple), #4f46e5); color: #fff; padding: 14px; border-radius: 10px; font-weight: 700; font-size: 16px; text-decoration: none; margin-bottom: 10px; transition: opacity .15s; }
  .pay-btn:hover { opacity: .9; }
  .pay-secondary { font-size: 13px; color: var(--muted); text-decoration: underline; cursor: pointer; }
  .uses-badge { display: inline-block; background: rgba(124,58,237,.15); color: var(--purple-light); padding: 4px 10px; border-radius: 20px; font-size: 13px; font-weight: 600; margin-bottom: 24px; }
  .loading { display: inline-block; width: 18px; height: 18px; border: 2px solid rgba(255,255,255,.3); border-top-color: #fff; border-radius: 50%; animation: spin .7s linear infinite; vertical-align: middle; margin-right: 8px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .copy-btn { background: none; border: 1px solid var(--border); color: var(--muted); padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; margin-top: 12px; float: right; }
  .copy-btn:hover { border-color: var(--purple-light); color: var(--purple-light); }
  .attr { text-align: center; color: var(--border); font-size: 12px; padding: 24px; }
  .attr a { color: var(--muted); }
</style>
</head>
<body>

<nav>
  <span class="logo">${product.name}</span>
  <a href="#try" style="background:var(--purple);color:#fff;padding:8px 18px;border-radius:8px;font-weight:600;font-size:14px;text-decoration:none;">Try Free →</a>
</nav>

<div class="hero">
  <h1>${product.tagline.charAt(0).toUpperCase() + product.tagline.slice(1)}</h1>
  <p class="sub">Built for ${product.icp}. Free to start — 3 uses, no account needed.</p>
  <div id="uses-badge" class="uses-badge">3 free uses remaining</div>
</div>

<div class="features">
${features.map(f => `  <div class="feature">
    <div class="feature-emoji">${f.emoji}</div>
    <div class="feature-title">${f.title}</div>
    <div class="feature-desc">${f.desc}</div>
  </div>`).join('\n')}
</div>

<div class="tool-box" id="try">
  <textarea id="user-input" rows="5" placeholder="${inputPlaceholder}"></textarea>
  <button class="btn btn-primary" id="generate-btn" onclick="generate()">
    Generate with AI →
  </button>
  <div class="output-box" id="output" style="display:none;">
    <button class="copy-btn" onclick="copyOutput()">Copy</button>
    <span id="output-text"></span>
    <div class="attr">Generated by <a href="https://agent-os-seven.vercel.app" target="_blank">${product.name}</a></div>
  </div>
</div>

<div class="paywall" id="paywall">
  <div class="paywall-card">
    <h2>You've used your 3 free uses 🎉</h2>
    <p>Clearly useful. Get unlimited access.</p>
    <a href="${stripeLink}" class="pay-btn" onclick="track('payment_clicked',{method:'stripe'})">
      Get Unlimited — $${oneTime} one-time →
    </a>
    <div style="margin:12px 0;color:var(--border);font-size:12px;">── or ──</div>
    <div id="email-capture">
      <p style="font-size:13px;margin-bottom:10px;">Get 3 more free uses — enter your email:</p>
      <div style="display:flex;gap:8px;">
        <input type="text" id="email-input" placeholder="you@example.com" style="flex:1;padding:10px;font-size:14px;">
        <button onclick="captureEmail()" style="background:var(--purple);color:#fff;border:none;padding:10px 14px;border-radius:8px;font-weight:600;cursor:pointer;white-space:nowrap;">Get 3 Free</button>
      </div>
    </div>
    <div id="email-success" style="display:none;color:var(--green);font-size:14px;margin-top:10px;">✓ 3 more free uses added!</div>
  </div>
</div>

<script>
const PRODUCT = '${product.name}';
const PRODUCT_SLUG = '${product.slug}';
const SYSTEM_PROMPT = ${JSON.stringify(toolSystemPrompt)};
const SUPABASE_URL = '${SUPABASE_URL}';
const SUPABASE_ANON = '${SUPABASE_ANON}';
const FREE_LIMIT = 3;
let useCount = parseInt(localStorage.getItem('uc_' + PRODUCT_SLUG) || '0');
let extraUses = parseInt(localStorage.getItem('eu_' + PRODUCT_SLUG) || '0');

function track(event, props = {}) {
  if (window.posthog) posthog.capture(event, { product: PRODUCT, ...props });
}

function updateBadge() {
  const remaining = Math.max(0, FREE_LIMIT + extraUses - useCount);
  const badge = document.getElementById('uses-badge');
  if (badge) badge.textContent = remaining + ' free use' + (remaining === 1 ? '' : 's') + ' remaining';
}

async function generate() {
  const input = document.getElementById('user-input').value.trim();
  if (!input) return;

  if (useCount >= FREE_LIMIT + extraUses) {
    track('paywall_shown');
    document.getElementById('paywall').classList.add('open');
    return;
  }

  const btn = document.getElementById('generate-btn');
  btn.innerHTML = '<span class="loading"></span>Generating...';
  btn.disabled = true;

  try {
    const r = await fetch('/api/groq', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: input }],
        max_tokens: 800,
        temperature: 0.8,
      }),
    });
    const data = await r.json();
    const text = data.choices?.[0]?.message?.content || 'Sorry, no output generated. Please try again.';
    document.getElementById('output-text').textContent = text;
    document.getElementById('output').style.display = 'block';

    useCount++;
    localStorage.setItem('uc_' + PRODUCT_SLUG, useCount);
    updateBadge();
    track('tool_used', { use_number: useCount });

    if (useCount >= FREE_LIMIT + extraUses) {
      setTimeout(() => {
        track('free_limit_hit');
        document.getElementById('paywall').classList.add('open');
      }, 1500);
    }
  } catch (e) {
    document.getElementById('output-text').textContent = 'Error: ' + e.message + '. Please try again.';
    document.getElementById('output').style.display = 'block';
  } finally {
    btn.innerHTML = 'Generate Again →';
    btn.disabled = false;
  }
}

function copyOutput() {
  const text = document.getElementById('output-text').textContent;
  navigator.clipboard.writeText(text);
  const btn = document.querySelector('.copy-btn');
  btn.textContent = 'Copied!';
  setTimeout(() => btn.textContent = 'Copy', 1500);
}

async function captureEmail() {
  const email = document.getElementById('email-input').value.trim();
  if (!email.includes('@')) return;
  try {
    const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
    await sb.from('leads').insert({ email, product: PRODUCT_SLUG, context: 'paywall_extra_uses', source: document.referrer || 'direct', created_at: new Date().toISOString() });
  } catch(e) {}
  extraUses += 3;
  localStorage.setItem('eu_' + PRODUCT_SLUG, extraUses);
  track('email_captured', { context: 'paywall_extra_uses' });
  document.getElementById('email-capture').style.display = 'none';
  document.getElementById('email-success').style.display = 'block';
  document.getElementById('paywall').classList.remove('open');
  updateBadge();
}

document.getElementById('paywall').addEventListener('click', function(e) {
  if (e.target === this) this.classList.remove('open');
});

document.getElementById('user-input').addEventListener('keydown', function(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') generate();
});

track('tool_opened');
updateBadge();
</script>
</body>
</html>`;
}

async function processProduct(product) {
  const repo = SLUG_TO_REPO[product.slug];
  const vercelId = SLUG_TO_VERCEL[product.slug];
  if (!repo || !vercelId) {
    console.log(`  ⚠️ Skipping ${product.slug} — no repo/vercel mapping`);
    return;
  }

  console.log(`\n[${product.slug}] Starting...`);

  // 1. Generate AI content with Groq
  console.log(`  Generating features...`);
  const [featuresRaw, toolPrompt, placeholder] = await Promise.all([
    groq(`List 3 features for "${product.name}" (${product.tagline}). Format each as: EMOJI Title: description. One per line. Be specific.`),
    groq(`Write a 15-word system prompt for an AI that ${product.tagline.toLowerCase()}. Just the prompt text.`),
    groq(`Write a 20-word realistic example input for "${product.name}". Just the example text, no quotes.`),
  ]);

  const features = featuresRaw.split('\n').filter(f => f.trim()).slice(0, 3).map(f => {
    const emojiMatch = f.match(/^(\p{Emoji}+)/u);
    const emoji = emojiMatch ? emojiMatch[1] : '✨';
    const rest = f.replace(/^(\p{Emoji}+\s*)/u, '');
    const [title, ...descParts] = rest.split(':');
    return { emoji, title: title?.trim() || rest, desc: descParts.join(':').trim() };
  });

  const stripeLink = product.stripe_link || '';
  if (!stripeLink) console.log(`  ⚠️ No Stripe link for ${product.slug}`);

  // 2. Build HTML
  console.log(`  Building HTML...`);
  const html = buildProductHTML(product, stripeLink, features, toolPrompt || `You are an expert AI that ${product.tagline.toLowerCase()}. Be helpful and specific.`, placeholder || `Describe what you need for ${product.name}...`);

  // 3. Push api/groq.js to GitHub (no key in code)
  console.log(`  Pushing api/groq.js...`);
  try {
    await ghPush(repo, 'api/groq.js', PRODUCT_GROQ_JS, 'feat: add server-side Groq proxy');
    console.log(`  ✓ api/groq.js pushed`);
  } catch (e) {
    console.log(`  ⚠️ api/groq.js push failed: ${e.message}`);
  }

  // 4. Update vercel.json
  console.log(`  Updating vercel.json...`);
  try {
    await ghPush(repo, 'vercel.json', PRODUCT_VERCEL_JSON, 'chore: add api route support');
    console.log(`  ✓ vercel.json updated`);
  } catch (e) {
    console.log(`  ⚠️ vercel.json failed: ${e.message}`);
  }

  // 5. Push HTML
  console.log(`  Pushing index.html...`);
  try {
    await ghPush(repo, 'index.html', html, 'feat: production rebuild — proxy Groq, inject real analytics');
    console.log(`  ✓ index.html pushed`);
  } catch (e) {
    console.log(`  ⚠️ index.html push failed: ${e.message}`);
  }

  // 6. Set GROQ_API_KEY on Vercel project
  console.log(`  Setting Vercel env vars...`);
  try {
    await vercelSetEnv(vercelId, 'GROQ_API_KEY', GROQ_KEY);
    console.log(`  ✓ GROQ_API_KEY set on Vercel`);
  } catch (e) {
    console.log(`  ⚠️ Vercel env failed: ${e.message}`);
  }

  console.log(`  ✅ ${product.slug} done`);
}

async function run() {
  console.log('🔧 Fix-all-products — production rebuild\n');
  console.log(`Products to fix: ${PORTFOLIO.length}`);
  console.log(`Groq proxy: /api/groq (same-origin, no key in HTML)\n`);

  for (const product of PORTFOLIO) {
    await processProduct(product).catch(e => console.log(`  ❌ ${product.slug} failed: ${e.message}`));
    await new Promise(r => setTimeout(r, 500)); // rate limit
  }

  console.log('\n✅ All products processed.');
  console.log('GitHub will auto-deploy each repo to Vercel in ~60 seconds.');
  console.log('\nNext steps:');
  console.log('1. Wait 2 min for Vercel deployments');
  console.log('2. Test a product: open URL, generate output, verify Groq works');
  console.log('3. Switch Stripe to LIVE mode → rebuild with live links');
  console.log('4. Post Reddit copies for traffic');
}

run().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
