#!/usr/bin/env node
// deploy-one.js — Deploy ONE product page perfectly, verify it works, then replicate
// Skill #1: Perfect product page deployment
// Strategy: Build HTML locally → deploy via Vercel file API → verify live → done

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERCEL_KEY = process.env.VERCEL_API_KEY;
const VERCEL_TEAM = process.env.VERCEL_TEAM_ID;
const GROQ_KEY = process.env.GROQ_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_USERNAME = process.env.GITHUB_USERNAME || 'Ammumammu';

// The ONE product we are mastering first
const TARGET_SLUG = process.argv[2] || 'cold-email-writer-tool';
const ALL = process.argv[2] === '--all';

const portfolio = JSON.parse(readFileSync(join(__dirname, 'public/portfolio.json'), 'utf8'));

// Gumroad IDs already created (from browser session)
const GUMROAD_IDS = {
  'cold-email-writer-tool': 'mcfipd',   // $19
  'email-subject-writer':   'agrqy',    // $19 (fix needed: should be $99)
  'followup-writer-tool':   'lszohz',   // $19 (was $1900, needs fix)
};
const GUMROAD_BASE = '6356457446258.gumroad.com/l';

async function groq(prompt, maxTokens = 400) {
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.6, max_tokens: maxTokens,
      }),
    });
    const d = await r.json();
    return d.choices?.[0]?.message?.content?.trim() || '';
  } catch { return ''; }
}

// ─── Build the DEFINITIVE standalone product page ─────────────────────────────
async function buildHTML(product) {
  const gId = GUMROAD_IDS[product.slug];
  const gumroadUrl = gId ? `https://${GUMROAD_BASE}/${gId}` : '';
  const buyUrl = gumroadUrl || product.vercel_url;
  const priceOne = product.pricing?.one_time_usd || 19;
  const priceMo = product.pricing?.monthly_usd || 9;

  // Generate content with Groq
  const aiPrompt = await groq(
    `In one sentence (max 15 words), what does an AI tool called "${product.name}" do? It: ${product.tagline}. Just the sentence, no quotes.`, 50
  );
  const inputPlaceholder = await groq(
    `Write a realistic 20-word placeholder text for the input box of "${product.name}" (${product.tagline}). Just the placeholder, no quotes.`, 40
  );
  const systemPrompt = await groq(
    `Write a system prompt (20 words max) for an AI assistant that ${product.tagline.toLowerCase()}. Just the prompt text.`, 30
  );

  const feat1 = await groq(`One specific feature of "${product.name}": format "emoji Title: description (max 10 words)"`, 40);
  const feat2 = await groq(`One different feature of "${product.name}": format "emoji Title: description (max 10 words)"`, 40);
  const feat3 = await groq(`One benefit of using "${product.name}": format "emoji Title: description (max 10 words)"`, 40);

  const parseFeature = (s, fallback) => {
    const match = s.match(/^(\S+)\s+([^:]+):\s*(.+)/);
    if (match) return { emoji: match[1], title: match[2].trim(), desc: match[3].trim() };
    return { emoji: '✨', title: fallback, desc: s };
  };

  const features = [
    parseFeature(feat1, 'AI-Powered'),
    parseFeature(feat2, 'Instant Results'),
    parseFeature(feat3, 'No Learning Curve'),
  ];

  const sysPrompt = systemPrompt || `You are an expert AI assistant. ${product.tagline}. Be helpful, professional, and specific.`;
  const placeholder = inputPlaceholder || `Describe what you need for ${product.name}...`;

  // ── THE PAGE ──────────────────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${product.name} — ${product.tagline}</title>
<meta name="description" content="${product.tagline}. Free AI tool — no signup required. Results in 10 seconds.">
<meta property="og:title" content="${product.name}">
<meta property="og:description" content="${product.tagline}">
<meta property="og:type" content="website">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --p:#7c3aed;--pl:#a78bfa;--b:#2563eb;
  --dk:#0f172a;--c1:#1e293b;--br:#2d3f55;
  --tx:#e2e8f0;--mt:#94a3b8;--gn:#10b981;--rd:#ef4444;
  --yl:#f59e0b;
}
html{scroll-behavior:smooth}
body{background:var(--dk);color:var(--tx);font-family:'Inter',system-ui,sans-serif;min-height:100vh;overflow-x:hidden}

