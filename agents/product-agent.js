#!/usr/bin/env node
// agents/product-agent.js — Keyword → SaaS Idea Loop (Loop 3, Phase 1)
// Runs daily at 04:00 after seo-agent
// Reads build queue → generates full product specs → selects top 3 for build

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { fetchWithRetry } from '../lib/fetch-retry.js';
import { sendAlert } from '../lib/alert.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.AGENT_OS_URL || 'http://localhost:3000';
if (!process.env.AGENT_OS_URL) console.warn('[product-agent] ⚠️  AGENT_OS_URL not set — add it to GitHub Secrets (your Vercel deployment URL)');
const QUEUE_FILE = join(__dirname, '../products/build-queue.json');
const SPECS_FILE = join(__dirname, '../products/product-specs.json');
const LOG_FILE = join(__dirname, '../products/product-agent.log');

async function run() {
  log('🛠️ product-agent starting...');

  const queue = loadQueue();
  if (!queue?.build_queue?.length) {
    log('❌ No build queue found. Run market-agent first.');
    return;
  }

  const buildQueue = queue.build_queue;
  log(`Processing ${buildQueue.length} keywords → generating SaaS specs...`);

  const specs = [];
  const existing = loadExistingSpecSlugs();

  for (const kw of buildQueue) {
    if (existing.has(kw.keyword)) {
      log(`  ⏭️ Skipping "${kw.keyword}" — spec already exists`);
      continue;
    }

    try {
      log(`  Generating spec for: "${kw.keyword}"...`);
      const { spec } = await callAPI('/api/product', {
        action: 'full_spec',
        keyword: kw.keyword,
        sourceData: kw,
      });

      if (spec.demand_score >= 7.0) {
        specs.push(spec);
        log(`  ✓ [${spec.demand_score}] ${spec.name} — ${spec.tagline}`);
      } else {
        log(`  ⏭️ Skipping "${kw.keyword}" — demand_score ${spec.demand_score} < 7.0`);
      }

      await sleep(1500); // Groq rate limit
    } catch (e) {
      log(`  ❌ Error on "${kw.keyword}": ${e.message}`);
    }
  }

  // Rank specs by demand score
  const ranked = specs.sort((a, b) => b.demand_score - a.demand_score);
  const buildSelection = ranked.slice(0, 3); // Top 3 go to builder-agent

  const result = {
    date: new Date().toISOString().split('T')[0],
    run_at: new Date().toISOString(),
    total_processed: buildQueue.length,
    specs_generated: specs.length,
    selected_for_build: buildSelection,
    all_specs: ranked,
  };

  writeFileSync(SPECS_FILE, JSON.stringify(result, null, 2));

  log(`\n✅ product-agent complete.`);
  log(`   Specs generated: ${specs.length}`);
  log(`   Selected for build: ${buildSelection.length}`);
  console.log('\n🎯 SELECTED FOR BUILD:');
  buildSelection.forEach((s, i) => console.log(`  ${i + 1}. [${s.demand_score}] ${s.name} — ${s.tagline} ($${s.pricing?.monthly_usd}/mo)`));

  return result;
}

function loadQueue() {
  if (!existsSync(QUEUE_FILE)) return null;
  try { return JSON.parse(readFileSync(QUEUE_FILE, 'utf8')); } catch (_) { return null; }
}

function loadExistingSpecSlugs() {
  if (!existsSync(SPECS_FILE)) return new Set();
  try {
    const data = JSON.parse(readFileSync(SPECS_FILE, 'utf8'));
    return new Set((data.all_specs || []).map(s => s.keywords?.[0] || s.slug));
  } catch (_) { return new Set(); }
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

run().catch(async (e) => {
  await sendAlert('product-agent', e.message, { stack: (e.stack || '').slice(0, 500) });
  console.error(e);
  process.exit(1);
});
