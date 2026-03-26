#!/usr/bin/env node
// agents/analytics-agent.js — Rankings + Revenue + Self-Improvement Loop (Loop 6)
// Runs daily at 22:00 (after all other agents)
// Fetches all metrics → writes to Pinecone memory → plans tomorrow → sends digest

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { fetchWithRetry } from '../lib/fetch-retry.js';
import { sendAlert, sendSuccess } from '../lib/alert.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.AGENT_OS_URL || 'http://localhost:3000';
if (!process.env.AGENT_OS_URL) console.warn('[analytics-agent] ⚠️  AGENT_OS_URL not set — add it to GitHub Secrets (your Vercel deployment URL)');
const PORTFOLIO_FILE = join(__dirname, '../public/portfolio.json');
const MEMORY_FILE = join(__dirname, '../products/insights-memory.json');
const TOMORROW_FILE = join(__dirname, '../products/tomorrow-queue.json');
const COPY_QUEUE_FILE = join(__dirname, '../products/copy-queue.json');
const LOG_FILE = join(__dirname, '../products/analytics-agent.log');

async function run() {
  log('📊 analytics-agent starting...');

  const portfolio = loadPortfolio();
  log(`Analyzing ${portfolio.length} products...`);

  // ─ Step 1: Fetch all revenue data ────────────────────────────────────────
  log('Step 1: Fetching revenue data...');
  const mrrData = await callAPI('/api/analytics', { action: 'mrr' }).catch(() => ({ mrr_usd: 0 }));
  log(`  MRR: $${mrrData.mrr_usd || 0} | Subs: ${mrrData.active_subscriptions || 0}`);

  // ─ Step 2: Fetch traffic/conversion data from PostHog ────────────────────
  log('Step 2: Fetching PostHog metrics...');
  const trafficData = await callAPI('/api/analytics', { action: 'traffic', dateFrom: '-1d' }).catch(() => null);

  // ─ Step 3: Check SERP rankings for top products ───────────────────────────
  log('Step 3: Checking SERP rankings...');
  const rankingResults = [];
  for (const product of portfolio.filter(p => p.status === 'live').slice(0, 5)) {
    const keywords = product.keywords?.slice(0, 3) || [];
    if (keywords.length > 0) {
      const domain = product.vercel_url?.replace('https://', '').split('/')[0];
      const ranks = await callAPI('/api/discover', { action: 'batch_check', keywords, domain }).catch(() => null);
      if (ranks) rankingResults.push({ product: product.slug, ...ranks });
      await sleep(1000);
    }
  }
  log(`  Checked rankings for ${rankingResults.length} products`);

  // ─ Step 4: Identify winners and losers ────────────────────────────────────
  log('Step 4: Identifying winners + losers...');
  const winnerCheck = [];
  const loserCheck = [];
  for (const product of portfolio.filter(p => p.status === 'live')) {
    const winnerData = await callAPI('/api/analytics', { action: 'winner_check', product: product.slug }).catch(() => null);
    if (winnerData?.is_winner) winnerCheck.push(winnerData);

    const loserData = await callAPI('/api/analytics', { action: 'loser_check', product: product.slug }).catch(() => null);
    if (loserData?.retire) loserCheck.push(loserData);
  }
  log(`  Found ${winnerCheck.length} winners, ${loserCheck.length} losers`);

  // ─ Step 4b: Auto-act on winners ──────────────────────────────────────────
  if (winnerCheck.length > 0) {
    log('Step 4b: Acting on winners...');
    for (const winner of winnerCheck) {
      const product = portfolio.find(p => p.slug === winner.product || p.slug === winner.slug);
      if (!product) continue;
      log(`  🏆 WINNER: ${product.name} — activation ${winner.activation_rate || '?'}%, paywall_ctr ${winner.paywall_ctr || '?'}%, MRR $${product.mrr_usd || 0}`);

      // 1. Mark as winner in portfolio
      product.is_winner = true;
      product.winner_since = product.winner_since || new Date().toISOString().split('T')[0];
      updatePortfolio(product);

      // 2. Trigger traffic-agent repost (queue for next traffic run)
      const copyQueue = loadCopyQueue();
      const alreadyQueued = copyQueue.some(q => q.slug === product.slug && q.reason === 'winner_repost');
      if (!alreadyQueued) {
        copyQueue.push({
          slug: product.slug,
          name: product.name,
          vercel_url: product.vercel_url,
          reason: 'winner_repost',
          queued_at: new Date().toISOString(),
        });
        saveCopyQueue(copyQueue);
        log(`  → Queued winner repost for ${product.name}`);
      }

      // 3. Double tomorrow's build budget for adjacent keywords
      const tomorrow = loadTomorrow();
      if (tomorrow?.build_queue) {
        tomorrow.winner_focus = {
          slug: product.slug,
          category: product.category,
          instruction: `Prioritise keywords adjacent to winning product "${product.name}" (${product.category}). Double build budget for this category.`,
        };
        writeFileSync(TOMORROW_FILE, JSON.stringify(tomorrow, null, 2));
        log(`  → Tomorrow queue updated: focus on ${product.category} (winner category)`);
      }

      // 4. Send Slack success alert
      await sendSuccess('analytics-agent', `🏆 Winner detected: ${product.name}`, {
        MRR: `$${product.mrr_usd || 0}`,
        'Activation rate': `${winner.activation_rate || '?'}%`,
        'Paywall CTR': `${winner.paywall_ctr || '?'}%`,
        URL: product.vercel_url,
        Action: 'Winner repost queued + tomorrow build queue focused on this category',
      });
    }
  }

  // ─ Step 4c: Auto-retire losers ───────────────────────────────────────────
  if (loserCheck.length > 0) {
    log('Step 4c: Retiring losers...');
    for (const loser of loserCheck) {
      const product = portfolio.find(p => p.slug === loser.product || p.slug === loser.slug);
      if (!product) continue;
      if (product.is_winner) { log(`  ⚠️  Skipping winner ${product.name} from loser retirement`); continue; }

      const daysSinceLaunch = Math.floor((Date.now() - new Date(product.launched_at || 0).getTime()) / 86400000);
      if (daysSinceLaunch < 30) {
        log(`  ⏭️  Too early to retire ${product.name} (${daysSinceLaunch} days old — need 30)`);
        continue;
      }

      log(`  📦 Retiring loser: ${product.name} (${daysSinceLaunch} days, $${product.mrr_usd || 0} MRR)`);

      // Mark retired in portfolio
      product.status = 'retired';
      product.retired_at = new Date().toISOString();
      product.retirement_reason = `No revenue after ${daysSinceLaunch} days: MRR $${product.mrr_usd || 0}, conversion ${((product.conversion_rate || 0) * 100).toFixed(2)}%`;
      updatePortfolio(product);

      // Push 301 redirect to best performing product
      const bestProduct = portfolio.filter(p => p.status === 'live' && p.mrr_usd > 0).sort((a, b) => b.mrr_usd - a.mrr_usd)[0];
      if (bestProduct && process.env.GITHUB_TOKEN && process.env.GITHUB_USERNAME) {
        try {
          const redirectHtml = `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${bestProduct.vercel_url}"><link rel="canonical" href="${bestProduct.vercel_url}"></head><body><script>window.location.replace("${bestProduct.vercel_url}")<\/script></body></html>`;
          await callAPI('/api/github', {
            action: 'pushFile',
            owner: process.env.GITHUB_USERNAME,
            repo: product.slug,
            path: 'index.html',
            content: redirectHtml,
            message: `chore: retire product — redirect to ${bestProduct.slug}`,
          });
          log(`  → Redirect pushed: ${product.slug} → ${bestProduct.slug}`);
        } catch (e) {
          log(`  ⚠️  Redirect push failed: ${e.message}`);
        }
      }

      await sendAlert('analytics-agent', `📦 Product retired: ${product.name}`, {
        Reason: product.retirement_reason,
        'Days live': daysSinceLaunch,
        'Redirect to': bestProduct?.name || 'none',
      });
    }
  }

  // ─ Step 5: Extract insights with Groq ────────────────────────────────────
  log('Step 5: Extracting insights...');
  const dayData = {
    mrr: mrrData,
    traffic: trafficData,
    rankings: rankingResults,
    winners: winnerCheck,
    losers: loserCheck,
    portfolio_count: portfolio.length,
    date: new Date().toISOString().split('T')[0],
  };

  const insights = await extractInsights(dayData);
  log(`  Extracted ${insights.length} insights`);

  // ─ Step 6: Write insights to Pinecone (vector memory) ────────────────────
  log('Step 6: Writing insights to memory...');
  let pineconeSuccess = 0;
  for (const insight of insights) {
    try {
      await writeToMemory(insight);
      pineconeSuccess++;
    } catch (_) { }
  }
  log(`  Stored ${pineconeSuccess}/${insights.length} insights to Pinecone`);

  // Also save to local file as fallback
  saveInsightsLocally(insights);

  // ─ Step 7: Plan tomorrow's build queue ───────────────────────────────────
  log('Step 7: Planning tomorrow...');
  const tomorrow = await planTomorrow(insights, portfolio, mrrData);
  writeFileSync(TOMORROW_FILE, JSON.stringify(tomorrow, null, 2));
  log(`  Tomorrow's queue: ${tomorrow.build_queue?.length || 0} products planned`);

  // ─ Step 8: Send daily digest email ───────────────────────────────────────
  log('Step 8: Sending daily digest...');
  const ownerEmail = process.env.OWNER_EMAIL;
  if (ownerEmail) {
    const digest = await callAPI('/api/analytics', { action: 'daily_digest' }).catch(() => null);
    if (digest) {
      await callAPI('/api/email', {
        action: 'digest',
        to: ownerEmail,
        data: { ...digest, mrr: mrrData.mrr_usd },
      }).catch(e => log(`  ⚠️ Email failed: ${e.message}`));
      log(`  ✓ Digest sent to ${ownerEmail}`);
    }
  }

  // ─ Final report ──────────────────────────────────────────────────────────
  log('\n✅ analytics-agent complete.');
  log(`\n📊 DAILY REPORT:`);
  log(`   MRR: $${mrrData.mrr_usd || 0} (${mrrData.active_subscriptions || 0} subs)`);
  log(`   ARR: $${mrrData.arr_usd || 0}`);
  log(`   Products live: ${portfolio.filter(p => p.status === 'live').length}`);
  log(`   Rankings checked: ${rankingResults.length}`);
  log(`   Top insight: ${insights[0]?.lesson || 'none'}`);
  log(`   Tomorrow's builds: ${tomorrow.build_queue?.length || 0}`);
  log(`   Milestone: ${mrrData.milestone || 'pre-revenue'}`);

  // Send daily Slack digest (success notification)
  if (mrrData.mrr_usd > 0) {
    await sendSuccess('analytics-agent', `Daily report complete`, {
      MRR: `$${mrrData.mrr_usd}`,
      ARR: `$${mrrData.arr_usd || (mrrData.mrr_usd * 12).toFixed(0)}`,
      Products: portfolio.filter(p => p.status === 'live').length,
      'Top insight': insights[0]?.lesson || 'n/a',
    });
  }

  return { mrr: mrrData, insights, tomorrow, rankings: rankingResults };
}