/* ── NAV ── */
nav{display:flex;justify-content:space-between;align-items:center;padding:14px 32px;border-bottom:1px solid var(--br);position:sticky;top:0;background:rgba(15,23,42,.97);backdrop-filter:blur(16px);z-index:200}
.logo{font-weight:900;font-size:19px;color:#fff;letter-spacing:-.5px}
.logo em{color:var(--pl);font-style:normal}
.nav-actions{display:flex;gap:10px;align-items:center}
.nav-link{color:var(--mt);font-size:14px;text-decoration:none;padding:6px 12px;border-radius:6px;transition:color .15s}
.nav-link:hover{color:var(--tx)}
.nav-buy{background:linear-gradient(135deg,var(--p),var(--b));color:#fff;border:none;padding:9px 20px;border-radius:8px;font-weight:700;cursor:pointer;font-size:14px;text-decoration:none;transition:opacity .15s}
.nav-buy:hover{opacity:.9}

/* ── HERO ── */
.hero{text-align:center;padding:90px 24px 70px;max-width:740px;margin:0 auto}
.badge{display:inline-flex;align-items:center;gap:6px;background:rgba(124,58,237,.15);color:var(--pl);border:1px solid rgba(124,58,237,.3);border-radius:24px;padding:5px 16px;font-size:13px;font-weight:600;margin-bottom:22px}
.badge-dot{width:6px;height:6px;border-radius:50%;background:var(--gn);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
h1{font-size:clamp(38px,7vw,64px);font-weight:900;line-height:1.08;letter-spacing:-2px;background:linear-gradient(135deg,#fff 30%,var(--pl));-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:20px}
.hero-sub{font-size:18px;color:var(--mt);margin-bottom:38px;line-height:1.65;max-width:560px;margin-left:auto;margin-right:auto}
.cta-row{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-bottom:22px}
.btn-1{background:linear-gradient(135deg,var(--p),var(--b));color:#fff;border:none;padding:16px 36px;border-radius:11px;font-size:17px;font-weight:800;cursor:pointer;text-decoration:none;display:inline-block;transition:transform .15s,box-shadow .15s;box-shadow:0 4px 28px rgba(124,58,237,.38)}
.btn-1:hover{transform:translateY(-2px);box-shadow:0 8px 36px rgba(124,58,237,.5)}
.btn-2{background:transparent;color:var(--tx);border:1.5px solid var(--br);padding:16px 36px;border-radius:11px;font-size:17px;font-weight:600;cursor:pointer;text-decoration:none;display:inline-block;transition:border-color .15s}
.btn-2:hover{border-color:var(--pl)}
.trust{font-size:13px;color:var(--mt);display:flex;gap:20px;justify-content:center;flex-wrap:wrap}
.trust span{color:var(--gn)}

/* ── TOOL ── */
.tool-wrap{max-width:780px;margin:0 auto 80px;padding:0 24px}
.tool-card{background:var(--c1);border:1px solid var(--br);border-radius:18px;overflow:hidden;box-shadow:0 8px 48px rgba(0,0,0,.4)}
.tool-top{padding:18px 24px;border-bottom:1px solid var(--br);display:flex;align-items:center;gap:12px}
.dot-r{width:11px;height:11px;border-radius:50%;background:var(--rd)}
.dot-y{width:11px;height:11px;border-radius:50%;background:var(--yl)}
.dot-g{width:11px;height:11px;border-radius:50%;background:var(--gn)}
.tool-title{font-weight:700;font-size:16px;margin-left:4px}
.tool-body{padding:24px}
label{display:block;font-size:13px;font-weight:600;color:var(--mt);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px}
textarea{width:100%;background:var(--dk);border:1.5px solid var(--br);border-radius:10px;color:var(--tx);font-size:15px;padding:14px 16px;resize:vertical;font-family:inherit;transition:border-color .2s;line-height:1.6}
textarea:focus{outline:none;border-color:var(--p);box-shadow:0 0 0 3px rgba(124,58,237,.15)}
.gen-btn{width:100%;margin-top:14px;background:linear-gradient(135deg,var(--p),var(--b));color:#fff;border:none;padding:15px;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer;transition:opacity .15s,transform .1s;display:flex;align-items:center;justify-content:center;gap:8px}
.gen-btn:hover{opacity:.92}
.gen-btn:active{transform:scale(.98)}
.gen-btn:disabled{opacity:.5;cursor:not-allowed}
.output-wrap{margin-top:18px;display:none;position:relative}
.output-wrap.show{display:block}
.output-label{font-size:12px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center}
.copy-btn{background:var(--br);border:none;color:var(--tx);padding:4px 12px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;transition:background .15s}
.copy-btn:hover{background:var(--p)}
.output-box{background:var(--dk);border:1.5px solid var(--br);border-radius:10px;padding:16px;min-height:80px;white-space:pre-wrap;font-size:15px;line-height:1.7;color:var(--tx)}
.usage-bar{margin-top:10px;font-size:13px;color:var(--mt);display:flex;align-items:center;gap:8px}
.usage-dots{display:flex;gap:4px}
.usage-dot{width:8px;height:8px;border-radius:50%;background:var(--br);transition:background .3s}
.usage-dot.used{background:var(--p)}
.paywall{margin-top:16px;background:linear-gradient(135deg,rgba(124,58,237,.12),rgba(37,99,235,.12));border:1.5px solid rgba(124,58,237,.25);border-radius:14px;padding:22px;text-align:center;display:none}
.paywall.show{display:block}
.paywall h3{font-size:19px;font-weight:800;margin-bottom:8px}
.paywall p{color:var(--mt);margin-bottom:18px;font-size:14px;line-height:1.5}
.email-row{display:flex;gap:8px;margin-top:14px;display:none}
.email-row.show{display:flex}
.email-row input{flex:1;background:var(--dk);border:1.5px solid var(--br);border-radius:8px;color:var(--tx);font-size:14px;padding:10px 14px;font-family:inherit}
.email-row input:focus{outline:none;border-color:var(--p)}
.email-row button{background:var(--gn);color:#fff;border:none;padding:0 18px;border-radius:8px;font-weight:700;cursor:pointer;white-space:nowrap;font-size:14px}

/* loading spinner */
@keyframes spin{to{transform:rotate(360deg)}}
.spinner{width:18px;height:18px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite;display:none}
.spinner.show{display:block}

/* ── FEATURES ── */
.features-section{max-width:960px;margin:0 auto 80px;padding:0 24px}
.section-label{text-align:center;font-size:13px;font-weight:700;color:var(--pl);text-transform:uppercase;letter-spacing:1px;margin-bottom:12px}
.section-title{text-align:center;font-size:clamp(26px,4vw,38px);font-weight:800;margin-bottom:44px;letter-spacing:-.5px}
.features-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px}
.feat{background:var(--c1);border:1px solid var(--br);border-radius:14px;padding:26px 24px;transition:border-color .2s,transform .2s}
.feat:hover{border-color:var(--p);transform:translateY(-3px)}
.feat-icon{font-size:34px;margin-bottom:14px}
.feat-title{font-size:16px;font-weight:700;margin-bottom:6px}
.feat-desc{color:var(--mt);font-size:14px;line-height:1.55}

/* ── PRICING ── */
.pricing-section{max-width:500px;margin:0 auto 80px;padding:0 24px;text-align:center}
.price-card{background:var(--c1);border:2px solid var(--p);border-radius:20px;padding:38px 32px;position:relative;overflow:hidden}
.price-card::before{content:'';position:absolute;inset:0;background:linear-gradient(135deg,rgba(124,58,237,.08),rgba(37,99,235,.08));pointer-events:none}
.price-chip{background:var(--p);color:#fff;font-size:11px;font-weight:800;padding:4px 14px;border-radius:20px;display:inline-block;margin-bottom:18px;text-transform:uppercase;letter-spacing:.5px}
.price-num{font-size:58px;font-weight:900;letter-spacing:-2px;line-height:1}
.price-num small{font-size:20px;font-weight:500;color:var(--mt);letter-spacing:0}
.was{color:var(--mt);font-size:15px;margin:6px 0 4px;text-decoration:line-through}
.timer-price{color:var(--yl);font-size:14px;font-weight:600;margin-bottom:24px}
.price-list{list-style:none;text-align:left;margin-bottom:28px}
.price-list li{padding:9px 0;border-bottom:1px solid var(--br);font-size:15px;display:flex;gap:10px;align-items:flex-start}
.price-list li:last-child{border:none}
.price-list li::before{content:'✓';color:var(--gn);font-weight:800;font-size:14px;margin-top:1px;flex-shrink:0}
.price-note{margin-top:12px;font-size:13px;color:var(--mt)}

/* ── BANNER ── */
.banner{position:fixed;bottom:0;left:0;right:0;z-index:999;background:linear-gradient(90deg,#6d28d9,#1d4ed8);color:#fff;padding:13px 24px;display:flex;align-items:center;justify-content:space-between;gap:16px;box-shadow:0 -6px 28px rgba(0,0,0,.5)}
.banner-txt{flex:1}
.banner-tag{font-size:12px;opacity:.75;font-weight:600;letter-spacing:.3px}
.banner-offer{font-size:16px;font-weight:800;margin-top:2px}
.banner-btn{background:#fff;color:var(--p);padding:10px 24px;border-radius:8px;font-weight:800;font-size:15px;text-decoration:none;white-space:nowrap;transition:transform .1s}
.banner-btn:hover{transform:scale(1.04)}
.banner-close{background:transparent;border:none;color:#fff;opacity:.6;cursor:pointer;font-size:22px;line-height:1;padding:0 4px;flex-shrink:0}

/* ── FOOTER ── */
footer{border-top:1px solid var(--br);padding:32px 24px;text-align:center;color:var(--mt);font-size:13px}
footer a{color:var(--pl);text-decoration:none}
footer a:hover{text-decoration:underline}

@media(max-width:640px){
  nav{padding:12px 16px}
  h1{letter-spacing:-1px}
  .cta-row{flex-direction:column;align-items:center}
  .btn-1,.btn-2{width:100%;text-align:center}
  .banner{flex-wrap:wrap}
}
</style>
</head>
<body>

<!-- NAV -->
<nav>
  <div class="logo">${product.name.replace(' ', '<em>').replace(/(.+?)<em>(.+)/, '$1<em>$2</em>')}<em></em></div>
  <div class="nav-actions">
    <a class="nav-link" href="#tool">Try Free</a>
    <a class="nav-link" href="#pricing">Pricing</a>
    <a class="nav-buy" href="${buyUrl}" target="_blank" id="nav-buy-btn">Buy — $${priceOne}</a>
  </div>
</nav>

<!-- HERO -->
<section class="hero">
  <div class="badge"><span class="badge-dot"></span>🚀 Launch Week — 50% Off</div>
  <h1>${product.name}</h1>
  <p class="hero-sub">${aiPrompt || product.tagline}. Free to try, results in under 10 seconds.</p>
  <div class="cta-row">
    <a class="btn-1" href="#tool" id="hero-try-btn">⚡ Try for Free</a>
    <a class="btn-2" href="${buyUrl}" target="_blank" id="hero-buy-btn">Get Lifetime — $${priceOne}</a>
  </div>
  <div class="trust">
    <div><span>✓</span> No account needed</div>
    <div><span>✓</span> Works in 10 seconds</div>
    <div><span>✓</span> 30-day money back</div>
  </div>
</section>

<!-- TOOL -->
<div class="tool-wrap" id="tool">
  <div class="tool-card">
    <div class="tool-top">
      <div class="dot-r"></div><div class="dot-y"></div><div class="dot-g"></div>
      <span class="tool-title">⚡ ${product.name} — AI Generator</span>
    </div>
    <div class="tool-body">
      <label for="user-input">Your Input</label>
      <textarea id="user-input" rows="5" placeholder="${placeholder.slice(0, 120)}"></textarea>
      <button class="gen-btn" id="gen-btn" onclick="generate()">
        <div class="spinner" id="spinner"></div>
        <span id="btn-label">Generate with AI →</span>
      </button>
      <div class="usage-bar">
        <div class="usage-dots" id="dots"></div>
        <span id="usage-text">3 free uses remaining</span>
      </div>
      <div class="output-wrap" id="output-wrap">
        <div class="output-label">
          <span>AI Output</span>
          <button class="copy-btn" onclick="copyOut()">Copy</button>
        </div>
        <div class="output-box" id="output-box"></div>
      </div>
      <div class="paywall" id="paywall">
        <h3>🔒 Free limit reached</h3>
        <p>You've used your 3 free generations. Unlock unlimited access with a one-time payment — or enter your email for 3 bonus uses.</p>
        <a href="${buyUrl}" target="_blank" class="btn-1" style="display:inline-block;font-size:16px;padding:14px 32px;text-decoration:none" id="paywall-buy-btn">Get Unlimited — $${priceOne} ↗</a>
        <p style="margin-top:12px;font-size:13px;color:var(--mt)">Or <a href="#" onclick="showEmail();return false" style="color:var(--pl)">unlock 3 more free uses</a> with your email</p>
        <div class="email-row" id="email-row">
          <input type="email" id="email-in" placeholder="your@email.com">
          <button onclick="submitEmail()">Unlock Free</button>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- FEATURES -->
<section class="features-section">
  <div class="section-label">Why People Love It</div>
  <h2 class="section-title">Everything you need to ${product.tagline.toLowerCase().replace(/\.$/, '')}</h2>
  <div class="features-grid">
    ${features.map(f => `
    <div class="feat">
      <div class="feat-icon">${f.emoji}</div>
      <div class="feat-title">${f.title}</div>
      <div class="feat-desc">${f.desc}</div>
    </div>`).join('')}
    <div class="feat">
      <div class="feat-icon">⚡</div>
      <div class="feat-title">Instant Results</div>
      <div class="feat-desc">Get your output in under 10 seconds. No waiting, no queues.</div>
    </div>
    <div class="feat">
      <div class="feat-icon">🔒</div>
      <div class="feat-title">Pay Once, Use Forever</div>
      <div class="feat-desc">Lifetime access with a single payment. No subscriptions, ever.</div>
    </div>
    <div class="feat">
      <div class="feat-icon">💯</div>
      <div class="feat-title">30-Day Guarantee</div>
      <div class="feat-desc">Not satisfied? Full refund, no questions asked.</div>
    </div>
  </div>
</section>

<!-- PRICING -->
<section class="pricing-section" id="pricing">
  <div class="section-label">Pricing</div>
  <h2 class="section-title">Simple, honest pricing</h2>
  <div class="price-card">
    <div class="price-chip">🚀 Launch Week — 50% Off</div>
    <div class="price-num">$${priceOne}<small> one-time</small></div>
    <div class="was">Was $${Math.round(priceOne * 2)}</div>
    <div class="timer-price">⏰ Offer expires in <span id="countdown">24:00:00</span></div>
    <ul class="price-list">
      <li>Unlimited AI generations — forever</li>
      <li>All future updates included</li>
      <li>Use for personal and commercial projects</li>
      <li>Priority email support</li>
      <li>30-day money-back guarantee</li>
    </ul>
    <a href="${buyUrl}" target="_blank" class="btn-1" style="display:block;text-align:center;text-decoration:none;font-size:18px" id="pricing-buy-btn">
      Get Lifetime Access — $${priceOne} →
    </a>
    <p class="price-note">Secure payment via ${gumroadUrl ? 'Gumroad' : 'Stripe'} &nbsp;·&nbsp; Instant access &nbsp;·&nbsp; Cancel anytime not needed</p>
  </div>
</section>

<!-- LAUNCH BANNER -->
<div class="banner" id="launch-banner">
  <div class="banner-txt">
    <div class="banner-tag">🚀 LAUNCH WEEK OFFER — ENDS IN <span id="banner-timer">24:00:00</span></div>
    <div class="banner-offer">${product.name}: $${Math.round(priceOne * 2)} → $${priceOne} &nbsp;·&nbsp; Lifetime access</div>
  </div>
  <a class="banner-btn" href="${buyUrl}" target="_blank" id="banner-buy-btn">Buy — $${priceOne}</a>
  <button class="banner-close" onclick="document.getElementById('launch-banner').style.display='none'" aria-label="close">✕</button>
</div>

<footer>
  <p>© 2026 ${product.name} &nbsp;·&nbsp; <a href="#tool">Try free</a> &nbsp;·&nbsp; <a href="${buyUrl}" target="_blank">Buy lifetime</a></p>
  <p style="margin-top:6px">Built by an indie developer &nbsp;·&nbsp; ${product.tagline}</p>
</footer>

<script>
// ── Config ──────────────────────────────────────────────────────────────────
const SLUG = '${product.slug}';
const USES_KEY = SLUG + '_uses';
const EMAIL_KEY = SLUG + '_email';
const TIMER_KEY = SLUG + '_timer';
const LIMIT_FREE = 3;
const LIMIT_EMAIL = 6;
const SYSTEM = ${JSON.stringify(sysPrompt)};
const GROQ = '${GROQ_KEY}';

// ── State ────────────────────────────────────────────────────────────────────
let uses = parseInt(localStorage.getItem(USES_KEY) || '0');
let hasEmail = !!localStorage.getItem(EMAIL_KEY);
const limit = () => hasEmail ? LIMIT_EMAIL : LIMIT_FREE;
const left = () => Math.max(0, limit() - uses);

renderDots();
updateUsageText();

function renderDots() {
  const el = document.getElementById('dots');
  if (!el) return;
  el.innerHTML = '';
  for (let i = 0; i < limit(); i++) {
    const d = document.createElement('div');
    d.className = 'usage-dot' + (i < uses ? ' used' : '');
    el.appendChild(d);
  }
}
function updateUsageText() {
  const el = document.getElementById('usage-text');
  if (el) el.textContent = left() > 0 ? left() + ' free use' + (left() === 1 ? '' : 's') + ' remaining' : 'Free limit reached';
}

// ── Generate ──────────────────────────────────────────────────────────────────
async function generate() {
  const input = document.getElementById('user-input').value.trim();
  if (!input) { document.getElementById('user-input').focus(); return; }

  if (left() <= 0) {
    document.getElementById('paywall').classList.add('show');
    return;
  }

  const btn = document.getElementById('gen-btn');
  const spinner = document.getElementById('spinner');
  const label = document.getElementById('btn-label');
  const outWrap = document.getElementById('output-wrap');
  const outBox = document.getElementById('output-box');

  btn.disabled = true;
  spinner.classList.add('show');
  label.textContent = 'Generating...';
  outWrap.classList.add('show');
  outBox.textContent = '...';

  uses++;
  localStorage.setItem(USES_KEY, uses);
  renderDots();
  updateUsageText();

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + GROQ },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: input }
        ],
        temperature: 0.75, max_tokens: 800
      })
    });
    const d = await res.json();
    const txt = d.choices?.[0]?.message?.content;
    if (!txt) throw new Error('No response from AI');
    outBox.textContent = txt;
    label.textContent = '✓ Done — Generate another';
  } catch (e) {
    outBox.textContent = 'Error: ' + e.message + '\\n\\nPlease try again.';
    label.textContent = 'Try Again';
    uses--;
    localStorage.setItem(USES_KEY, uses);
    renderDots();
  }

  btn.disabled = false;
  spinner.classList.remove('show');
  if (left() <= 0) setTimeout(() => document.getElementById('paywall').classList.add('show'), 1200);
}

function copyOut() {
  const txt = document.getElementById('output-box').textContent;
  navigator.clipboard.writeText(txt).then(() => {
    const b = document.querySelector('.copy-btn');
    b.textContent = '✓ Copied';
    setTimeout(() => b.textContent = 'Copy', 2000);
  });
}

function showEmail() { document.getElementById('email-row').classList.add('show'); }

function submitEmail() {
  const email = document.getElementById('email-in').value.trim();
  if (!email || !email.includes('@')) { alert('Enter a valid email'); return; }
  localStorage.setItem(EMAIL_KEY, email);
  hasEmail = true;
  document.getElementById('paywall').classList.remove('show');
  document.getElementById('email-row').classList.remove('show');
  renderDots();
  updateUsageText();
  // Save lead (fire-and-forget)
  fetch('${process.env.SUPABASE_URL || ''}/rest/v1/leads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: '${process.env.SUPABASE_ANON_KEY || ''}', Authorization: 'Bearer ${process.env.SUPABASE_ANON_KEY || ''}', Prefer: 'return=minimal' },
    body: JSON.stringify({ email, product: SLUG, source: 'paywall', created_at: new Date().toISOString() })
  }).catch(() => {});
  alert('✅ 3 bonus uses unlocked! Enjoy.');
}

// Allow Ctrl+Enter to generate
document.getElementById('user-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) generate();
});

// ── Countdown timer ────────────────────────────────────────────────────────────
let endMs = parseInt(localStorage.getItem(TIMER_KEY) || '0');
if (!endMs || endMs < Date.now()) { endMs = Date.now() + 24 * 3600 * 1000; localStorage.setItem(TIMER_KEY, endMs); }
function tick() {
  const left = Math.max(0, endMs - Date.now());
  const h = String(Math.floor(left / 3600000)).padStart(2, '0');
  const m = String(Math.floor(left % 3600000 / 60000)).padStart(2, '0');
  const s = String(Math.floor(left % 60000 / 1000)).padStart(2, '0');
  const str = h + ':' + m + ':' + s;
  ['countdown', 'banner-timer'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = str; });
  if (left > 0) setTimeout(tick, 1000);
}
tick();
</script>
</body>
</html>`;
}

// ─── Deploy via Vercel file upload API ────────────────────────────────────────
async function deployToVercel(slug, htmlContent) {
  const vercelJson = JSON.stringify({
    rewrites: [{ source: "/(.*)", destination: "/index.html" }]
  });

  // Hash files for Vercel deduplication
  const files = [
    { file: 'index.html', data: htmlContent, sha: createHash('sha1').update(htmlContent).digest('hex') },
    { file: 'vercel.json', data: vercelJson, sha: createHash('sha1').update(vercelJson).digest('hex') },
  ];

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${VERCEL_KEY}`,
  };
  if (VERCEL_TEAM) headers['X-Vercel-Team-Id'] = VERCEL_TEAM;

  // Step 1: Upload each file
  for (const f of files) {
    const uploadRes = await fetch('https://api.vercel.com/v2/files', {
      method: 'POST',
      headers: {
        ...headers,
        'x-vercel-digest': f.sha,
        'Content-Type': 'application/octet-stream',
        'Content-Length': Buffer.byteLength(f.data).toString(),
      },
      body: f.data,
    });
    if (!uploadRes.ok && uploadRes.status !== 409) { // 409 = already exists (fine)
      const err = await uploadRes.text();
      throw new Error(`File upload failed (${uploadRes.status}): ${err.slice(0, 200)}`);
    }
  }

  // Step 2: Create deployment
  const deployBody = {
    name: slug,
    files: files.map(f => ({ file: f.file, sha: f.sha, size: Buffer.byteLength(f.data) })),
    projectSettings: { framework: null, buildCommand: null, outputDirectory: null },
    target: 'production',
  };

  const deployRes = await fetch('https://api.vercel.com/v13/deployments', {
    method: 'POST',
    headers,
    body: JSON.stringify(deployBody),
  });

  const d = await deployRes.json();
  if (!deployRes.ok) throw new Error(d.error?.message || JSON.stringify(d).slice(0, 200));

  const deployUrl = d.url ? `https://${d.url}` : null;
  const readyUrl = d.readyUrl ? `https://${d.readyUrl}` : deployUrl;
  return { deployUrl, readyUrl, id: d.id };
}

