#!/usr/bin/env node
// agents/market-agent.js — Market Discovery Loop (Loop 1)
// Runs daily at 00:00 via cron or manual trigger
// Discovers 50 keywords → scores → writes top 10 to build queue

import { writeFileSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { fetchWithRetry } from '../lib/fetch-retry.js';
import { sendAlert } from '../lib/alert.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.AGENT_OS_URL || 'http://localhost:3000';
if (!process.env.AGENT_OS_URL) console.warn('[market-agent] ⚠️  AGENT_OS_URL not set — add it to GitHub Secrets (your Vercel deployment URL, e.g. https://agent-os-seven.vercel.app)');
const QUEUE_FILE = join(__dirname, '../products/build-queue.json');
const LOG_FILE = join(__dirname, '../products/market-agent.log');

// ─── Main entry point ─────────────────────────────────────────────────────────
async function run() {
  log('🔍 market-agent starting...');

  try {
    // 1. Discover keywords from all sources
    const discovered = await discoverKeywords();
    log(`Discovered ${discovered.length} raw keywords`);

    // 2. Score each keyword
    const scored = await scoreKeywords(discovered);
    log(`Scored ${scored.length} keywords`);

    // 3. Filter and rank
    const buildQueue = scored.filter(k => k.score >= 7.0).slice(0, 10);
    const seoQueue = scored.filter(k => k.score >= 5.0 && k.score < 7.0).slice(0, 40);
    log(`Build queue: ${buildQueue.length} | SEO queue: ${seoQueue.length}`);

    // 4. Cluster by niche
    const niche_slugs = await generateNicheSlugs(buildQueue);
    log(`Generated ${niche_slugs.length} niche slug variants`);

    // 5. Write results
    const result = {
      date: new Date().toISOString().split('T')[0],
      run_at: new Date().toISOString(),
      build_queue: buildQueue,
      seo_queue: seoQueue,
      niche_slugs: niche_slugs.slice(0, 100),
      total_discovered: discovered.length,
      total_scored: scored.length,
    };

    saveQueue(result);
    log(`✅ market-agent complete. ${buildQueue.length} products queued for build.`);
    console.log('\n📋 BUILD QUEUE:');
    buildQueue.forEach((k, i) => console.log(`  ${i + 1}. [${k.score}] ${k.keyword} (${k.source})`));

    return result;
  } catch (e) {
    log(`❌ market-agent error: ${e.message}`);
    throw e;
  }
}

// ─── Keyword discovery from all sources ──────────────────────────────────────
async function discoverKeywords() {
  const allKeywords = [];

  // Source 1: HackerNews Algolia
  log('Fetching HN pain signals...');
  const hnResult = await callAPI('/api/discover', { action: 'hn', limit: 15 }).catch(() => null);
  if (hnResult?.results) allKeywords.push(...hnResult.results);

  // Source 2: Reddit multi-subreddit
  log('Fetching Reddit signals...');
  const redditResult = await callAPI('/api/discover', { action: 'reddit_multi', query: 'i built tool automate', limit: 15 }).catch(() => null);
  if (redditResult?.results) allKeywords.push(...redditResult.results.map(r => ({ keyword: r.title, source: r.subreddit, score: r.pain_score })));

  // Source 3: Google autosuggest for high-value seed terms
  log('Fetching Google autosuggest...');
  const seeds = ['ai ', 'automated ', 'free ', 'generator ', 'builder '];
  for (const seed of seeds.slice(0, 3)) {
    const gsResult = await callAPI('/api/discover', { action: 'autosuggest', query: `${seed}tool` }).catch(() => null);
    if (gsResult?.suggestions) allKeywords.push(...gsResult.suggestions);
    await sleep(300);
  }

  // Source 4: ProductHunt trending
  log('Fetching ProductHunt trends...');
  const phResult = await callAPI('/api/discover', { action: 'ph_pain_scan', limit: 20 }).catch(() => null);
  if (phResult?.opportunities) {
    allKeywords.push(...phResult.opportunities.map(o => ({ keyword: o.keyword, source: 'producthunt', score: 5 })));
  }

  // Source 5: Niche cluster expansion
  log('Expanding niche clusters...');
  const niches = ['resume', 'youtube', 'seo', 'email', 'marketing'];
  for (const niche of niches) {
    const nicheResult = await callAPI('/api/discover', { action: 'niche_slugs', niche }).catch(() => null);
    if (nicheResult?.slugs) {
      allKeywords.push(...nicheResult.slugs.slice(0, 5).map(s => ({ keyword: s.replace(/-/g, ' '), source: `niche_${niche}`, score: 6 })));
    }
  }

  // Dedup by keyword
  const seen = new Set();
  return allKeywords.filter(k => {
    const key = (k.keyword || '').toLowerCase().trim().slice(0, 50);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Score keywords using the demand formula ──────────────────────────────────
async function scoreKeywords(keywords) {
  const scoredResult = await callAPI('/api/discover', {
    action: 'score_batch',
    keywords: keywords.map(k => k.keyword || k),
  }).catch(() => null);

  if (!scoredResult) {
    // Fallback: use source scores
    return keywords.map(k => ({ ...k, score: k.score || k.pain_score || 5 })).sort((a, b) => b.score - a.score);
  }

  // Merge API scores with source metadata
  const scoreMap = {};
  for (const s of scoredResult) scoreMap[s.keyword] = s.score;

  return keywords.map(k => ({
    ...k,
    score: scoreMap[k.keyword] || k.score || 5,
  })).sort((a, b) => b.score - a.score);
}

// ─── Generate niche slug variants for SEO pages ───────────────────────────────
async function generateNicheSlugs(topKeywords) {
  const slugs = [];
  for (const kw of topKeywords.slice(0, 5)) {
    // Guess niche from keyword
    const niche = guessNiche(kw.keyword);
    if (niche) {
      const result = await callAPI('/api/discover', { action: 'niche_slugs', niche }).catch(() => null);
      if (result?.slugs) slugs.push(...result.slugs.map(s => ({ slug: s, niche, base_keyword: kw.keyword })));
    }
  }
  return slugs;
}

function guessNiche(keyword = '') {
  const k = keyword.toLowerCase();
  if (/resume|cv/.test(k)) return 'resume';
  if (/youtube|video|channel/.test(k)) return 'youtube';
  if (/seo|ranking|search/.test(k)) return 'seo';
  if (/email|newsletter|subject/.test(k)) return 'email';
  if (/market|social|post|copy/.test(k)) return 'marketing';
  if (/image|photo|logo|design/.test(k)) return 'image';
  if (/pdf|document|file/.test(k)) return 'pdf';
  if (/code|script|sql|python/.test(k)) return 'coding';
  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function callAPI(path, body) {
  const r = await fetchWithRetry(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`API ${path} returned ${r.status}`);
  return r.json();
}

function saveQueue(result) {
  writeFileSync(QUEUE_FILE, JSON.stringify(result, null, 2));
  log(`Saved queue to ${QUEUE_FILE}`);
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

// ─── Run ──────────────────────────────────────────────────────────────────────
run().catch(async (e) => {
  await sendAlert('market-agent', e.message, { stack: (e.stack || '').slice(0, 500) });
  console.error(e);
  process.exit(1);
});
