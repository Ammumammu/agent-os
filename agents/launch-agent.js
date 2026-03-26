#!/usr/bin/env node
// agents/launch-agent.js — Deploy + Monetize Loop (Loop 3, Phase 3)
// Runs daily at 07:00 after builder-agent
// Creates Vercel projects → Stripe products → injects payment links → updates portfolio

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { fetchWithRetry } from '../lib/fetch-retry.js';
import { sendAlert, sendSuccess } from '../lib/alert.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.AGENT_OS_URL || 'http://localhost:3000';
if (!process.env.AGENT_OS_URL) console.warn('[launch-agent] ⚠️  AGENT_OS_URL not set — Vercel deploy + Stripe calls will fail. Add it to GitHub Secrets.');
const BUILT_FILE = join(__dirname, '../products/built-products.json');
const PORTFOLIO_FILE = join(__dirname, '../public/portfolio.json');
const LAUNCHED_FILE = join(__dirname, '../products/launched-products.json');
const LOG_FILE = join(__dirname, '../products/launch-agent.log');
const GITHUB_USERNAME = process.env.GITHUB_USERNAME;

async function run() {
  log('🚀 launch-agent starting...');

  // ── Stripe mode check ──────────────────────────────────────────────────────
  const stripeKey = process.env.STRIPE_SECRET_KEY || '';
  if (!stripeKey) {
    log('⚠️  STRIPE_SECRET_KEY not set — Stripe phases will be skipped.');
  } else if (stripeKey.startsWith('sk_test_')) {
    log('⚠️  WARNING: STRIPE_SECRET_KEY is a TEST key (sk_test_...).');
    log('   Payment links will be test-mode only. No real revenue will flow.');
    log('   → To go live: replace with sk_live_... in GitHub Secrets + Vercel env.');
  } else if (stripeKey.startsWith('sk_live_')) {
    log('✅ Stripe LIVE mode confirmed.');
  }

  const builtData = loadBuilt();
  if (!builtData?.products?.length) {
    log('❌ No built products found. Run builder-agent first.');
    return;
  }

  const products = builtData.products.filter(p => p.status === 'pushed' || p.status === 'html_ready');
  log(`Launching ${products.length} products...`);

  const launched = [];

  for (const built of products) {
    const { spec } = built;
    log(`\n--- Launching: ${spec.name} ---`);

    try {
      // Phase 1: Deploy to Vercel (direct file upload — no GitHub App needed)
      log(`  Phase 1: Deploying to Vercel...`);
      const vercelJson = JSON.stringify({ rewrites: [{ source: '/(.*)', destination: '/' }] });
      const deployResult = await callAPI('/api/deploy', {
        action: 'deployFiles',
        name: spec.slug,
        files: [
          { path: 'index.html', content: built.html },
          { path: 'vercel.json', content: vercelJson },
        ],
      });
      const liveUrl = deployResult.url
        ? `https://${deployResult.url}`
        : `https://${spec.slug}.vercel.app`;
      log(`  ✓ Live: ${liveUrl}`);

      // Phase 2: Create Stripe product + price + payment link
      log(`  Phase 2: Creating Stripe payment link...`);
      const stripeResult = await callAPI('/api/stripe', {
        action: 'createFull',
        name: spec.name,
        description: spec.tagline,
        slug: spec.slug,
        monthly_usd: spec.pricing?.monthly_usd || 9,
        successUrl: `${liveUrl}/success`,
      }).catch(e => { log(`  ⚠️ Stripe error: ${e.message}`); return null; });

      const stripeLink = stripeResult?.payment_url || stripeResult?.link?.url || '';

      // Phase 3: Create Gumroad listing
      log(`  Phase 3: Creating Gumroad listing...`);
      const gumroadResult = await callAPI('/api/commerce', {
        action: 'createProduct',
        name: spec.name,
        description: spec.tagline,
        price_usd: spec.pricing?.one_time_usd || 19,
        productUrl: liveUrl,
      }).catch(() => null);

      const gumroadLink = gumroadResult?.product?.short_url || '';

      // Phase 4: Inject real payment links into deployed HTML
      if (GITHUB_USERNAME && stripeLink) {
        log(`  Phase 4: Injecting payment links into HTML...`);
        try {
          const fileResult = await callAPI('/api/github', {
            action: 'getFile',
            owner: GITHUB_USERNAME,
            repo: spec.slug,
            path: 'index.html',
          });

          if (fileResult?.content) {
            let html = Buffer.from(fileResult.content, 'base64').toString('utf8');
            html = html
              .replace(/https:\/\/buy\.stripe\.com\/placeholder-[^"']*/g, stripeLink)
              .replace(/https:\/\/gumroad\.com\/l\/placeholder-[^"']*/g, gumroadLink || stripeLink);

            await callAPI('/api/github', {
              action: 'pushFile',
              owner: GITHUB_USERNAME,
              repo: spec.slug,
              path: 'index.html',
              content: html,
              message: 'feat: inject real payment links',
              sha: fileResult.sha,
            });
            log(`  ✓ Payment links injected + redeployed`);
          }
        } catch (e) {
          log(`  ⚠️ Payment injection failed: ${e.message}`);
        }
      }

      // Phase 5: Build portfolio entry
      const product = {
        id: Date.now() + Math.random(),
        name: spec.name,
        slug: spec.slug,
        tagline: spec.tagline,
        icp: spec.icp,
        category: spec.category || 'other',
        status: 'live',
        github_url: GITHUB_USERNAME ? `https://github.com/${GITHUB_USERNAME}/${spec.slug}` : null,
        vercel_url: liveUrl,
        stripe_link: stripeLink,
        gumroad_link: gumroadLink,
        stripe_product_id: stripeResult?.product?.id,
        mrr_usd: 0,
        visitors: 0,
        conversion_rate: 0,
        demand_score: spec.demand_score,
        keywords: spec.keywords || [],
        pricing: spec.pricing,
        launched_at: new Date().toISOString(),
      };

      launched.push(product);

      // Update portfolio.json
      updatePortfolio(product);
      log(`  ✓ ${spec.name} launched: ${liveUrl}`);

    } catch (e) {
      log(`  ❌ Launch failed for ${spec.name}: ${e.message}`);
    }
  }

  const result = {
    date: new Date().toISOString().split('T')[0],
    run_at: new Date().toISOString(),
    launched: launched.length,
    products: launched,
  };

  writeFileSync(LAUNCHED_FILE, JSON.stringify(result, null, 2));

  log(`\n✅ launch-agent complete.`);
  log(`   Launched: ${launched.length} products`);
  launched.forEach(p => log(`   → ${p.name}: ${p.vercel_url} | Stripe: ${p.stripe_link}`));

  if (launched.length > 0) {
    await sendSuccess('launch-agent', `${launched.length} product(s) launched`, {
      Products: launched.map(p => p.name).join(', '),
      URLs: launched.map(p => p.vercel_url).join(', '),
    });
  }

  return result;
}

function updatePortfolio(product) {
  let portfolio = [];
  if (existsSync(PORTFOLIO_FILE)) {
    try { portfolio = JSON.parse(readFileSync(PORTFOLIO_FILE, 'utf8')); } catch (_) {}
  }
  // Replace if slug already exists (update), otherwise append
  const existing = portfolio.findIndex(p => p.slug === product.slug);
  if (existing >= 0) portfolio[existing] = product;
  else portfolio.push(product);
  writeFileSync(PORTFOLIO_FILE, JSON.stringify(portfolio, null, 2));
  log(`  ✓ Portfolio updated (${portfolio.length} total products)`);
}

function loadBuilt() {
  if (!existsSync(BUILT_FILE)) return null;
  try { return JSON.parse(readFileSync(BUILT_FILE, 'utf8')); } catch (_) { return null; }
}

async function callAPI(path, body) {
  const r = await fetchWithRetry(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`API ${path} returned ${r.status}`);
  return r.json();
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    const existing = existsSync(LOG_FILE) ? readFileSync(LOG_FILE, 'utf8') : '';
    writeFileSync(LOG_FILE, existing + line + '\n');
  } catch (_) {}
}

run().catch(async (e) => {
  await sendAlert('launch-agent', e.message, { stack: (e.stack || '').slice(0, 500) });
  console.error(e);
  process.exit(1);
});