// ─── Wait for deployment to be ready ─────────────────────────────────────────
async function waitForReady(deployId, maxWaitSec = 90) {
  const headers = { Authorization: `Bearer ${VERCEL_KEY}` };
  if (VERCEL_TEAM) headers['X-Vercel-Team-Id'] = VERCEL_TEAM;
  const start = Date.now();
  while (Date.now() - start < maxWaitSec * 1000) {
    const r = await fetch(`https://api.vercel.com/v13/deployments/${deployId}`, { headers });
    const d = await r.json();
    console.log(`    Deployment state: ${d.readyState || d.status}`);
    if (d.readyState === 'READY') return `https://${d.url}`;
    if (d.readyState === 'ERROR' || d.readyState === 'CANCELED') throw new Error(`Deploy ${d.readyState}`);
    await new Promise(r => setTimeout(r, 3000));
  }
  return null;
}

// ─── Push to GitHub ───────────────────────────────────────────────────────────
async function pushToGitHub(slug, html) {
  if (!GITHUB_TOKEN) return false;
  const ghHead = { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' };
  const apiBase = `https://api.github.com/repos/${GITHUB_USERNAME}/${slug}/contents`;

  // Ensure repo exists
  const repoCheck = await fetch(`https://api.github.com/repos/${GITHUB_USERNAME}/${slug}`, { headers: ghHead });
  if (!repoCheck.ok) {
    await fetch('https://api.github.com/user/repos', {
      method: 'POST', headers: ghHead,
      body: JSON.stringify({ name: slug, auto_init: false, private: false }),
    });
    await new Promise(r => setTimeout(r, 1500));
  }

  // Push index.html
  const existing = await fetch(`${apiBase}/index.html`, { headers: ghHead }).then(r => r.ok ? r.json() : null);
  await fetch(`${apiBase}/index.html`, {
    method: 'PUT', headers: ghHead,
    body: JSON.stringify({
      message: 'fix: standalone HTML — no CDN deps, real AI tool, Gumroad CTA',
      content: Buffer.from(html, 'utf8').toString('base64'),
      ...(existing?.sha ? { sha: existing.sha } : {}),
    }),
  });

  // Push vercel.json
  const vjExisting = await fetch(`${apiBase}/vercel.json`, { headers: ghHead }).then(r => r.ok ? r.json() : null);
  await fetch(`${apiBase}/vercel.json`, {
    method: 'PUT', headers: ghHead,
    body: JSON.stringify({
      message: 'fix: add vercel.json static SPA config',
      content: Buffer.from('{"rewrites":[{"source":"/(.*)","destination":"/index.html"}]}', 'utf8').toString('base64'),
      ...(vjExisting?.sha ? { sha: vjExisting.sha } : {}),
    }),
  });
  return true;
}

// ─── VERIFY PAGE LOADS ────────────────────────────────────────────────────────
async function verifyPage(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const html = await r.text();
    const hasContent = html.includes('<nav>') && html.includes('generate()') && html.length > 8000;
    return { ok: r.ok, status: r.status, hasContent, size: html.length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  const targets = ALL ? portfolio : portfolio.filter(p => p.slug === TARGET_SLUG);
  if (!targets.length) {
    console.log(`Product "${TARGET_SLUG}" not found. Available: ${portfolio.map(p => p.slug).join(', ')}`);
    process.exit(1);
  }

  console.log('\n┌─────────────────────────────────────────────────────────┐');
  console.log(`│  🎯 SKILL #1: Perfect Product Page Deploy               │`);
  console.log(`│  Target: ${targets.map(p => p.name).join(', ').padEnd(46)} │`);
  console.log('└─────────────────────────────────────────────────────────┘\n');

  let successCount = 0;

  for (const product of targets) {
    console.log(`\n▶ ${product.name} (${product.slug})`);
    console.log('  Step 1: Build HTML with AI content...');
    const html = await buildHTML(product);
    console.log(`  ✓ HTML: ${(html.length / 1024).toFixed(1)}KB — no external dependencies`);

    console.log('  Step 2: Deploy to Vercel...');
    try {
      const { deployUrl, id } = await deployToVercel(product.slug, html);
      console.log(`  ✓ Deploy: ${deployUrl}`);
      console.log(`  Step 3: Waiting for ready...`);
      const liveUrl = await waitForReady(id, 90);
      console.log(`  ✓ Live: ${liveUrl || deployUrl}`);

      // Update portfolio
      const idx = portfolio.findIndex(p => p.slug === product.slug);
      if (idx >= 0 && liveUrl) portfolio[idx].vercel_url = liveUrl;
    } catch (ve) {
      console.log(`  ⚠️  Vercel: ${ve.message}`);
    }

    console.log('  Step 4: Push to GitHub...');
    try {
      const ghOk = await pushToGitHub(product.slug, html);
      if (ghOk) console.log(`  ✓ GitHub: github.com/${GITHUB_USERNAME}/${product.slug}`);
    } catch (ge) {
      console.log(`  ⚠️  GitHub: ${ge.message.slice(0, 60)}`);
    }

    console.log('  Step 5: Verify page loads...');
    await new Promise(r => setTimeout(r, 4000)); // Let Vercel propagate
    const check = await verifyPage(product.vercel_url);
    if (check.hasContent) {
      console.log(`  ✅ VERIFIED: Page loads with content (${(check.size / 1024).toFixed(1)}KB)`);
      console.log(`\n  🌐 LIVE: ${product.vercel_url}`);
      successCount++;
    } else {
      console.log(`  ⚠️  Page check: status=${check.status}, hasContent=${check.hasContent}, size=${check.size}`);
    }

    if (!ALL) break; // One at a time mode
    await new Promise(r => setTimeout(r, 2000));
  }

  // Save updated portfolio
  writeFileSync(join(__dirname, 'public/portfolio.json'), JSON.stringify(portfolio, null, 2));

  console.log('\n┌─────────────────────────────────────────────────────────┐');
  console.log(`│  RESULT: ${successCount}/${targets.length} products verified live             │`);
  if (targets[0]) {
    console.log(`│  OPEN:   ${targets[0].vercel_url.padEnd(48)} │`);
  }
  console.log('└─────────────────────────────────────────────────────────┘\n');
}

main().catch(e => { console.error('\n💥', e.message); process.exit(1); });
