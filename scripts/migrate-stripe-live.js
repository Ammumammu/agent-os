#!/usr/bin/env node
// scripts/migrate-stripe-live.js
// Switches all portfolio products from Stripe TEST to LIVE mode.
//
// Usage:
//   STRIPE_SECRET_KEY=sk_live_... node scripts/migrate-stripe-live.js
//
// What it does:
//   1. Reads public/portfolio.json
//   2. For each product, creates a LIVE Stripe product + price + payment link
//   3. Updates the product's index.html on GitHub with the live payment link
//   4. Updates public/portfolio.json with live stripe_link
//   5. Prints a summary table

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORTFOLIO_FILE = join(__dirname, '../public/portfolio.json');
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_USERNAME = process.env.GITHUB_USERNAME;

if (!STRIPE_KEY) { console.error('❌ STRIPE_SECRET_KEY not set'); process.exit(1); }
if (!STRIPE_KEY.startsWith('sk_live_')) { console.error('❌ STRIPE_SECRET_KEY must be sk_live_... for this script'); process.exit(1); }
if (!GITHUB_TOKEN) { console.error('❌ GITHUB_TOKEN not set'); process.exit(1); }
if (!GITHUB_USERNAME) { console.error('❌ GITHUB_USERNAME not set'); process.exit(1); }

const sh = { Authorization: `Bearer ${STRIPE_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' };
const qs = (obj) => new URLSearchParams(obj).toString();
const ghh = () => ({ Authorization: `token ${GITHUB_TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/vnd.github+json' });

async function stripeCreateProduct(name, description) {
  const r = await fetch('https://api.stripe.com/v1/products', {
    method: 'POST', headers: sh,
    body: qs({ name, description: description || name }),
  });
  return r.json();
}

async function stripeCreatePrice(productId, amountCents) {
  const r = await fetch('https://api.stripe.com/v1/prices', {
    method: 'POST', headers: sh,
    body: qs({ product: productId, unit_amount: String(amountCents), currency: 'usd', 'recurring[interval]': 'month' }),
  });
  return r.json();
}

async function stripeCreatePaymentLink(priceId, successUrl) {
  const r = await fetch('https://api.stripe.com/v1/payment_links', {
    method: 'POST', headers: sh,
    body: qs({ 'line_items[0][price]': priceId, 'line_items[0][quantity]': '1', ...(successUrl ? { after_completion: 'redirect', redirect_url: successUrl } : {}) }),
  });
  return r.json();
}

async function ghGetFileSha(repo, path) {
  try {
    const r = await fetch(`https://api.github.com/repos/${GITHUB_USERNAME}/${repo}/contents/${path}`, { headers: ghh() });
    if (r.ok) { const d = await r.json(); return { sha: d.sha, content: Buffer.from(d.content, 'base64').toString('utf8') }; }
  } catch (_) {}
  return null;
}

async function ghPushFile(repo, path, content, message, sha) {
  const r = await fetch(`https://api.github.com/repos/${GITHUB_USERNAME}/${repo}/contents/${path}`, {
    method: 'PUT', headers: ghh(),
    body: JSON.stringify({ message, content: Buffer.from(content).toString('base64'), ...(sha ? { sha } : {}) }),
  });
  if (!r.ok) { const d = await r.json(); throw new Error(`GitHub push failed ${r.status}: ${JSON.stringify(d)}`); }
  return r.json();
}

function injectLiveStripeLink(html, oldLink, newLink) {
  // Replace test_ link with live link
  return html
    .replace(/https:\/\/buy\.stripe\.com\/test_[^\s"'<>]+/g, newLink)
    .replace(/buy\.stripe\.com\/test_[^\s"'<>]+/g, newLink.replace('https://', ''));
}

async function migrateProduct(product) {
  const { name, slug, tagline, pricing, stripe_link: oldLink } = product;
  const isTest = oldLink && oldLink.includes('test_');

  console.log(`\n→ ${name} (${slug})`);
  if (!isTest) { console.log('  ✓ Already live or no Stripe link — skipping'); return product; }

  // 1. Create LIVE Stripe product
  const stripeProduct = await stripeCreateProduct(name, tagline);
  if (stripeProduct.error) { console.error(`  ❌ Stripe product failed: ${stripeProduct.error.message}`); return product; }
  console.log(`  ✓ Stripe product: ${stripeProduct.id}`);

  // 2. Create LIVE price
  const amountCents = (pricing?.monthly_usd || 9) * 100;
  const stripePrice = await stripeCreatePrice(stripeProduct.id, amountCents);
  if (stripePrice.error) { console.error(`  ❌ Stripe price failed: ${stripePrice.error.message}`); return product; }
  console.log(`  ✓ Stripe price: ${stripePrice.id} ($${pricing?.monthly_usd || 9}/mo)`);

  // 3. Create LIVE payment link
  const successUrl = product.vercel_url ? `${product.vercel_url}/success` : undefined;
  const paymentLink = await stripeCreatePaymentLink(stripePrice.id, successUrl);
  if (paymentLink.error) { console.error(`  ❌ Payment link failed: ${paymentLink.error.message}`); return product; }
  const liveLink = `https://buy.stripe.com/${paymentLink.id}`;
  console.log(`  ✓ Live payment link: ${liveLink}`);

  // 4. Update index.html on GitHub
  const repoFile = await ghGetFileSha(slug, 'index.html');
  if (repoFile) {
    const updatedHtml = injectLiveStripeLink(repoFile.content, oldLink, liveLink);
    await ghPushFile(slug, 'index.html', updatedHtml, 'fix: switch to live Stripe payment link', repoFile.sha);
    console.log(`  ✓ GitHub index.html updated with live link`);
    console.log(`  ↻  Vercel will auto-redeploy in ~60s`);
  } else {
    console.log(`  ⚠️  Could not find ${slug}/index.html on GitHub — update manually`);
  }

  return { ...product, stripe_link: liveLink, stripe_product_id: stripeProduct.id };
}

async function run() {
  console.log('🔄 Stripe Live Migration Script');
  console.log(`   Key: sk_live_...${STRIPE_KEY.slice(-4)}`);
  console.log(`   GitHub: ${GITHUB_USERNAME}`);

  const portfolio = JSON.parse(readFileSync(PORTFOLIO_FILE, 'utf8'));
  const testProducts = portfolio.filter(p => p.stripe_link?.includes('test_'));
  console.log(`\n📋 Found ${testProducts.length} products with test Stripe links (of ${portfolio.length} total)\n`);

  const results = [];
  for (const product of portfolio) {
    const updated = await migrateProduct(product);
    results.push(updated);
    await new Promise(r => setTimeout(r, 500)); // Rate limit buffer
  }

  writeFileSync(PORTFOLIO_FILE, JSON.stringify(results, null, 2));
  console.log('\n✅ portfolio.json updated with live links');

  const migrated = results.filter(p => !p.stripe_link?.includes('test_')).length;
  console.log(`\n📊 Summary:`);
  console.log(`   Migrated: ${migrated}/${portfolio.length} products`);
  console.log(`   Products will auto-redeploy on Vercel within 60 seconds`);
  console.log(`\n🎯 Next: Set up Stripe Webhook in live mode:`);
  console.log(`   Dashboard: https://dashboard.stripe.com/webhooks`);
  console.log(`   Endpoint: https://agent-os-seven.vercel.app/api/webhook/stripe`);
  console.log(`   Events: payment_intent.succeeded, customer.subscription.created`);
}

run().catch(e => { console.error('❌ Fatal:', e.message); process.exit(1); });
