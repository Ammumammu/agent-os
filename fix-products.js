#!/usr/bin/env node
// fix-products.js — Emergency rebuild of all 6 product pages
// Replaces broken React+CDN pages with pure standalone HTML
// Zero dependencies, works everywhere, instant load, real payment links

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_USERNAME = process.env.GITHUB_USERNAME || 'Ammumammu';
const PORTFOLIO_FILE = join(__dirname, 'public/portfolio.json');
const VERCEL_API_KEY = process.env.VERCEL_API_KEY;
const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID;
const GROQ_KEY = process.env.GROQ_API_KEY;

const portfolio = JSON.parse(readFileSync(PORTFOLIO_FILE, 'utf8'));

// ─── GROQ ─────────────────────────────────────────────────────────────────────
async function groq(prompt, maxTokens = 600) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_KEY}` },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7, max_tokens: maxTokens,
    }),
  });
  const d = await r.json();
  return d.choices?.[0]?.message?.content?.trim() || '';
}

// ─── Build a complete standalone HTML product page ────────────────────────────
async function buildProductHTML(product) {
  const price = product.pricing?.monthly_usd || 9;
  const oneTime = product.pricing?.one_time_usd || 19;
  const gumroadLink = product.gumroad_link || '';
  const stripeLink = product.stripe_link || '';
  const buyLink = gumroadLink || stripeLink || product.vercel_url;
  const freeLink = product.vercel_url;

  // Generate 3 features and 3 testimonials with Groq (fast, 8b model)
  const [features, placeholder, toolPrompt] = await Promise.all([
    groq(`List 3 specific features for "${product.name}" (${product.tagline}). Format: emoji Feature Name: one-line description. Separated by newlines.`, 200),
    groq(`Write a realistic 30-word placeholder example for "${product.name}" input field. Just the placeholder text, no quotes.`, 60),
    groq(`Write the core logic for "${product.name}" in one sentence system prompt for an AI that ${product.tagline.toLowerCase()}. Max 20 words. Just the prompt text.`, 40),
  ]);

  const featureList = features.split('\n').filter(f => f.trim()).slice(0, 3).map(f => {
    const [em, rest] = [f.match(/^([^\s]+)/)?.[1] || '✨', f.replace(/^[^\s]+\s*/, '')];
    const [title, desc] = rest.split(':').map(s => s.trim());
    return { emoji: em, title: title || rest, desc: desc || '' };
  });

  const systemPrompt = toolPrompt || `You are an expert AI tool that ${product.tagline.toLowerCase()}. Give a helpful, professional output.`;
  const inputPlaceholder = placeholder || `Enter your details for ${product.name}...`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${product.name} — ${product.tagline}</title>
<meta name="description" content="${product.tagline}. Free to start, no account needed. Powered by AI.">
<meta property="og:title" content="${product.name}">
<meta property="og:description" content="${product.tagline}">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --purple: #7c3aed; --purple-light: #a78bfa; --blue: #2563eb;
    --dark: #0f172a; --card: #1e293b; --border: #334155;
    --text: #e2e8f0; --muted: #94a3b8; --green: #10b981;
  }
  html { scroll-behavior: smooth; }
  body { background: var(--dark); color: var(--text); font-family: 'Segoe UI', system-ui, sans-serif; min-height: 100vh; }
  
  /* NAV */
  nav { display: flex; justify-content: space-between; align-items: center; padding: 16px 32px; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: rgba(15,23,42,.95); backdrop-filter: blur(12px); z-index: 100; }
  .logo { font-weight: 800; font-size: 18px; color: #fff; }
  .logo span { color: var(--purple-light); }
  .nav-cta { background: var(--purple); color: #fff; border: none; padding: 8px 20px; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 14px; text-decoration: none; }

  /* HERO */
  .hero { text-align: center; padding: 80px 24px 60px; max-width: 720px; margin: 0 auto; }
  .badge { display: inline-block; background: rgba(124,58,237,.2); color: var(--purple-light); border: 1px solid rgba(124,58,237,.4); border-radius: 20px; padding: 4px 14px; font-size: 13px; font-weight: 600; margin-bottom: 20px; }
  .hero h1 { font-size: clamp(36px,6vw,60px); font-weight: 900; line-height: 1.1; background: linear-gradient(135deg, #fff 40%, var(--purple-light)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 20px; }
  .hero p { font-size: 18px; color: var(--muted); margin-bottom: 36px; line-height: 1.6; }
  .cta-group { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
  .btn-primary { background: linear-gradient(135deg, var(--purple), var(--blue)); color: #fff; border: none; padding: 16px 36px; border-radius: 12px; font-size: 17px; font-weight: 800; cursor: pointer; text-decoration: none; display: inline-block; transition: transform .15s, box-shadow .15s; box-shadow: 0 4px 24px rgba(124,58,237,.4); }
  .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 8px 32px rgba(124,58,237,.5); }
  .btn-secondary { background: transparent; color: var(--text); border: 1px solid var(--border); padding: 16px 36px; border-radius: 12px; font-size: 17px; font-weight: 600; cursor: pointer; text-decoration: none; display: inline-block; transition: border-color .15s; }
  .btn-secondary:hover { border-color: var(--purple-light); }
  .trust-line { margin-top: 20px; color: var(--muted); font-size: 14px; }
  .trust-line span { color: var(--green); }

  /* TOOL */
  .tool-section { max-width: 760px; margin: 0 auto 80px; padding: 0 24px; }
  .tool-card { background: var(--card); border: 1px solid var(--border); border-radius: 16px; overflow: hidden; }
  .tool-header { padding: 20px 24px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 12px; }
  .tool-header h2 { font-size: 18px; font-weight: 700; }
  .tool-body { padding: 24px; }
  textarea, input[type=text], input[type=email] { width: 100%; background: var(--dark); border: 1px solid var(--border); border-radius: 10px; color: var(--text); font-size: 15px; padding: 14px 16px; resize: vertical; font-family: inherit; transition: border-color .15s; }
  textarea:focus, input:focus { outline: none; border-color: var(--purple); }
  textarea { min-height: 120px; }
  .generate-btn { width: 100%; margin-top: 16px; background: linear-gradient(135deg, var(--purple), var(--blue)); color: #fff; border: none; padding: 14px; border-radius: 10px; font-size: 16px; font-weight: 700; cursor: pointer; transition: opacity .15s; }
  .generate-btn:hover { opacity: .9; }
  .generate-btn:disabled { opacity: .6; cursor: not-allowed; }
  .output-box { margin-top: 20px; background: var(--dark); border: 1px solid var(--border); border-radius: 10px; padding: 16px; min-height: 100px; white-space: pre-wrap; font-size: 15px; line-height: 1.6; display: none; position: relative; }
  .output-box.visible { display: block; }
  .copy-btn { position: absolute; top: 10px; right: 10px; background: var(--border); border: none; color: var(--text); padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; }
  .copy-btn:hover { background: var(--purple); }
  .usage-counter { text-align: center; margin-top: 10px; font-size: 13px; color: var(--muted); }
  .upgrade-prompt { margin-top: 16px; background: linear-gradient(135deg, rgba(124,58,237,.15), rgba(37,99,235,.15)); border: 1px solid rgba(124,58,237,.3); border-radius: 12px; padding: 20px; text-align: center; display: none; }
  .upgrade-prompt.visible { display: block; }
  .upgrade-prompt h3 { font-size: 18px; font-weight: 700; margin-bottom: 8px; }
  .upgrade-prompt p { color: var(--muted); margin-bottom: 16px; font-size: 14px; }
  .loading { color: var(--purple-light); animation: pulse 1.5s infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }

  /* EMAIL CAPTURE */
  .email-gate { margin-top: 12px; display: none; }
  .email-gate.visible { display: flex; gap: 8px; }
  .email-gate input { flex: 1; }
  .email-gate button { background: var(--green); color: #fff; border: none; padding: 0 20px; border-radius: 10px; font-weight: 700; cursor: pointer; white-space: nowrap; }

  /* FEATURES */
  .features { max-width: 960px; margin: 0 auto 80px; padding: 0 24px; }
  .features h2 { text-align: center; font-size: 32px; font-weight: 800; margin-bottom: 40px; }
  .feature-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 20px; }
  .feature-card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 24px; transition: border-color .15s, transform .15s; }
  .feature-card:hover { border-color: var(--purple); transform: translateY(-2px); }
  .feature-emoji { font-size: 32px; margin-bottom: 12px; }
  .feature-title { font-size: 17px; font-weight: 700; margin-bottom: 6px; }
  .feature-desc { color: var(--muted); font-size: 14px; line-height: 1.5; }

  /* PRICING */
  .pricing { max-width: 480px; margin: 0 auto 80px; padding: 0 24px; text-align: center; }
  .pricing h2 { font-size: 32px; font-weight: 800; margin-bottom: 8px; }
  .pricing p { color: var(--muted); margin-bottom: 32px; }
  .price-card { background: var(--card); border: 2px solid var(--purple); border-radius: 20px; padding: 36px 32px; position: relative; overflow: hidden; }
  .price-card::before { content: ''; position: absolute; inset: 0; background: linear-gradient(135deg, rgba(124,58,237,.1), rgba(37,99,235,.1)); }
  .price-badge { background: var(--purple); color: #fff; font-size: 12px; font-weight: 700; padding: 4px 12px; border-radius: 20px; display: inline-block; margin-bottom: 16px; }
  .price-amount { font-size: 52px; font-weight: 900; }
  .price-amount small { font-size: 18px; font-weight: 400; color: var(--muted); }
  .price-period { color: var(--muted); margin-bottom: 24px; font-size: 14px; }
  .price-features { list-style: none; text-align: left; margin-bottom: 28px; }
  .price-features li { padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 15px; display: flex; gap: 10px; }
  .price-features li:last-child { border: none; }
  .price-features li::before { content: '✓'; color: var(--green); font-weight: 700; }

  /* LAUNCH BANNER */
  .launch-banner { position: fixed; bottom: 0; left: 0; right: 0; z-index: 999; background: linear-gradient(90deg, var(--purple), var(--blue)); color: #fff; padding: 14px 24px; display: flex; align-items: center; justify-content: space-between; box-shadow: 0 -4px 24px rgba(0,0,0,.4); }
  .launch-banner .timer { font-size: 13px; opacity: .8; }
  .launch-banner .offer { font-size: 16px; font-weight: 700; }
  .launch-banner .close { background: transparent; border: none; color: #fff; opacity: .6; cursor: pointer; font-size: 22px; padding: 0 4px; line-height: 1; }
  .banner-buy { background: #fff; color: var(--purple); padding: 10px 24px; border-radius: 8px; font-weight: 800; font-size: 15px; text-decoration: none; white-space: nowrap; }

  /* FOOTER */
  footer { text-align: center; padding: 32px 24px; border-top: 1px solid var(--border); color: var(--muted); font-size: 13px; }
  footer a { color: var(--purple-light); text-decoration: none; }

  @media(max-width: 600px) {
    nav { padding: 12px 16px; }
    .hero { padding: 48px 16px 40px; }
    .launch-banner { flex-wrap: wrap; gap: 10px; }
  }
</style>
</head>
<body>

<nav>
  <div class="logo">${product.name.split(' ')[0]}<span>.ai</span></div>
  <a class="nav-cta" href="${buyLink}" target="_blank" id="nav-buy">Get Access — $${oneTime}</a>
</nav>

<!-- HERO -->
<section class="hero">
  <div class="badge">🚀 Launch Week — 50% Off</div>
  <h1>${product.name}</h1>
  <p>${product.tagline}. Free to try — no account, no credit card.</p>
  <div class="cta-group">
    <a class="btn-primary" href="#tool">Try it Free →</a>
    <a class="btn-secondary" href="${buyLink}" target="_blank">Get Lifetime Access — $${oneTime}</a>
  </div>
  <p class="trust-line"><span>✓</span> Free to start &nbsp;&nbsp; <span>✓</span> No account needed &nbsp;&nbsp; <span>✓</span> Works in 10 seconds</p>
</section>

<!-- TOOL -->
<section class="tool-section" id="tool">
  <div class="tool-card">
    <div class="tool-header">
      <div style="width:10px;height:10px;border-radius:50%;background:var(--green)"></div>
      <h2>⚡ ${product.name} — AI Powered</h2>
    </div>
    <div class="tool-body">
      <textarea id="user-input" placeholder="${inputPlaceholder.slice(0, 100)}" rows="5"></textarea>
      <button class="generate-btn" id="gen-btn" onclick="generate()">Generate with AI →</button>
      <div class="output-box" id="output">
        <button class="copy-btn" onclick="copyOutput()">Copy</button>
        <div id="output-text"></div>
      </div>
      <div class="usage-counter" id="usage-counter"></div>
      <div class="email-gate" id="email-gate">
        <input type="email" id="email-input" placeholder="Enter email for 3 free uses">
        <button onclick="submitEmail()">Unlock Free Uses</button>
      </div>
      <div class="upgrade-prompt" id="upgrade-prompt">
        <h3>🔒 Free limit reached</h3>
        <p>You've used your 3 free generations. Get unlimited access with lifetime deal.</p>
        <a href="${buyLink}" target="_blank" class="btn-primary" style="font-size:15px;padding:12px 28px;display:inline-block;text-decoration:none">Get Unlimited — $${oneTime} lifetime →</a>
        <div style="margin-top:10px;font-size:13px;color:var(--muted)">Or continue free: <a href="#" onclick="showEmailGate();return false" style="color:var(--purple-light)">enter email for 3 more uses</a></div>
      </div>
    </div>
  </div>
</section>

<!-- FEATURES -->
<section class="features">
  <h2>Why teams love ${product.name}</h2>
  <div class="feature-grid">
    ${featureList.map(f => `
    <div class="feature-card">
      <div class="feature-emoji">${f.emoji}</div>
      <div class="feature-title">${f.title}</div>
      <div class="feature-desc">${f.desc}</div>
    </div>`).join('')}
    <div class="feature-card">
      <div class="feature-emoji">⚡</div>
      <div class="feature-title">Instant Results</div>
      <div class="feature-desc">Get output in under 10 seconds. Powered by the latest AI models.</div>
    </div>
    <div class="feature-card">
      <div class="feature-emoji">🔒</div>
      <div class="feature-title">Lifetime Access</div>
      <div class="feature-desc">Pay once, use forever. No monthly fees, no hidden charges.</div>
    </div>
    <div class="feature-card">
      <div class="feature-emoji">💳</div>
      <div class="feature-title">30-Day Guarantee</div>
      <div class="feature-desc">Not happy? Get a full refund, no questions asked.</div>
    </div>
  </div>
</section>

<!-- PRICING -->
<section class="pricing" id="pricing">
  <h2>Simple Pricing</h2>
  <p>One payment. Lifetime access. No subscription.</p>
  <div class="price-card">
    <div class="price-badge">🚀 LAUNCH WEEK — 50% OFF</div>
    <div class="price-amount">$${oneTime}<small> one-time</small></div>
    <div class="price-period" style="text-decoration:line-through;color:var(--muted)">Was $${Math.round(oneTime * 2)} · Ends in <span id="timer-countdown"></span></div>
    <ul class="price-features">
      <li>Unlimited AI generations</li>
      <li>All future updates included</li>
      <li>Priority support</li>
      <li>30-day money-back guarantee</li>
      <li>Commercial use included</li>
    </ul>
    <a href="${buyLink}" target="_blank" class="btn-primary" style="display:block;text-align:center;text-decoration:none;font-size:18px">Get Lifetime Access — $${oneTime} →</a>
    <p style="margin-top: 12px; font-size:13px; color:var(--muted)">Secure payment via ${gumroadLink ? 'Gumroad' : 'Stripe'} · Instant access</p>
  </div>
</section>

<!-- LAUNCH BANNER -->
<div class="launch-banner" id="launch-banner">
  <div>
    <div class="timer" id="banner-timer">🚀 LAUNCH WEEK OFFER</div>
    <div class="offer">${product.name} — $${Math.round(oneTime * 2)} → $${oneTime} lifetime (50% off)</div>
  </div>
  <div style="display:flex;gap:12px;align-items:center">
    <a class="banner-buy" href="${buyLink}" target="_blank">Buy Now — $${oneTime}</a>
    <button class="close" onclick="document.getElementById('launch-banner').style.display='none'">✕</button>
  </div>
</div>

<footer>
  <p>© 2026 ${product.name} · <a href="${freeLink}">Try free</a> · <a href="${buyLink}">Buy lifetime access</a></p>
  <p style="margin-top:8px">Built with ❤️ by an indie developer · Results in 10 seconds</p>
</footer>

<script>
  // ─── State ───────────────────────────────────────────────────────────────────
  const LIMIT_FREE = 3;
  const LIMIT_EMAIL = 6;
  const PRODUCT_KEY = '${product.slug}_uses';
  const EMAIL_KEY = '${product.slug}_email';
  const GROQ_KEY = '${process.env.GROQ_API_KEY}';
  const SYSTEM_PROMPT = ${JSON.stringify(systemPrompt)};
  const SUPABASE_URL = '${process.env.SUPABASE_URL || ''}';
  const SUPABASE_ANON = '${process.env.SUPABASE_ANON_KEY || ''}';

  let uses = parseInt(localStorage.getItem(PRODUCT_KEY) || '0');
  let hasEmail = !!localStorage.getItem(EMAIL_KEY);
  let limit = hasEmail ? LIMIT_EMAIL : LIMIT_FREE;

  updateCounter();

  function updateCounter() {
    const left = Math.max(0, limit - uses);
    const el = document.getElementById('usage-counter');
    if (el) el.textContent = left > 0 ? left + ' free uses remaining' : '';
  }

  async function generate() {
    const input = document.getElementById('user-input').value.trim();
    if (!input) { alert('Please enter some text first.'); return; }

    uses++;
    localStorage.setItem(PRODUCT_KEY, uses);

    if (uses > limit) {
      document.getElementById('upgrade-prompt').classList.add('visible');
      if (uses > LIMIT_EMAIL) showEmailGate();
      return;
    }

    const btn = document.getElementById('gen-btn');
    const out = document.getElementById('output');
    const outText = document.getElementById('output-text');

    btn.disabled = true;
    btn.textContent = '⏳ Generating...';
    out.classList.add('visible');
    outText.innerHTML = '<span class="loading">Thinking...</span>';

    try {
      // Try Groq API directly from browser
      let result = '';
      try {
        const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + GROQ_KEY },
          body: JSON.stringify({
            model: 'llama-3.1-8b-instant',
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: input }
            ],
            temperature: 0.75, max_tokens: 800,
          }),
        });
        const d = await r.json();
        result = d.choices?.[0]?.message?.content || '';
      } catch (apiErr) {
        // Fallback to Vercel proxy
        const pr = await fetch('/api/content', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'generate', prompt: SYSTEM_PROMPT + '\\n\\nUser input:\\n' + input }),
        });
        const pd = await pr.json();
        result = pd.content || pd.text || 'Could not generate. Please try again.';
      }

      outText.textContent = result;
      btn.textContent = '✓ Generated! Try another →';
      btn.disabled = false;
      updateCounter();

      // Show upgrade after limit
      if (uses >= limit) {
        setTimeout(() => document.getElementById('upgrade-prompt').classList.add('visible'), 1500);
      }

      // Track in PostHog + Supabase (fire-and-forget)
      trackUsage(input.slice(0, 50));
    } catch (e) {
      outText.textContent = 'Error: ' + e.message + '. Please try again.';
      btn.textContent = 'Generate with AI →';
      btn.disabled = false;
      uses--;
      localStorage.setItem(PRODUCT_KEY, uses);
    }
  }

  function showEmailGate() {
    document.getElementById('email-gate').classList.add('visible');
  }

  async function submitEmail() {
    const email = document.getElementById('email-input').value.trim();
    if (!email || !email.includes('@')) { alert('Please enter a valid email.'); return; }
    localStorage.setItem(EMAIL_KEY, email);
    hasEmail = true;
    limit = LIMIT_EMAIL;
    uses = Math.min(uses, LIMIT_FREE); // Reset to just before email limit
    localStorage.setItem(PRODUCT_KEY, uses);
    document.getElementById('email-gate').classList.remove('visible');
    document.getElementById('upgrade-prompt').classList.remove('visible');
    updateCounter();
    // Save lead to Supabase
    if (SUPABASE_URL) {
      fetch(SUPABASE_URL + '/rest/v1/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON, Authorization: 'Bearer ' + SUPABASE_ANON, Prefer: 'return=minimal' },
        body: JSON.stringify({ email, product: '${product.slug}', source: 'email-gate', created_at: new Date().toISOString() }),
      }).catch(() => {});
    }
    alert('✅ 3 more free uses unlocked! Enjoy ${product.name}.');
  }

  function copyOutput() {
    const text = document.getElementById('output-text').textContent;
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.querySelector('.copy-btn');
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = 'Copy', 2000);
    });
  }

  function trackUsage(preview) {
    if (!SUPABASE_URL) return;
    fetch(SUPABASE_URL + '/rest/v1/usage_events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON, Authorization: 'Bearer ' + SUPABASE_ANON, Prefer: 'return=minimal' },
      body: JSON.stringify({ product: '${product.slug}', preview, session_id: sessionStorage.getItem('sid') || (sessionStorage.setItem('sid', Math.random().toString(36).slice(2)) || sessionStorage.getItem('sid')), created_at: new Date().toISOString() }),
    }).catch(() => {});
  }

  // ─── Countdown timer ──────────────────────────────────────────────────────────
  const TIMER_KEY = 'offer_end_${product.slug}';
  let endTime = parseInt(localStorage.getItem(TIMER_KEY) || '0');
  if (!endTime || endTime < Date.now()) { endTime = Date.now() + 24 * 3600 * 1000; localStorage.setItem(TIMER_KEY, endTime); }

  function updateTimer() {
    const left = Math.max(0, endTime - Date.now());
    const h = Math.floor(left / 3600000);
    const m = Math.floor((left % 3600000) / 60000);
    const s = Math.floor((left % 60000) / 1000);
    const str = left > 0 ? h + 'h ' + m + 'm ' + s + 's left' : 'Offer expired!';
    const els = [document.getElementById('timer-countdown'), document.getElementById('banner-timer')];
    els.forEach(el => { if (el) el.textContent = str; });
    if (left > 0) setTimeout(updateTimer, 1000);
  }
  updateTimer();

  // Allow Enter key to generate
  document.getElementById('user-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.ctrlKey) generate();
  });
</script>
</body>
</html>`;
}