// ─── Extract insights from day's data using Groq ─────────────────────────────
async function extractInsights(dayData) {
  const prompt = `Analyze today's SaaS business data and extract actionable insights.

Data:
${JSON.stringify(dayData, null, 2).slice(0, 1500)}

Return a JSON array of 5-7 insights:
[
  {
    "lesson": "specific, actionable insight in one sentence",
    "category": "one of: pricing_lesson|traffic_insight|copy_winner|icp_discovery|feature_request|failure_mode|channel_performance",
    "confidence": 0.8,
    "action": "what to do tomorrow based on this insight"
  }
]

Return valid JSON array only. No explanation.`;

  const raw = await groq(prompt);
  try {
    const match = raw.match(/\[[\s\S]*\]/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return parsed.map(i => ({ ...i, date: new Date().toISOString().split('T')[0] }));
    }
  } catch (_) { }

  // Fallback insights
  return [
    { lesson: 'Continue building — data is accumulating', category: 'channel_performance', confidence: 0.5, action: 'Run all agents again tomorrow', date: new Date().toISOString().split('T')[0] },
  ];
}

// ─── Write insight to Pinecone (sparse: embed via Inference API, then upsert) ─
async function writeToMemory(insight) {
  const PINECONE_HOST = process.env.PINECONE_HOST;
  const PINECONE_KEY = process.env.PINECONE_API_KEY;
  if (!PINECONE_HOST || !PINECONE_KEY) return;

  // Step 1: Generate sparse vector via Pinecone Inference API
  const embedR = await fetch('https://api.pinecone.io/embed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Api-Key': PINECONE_KEY, 'X-Pinecone-API-Version': '2024-10' },
    body: JSON.stringify({
      model: 'pinecone-sparse-english-v0',
      parameters: { input_type: 'passage', truncation: 'END' },
      inputs: [{ text: insight.lesson }],
    }),
  });
  const embedData = await embedR.json();
  if (!embedR.ok) throw new Error(`Pinecone embed failed: ${JSON.stringify(embedData)}`);
  const e = embedData.data?.[0];

  // Step 2: Upsert with sparse_values
  const id = `insight-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await fetch(`${PINECONE_HOST}/vectors/upsert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Api-Key': PINECONE_KEY },
    body: JSON.stringify({
      vectors: [{
        id,
        sparse_values: { indices: e.sparse_indices, values: e.sparse_values },
        metadata: {
          text: insight.lesson,
          category: insight.category,
          confidence: insight.confidence,
          action: insight.action,
          date: insight.date,
          type: 'daily_insight',
        },
      }],
    }),
  });
}

// ─── Plan tomorrow's build queue ─────────────────────────────────────────────
async function planTomorrow(insights, portfolio, mrrData) {
  const topInsights = insights.filter(i => i.confidence >= 0.7).slice(0, 3).map(i => i.lesson).join('\n');
  const topCategory = portfolio.filter(p => p.mrr_usd > 0).sort((a, b) => b.mrr_usd - a.mrr_usd)[0]?.category;

  const prompt = `Based on today's insights and portfolio data, recommend 5 keywords to build tools for tomorrow.

Today's top insights:
${topInsights || 'No strong insights yet — continue experimenting'}

Portfolio stats:
- Total products: ${portfolio.length}
- Best performing category: ${topCategory || 'none yet'}
- MRR: $${mrrData.mrr_usd || 0}

Rules:
- Prioritize keywords adjacent to top category (if exists)
- Prefer keywords with clear monetization path
- Mix of quick wins (score ≥ 8) and strategic plays (adjacent to winner)

Return JSON:
{
  "strategy": "one sentence explaining tomorrow's focus",
  "build_queue": [
    { "keyword": "specific keyword", "score": 8.5, "reason": "why this one", "category": "category" }
  ]
}`;

  const raw = await groq(prompt);
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return { ...JSON.parse(match[0]), planned_at: new Date().toISOString() };
  } catch (_) { }

  return {
    strategy: 'Continue building across all niches',
    build_queue: [],
    planned_at: new Date().toISOString(),
  };
}