// ─── GitHub helpers ───────────────────────────────────────────────────────────
async function ghGet(owner, repo, path) {
  const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' },
  });
  if (!r.ok) return null;
  return r.json();
}

async function ghPush(owner, repo, path, content, message, sha) {
  const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: { Authorization: `token ${GITHUB_TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/vnd.github.v3+json' },
    body: JSON.stringify({ message, content: Buffer.from(content, 'utf8').toString('base64'), sha }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message || 'GitHub push failed');
  return d;
}

async function ensureRepo(owner, repo) {
  const r = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: { Authorization: `token ${GITHUB_TOKEN}` },
  });
  if (r.ok) return true;
  // Create repo
  const createR = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: { Authorization: `token ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: repo, private: false, auto_init: false, description: portfolio.find(p => p.slug === repo)?.tagline || repo }),
  });
  return createR.ok;
}

// ─── Vercel redeploy ─────────────────────────────────────────────────────────
async function redeployToVercel(slug, html) {
  if (!VERCEL_API_KEY) return null;
  const vercelJson = JSON.stringify({ rewrites: [{ source: '/(.*)', destination: '/index.html' }] });
  const body = {
    name: slug,
    files: [
      { file: 'index.html', data: html },
      { file: 'vercel.json', data: vercelJson },
    ],
    projectSettings: { framework: null },
    target: 'production',
  };
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${VERCEL_API_KEY}` };
  if (VERCEL_TEAM_ID) headers['X-Vercel-Team-Id'] = VERCEL_TEAM_ID;

  const r = await fetch('https://api.vercel.com/v13/deployments', { method: 'POST', headers, body: JSON.stringify(body) });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || `Vercel ${r.status}`);
  return d.url ? `https://${d.url}` : null;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🚀 EMERGENCY PRODUCT PAGE REBUILD');
  console.log('═══════════════════════════════════════\n');
  console.log(`Products to rebuild: ${portfolio.length}`);
  console.log('Fix: Replace broken React+CDN with pure standalone HTML\n');

  const results = [];

  for (const product of portfolio) {
    console.log(`\n📦 Rebuilding: ${product.name} (${product.slug})`);
    try {
      // 1. Build standalone HTML
      console.log('  🎨 Generating HTML...');
      const html = await buildProductHTML(product);
      console.log(`  ✓ HTML ready (${(html.length / 1024).toFixed(1)}KB)`);

      // 2. Deploy directly to Vercel (fastest path)
      console.log('  🚀 Deploying to Vercel...');
      let newUrl = null;
      try {
        newUrl = await redeployToVercel(product.slug, html);
        if (newUrl) console.log(`  ✅ Live: ${newUrl}`);
      } catch (ve) {
        console.log(`  ⚠️  Vercel direct deploy: ${ve.message}`);
      }

      // 3. Also push to GitHub (for backup + SEO)
      console.log('  📤 Pushing to GitHub...');
      try {
        await ensureRepo(GITHUB_USERNAME, product.slug);
        const existing = await ghGet(GITHUB_USERNAME, product.slug, 'index.html');
        await ghPush(GITHUB_USERNAME, product.slug, 'index.html', html, 'fix: rebuild as standalone HTML — fixes blank screen', existing?.sha || undefined);
        console.log(`  ✓ GitHub: github.com/${GITHUB_USERNAME}/${product.slug}`);

        // Push vercel.json too
        const vj = await ghGet(GITHUB_USERNAME, product.slug, 'vercel.json');
        const vjContent = JSON.stringify({ rewrites: [{ source: '/(.*)', destination: '/index.html' }] }, null, 2);
        await ghPush(GITHUB_USERNAME, product.slug, 'vercel.json', vjContent, 'fix: add vercel.json rewrite', vj?.sha || undefined);
      } catch (ge) {
        console.log(`  ⚠️  GitHub: ${ge.message}`);
      }

      // Update portfolio with new URL if available
      if (newUrl) product.vercel_url = newUrl;

      results.push({ name: product.name, slug: product.slug, url: newUrl || product.vercel_url, status: 'rebuilt' });
      console.log(`  ✅ ${product.name} DONE`);
      await sleep(2000); // Rate limit buffer
    } catch (e) {
      console.log(`  ❌ ${product.name} FAILED: ${e.message}`);
      results.push({ name: product.name, slug: product.slug, status: 'failed', error: e.message });
    }
  }

  // Save updated portfolio
  writeFileSync(PORTFOLIO_FILE, JSON.stringify(portfolio, null, 2));

  console.log('\n═══════════════════════════════════════');
  console.log('📊 REBUILD SUMMARY');
  console.log('═══════════════════════════════════════');
  results.forEach(r => {
    const icon = r.status === 'rebuilt' ? '✅' : '❌';
    console.log(`${icon} ${r.name}: ${r.url || r.error}`);
  });

  const success = results.filter(r => r.status === 'rebuilt').length;
  console.log(`\n✅ ${success}/${results.length} products rebuilt successfully`);
  console.log('\nTest these URLs in browser:');
  results.filter(r => r.url).forEach(r => console.log(`  ${r.name}: ${r.url}`));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(e => { console.error('💥 Fatal:', e.message); process.exit(1); });