function saveInsightsLocally(insights) {
  let existing = [];
  if (existsSync(MEMORY_FILE)) {
    try { existing = JSON.parse(readFileSync(MEMORY_FILE, 'utf8')); } catch (_) { }
  }
  const updated = [...existing, ...insights].slice(-200); // keep last 200
  writeFileSync(MEMORY_FILE, JSON.stringify(updated, null, 2));
}

async function groq(prompt) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.6,
      max_tokens: 1500,
    }),
  });
  const d = await r.json();
  return d.choices?.[0]?.message?.content || '';
}

function loadPortfolio() {
  if (!existsSync(PORTFOLIO_FILE)) return [];
  try { return JSON.parse(readFileSync(PORTFOLIO_FILE, 'utf8')); } catch (_) { return []; }
}

function updatePortfolio(product) {
  const portfolio = loadPortfolio();
  const idx = portfolio.findIndex(p => p.slug === product.slug);
  if (idx >= 0) portfolio[idx] = product;
  else portfolio.push(product);
  writeFileSync(PORTFOLIO_FILE, JSON.stringify(portfolio, null, 2));
}

function loadCopyQueue() {
  if (!existsSync(COPY_QUEUE_FILE)) return [];
  try { return JSON.parse(readFileSync(COPY_QUEUE_FILE, 'utf8')); } catch (_) { return []; }
}

function saveCopyQueue(queue) {
  writeFileSync(COPY_QUEUE_FILE, JSON.stringify(queue, null, 2));
}

function loadTomorrow() {
  if (!existsSync(TOMORROW_FILE)) return null;
  try { return JSON.parse(readFileSync(TOMORROW_FILE, 'utf8')); } catch (_) { return null; }
}

async function callAPI(path, body) {
  const r = await fetchWithRetry(`${BASE_URL}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
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
  } catch (_) { }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

run().catch(async (e) => {
  await sendAlert('analytics-agent', e.message, { stack: (e.stack || '').slice(0, 500) });
  console.error(e);
  process.exit(1);
});
