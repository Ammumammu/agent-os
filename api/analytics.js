// api/analytics.js — Revenue + Ranking + Traffic + PostHog Analytics
// Merged from: analytics.js + posthog.js
// All reading endpoints consolidated here; writing still done in browser via PostHog write key

import { createJob, getJob, updateJob, listJobs, checkDuplicate } from '../lib/jobs.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { action, ...p } = req.method === 'GET' ? req.query : (req.body || {});

    switch (action) {
      // ── Revenue & Portfolio ───────────────────────────────────────────────
      case 'full_report': return res.json(await fullReport(p));
      case 'mrr': return res.json(await getMRR());
      case 'traffic': return res.json(await getTrafficDashboard(p));
      case 'rankings': return res.json(await getRankings(p));
      case 'portfolio': return res.json(await getPortfolioMetrics());
      case 'daily_digest': return res.json(await dailyDigest());
      case 'winner_check': return res.json(await checkWinners(p));
      case 'loser_check': return res.json(await checkLosers(p));

      // ── PostHog Analytics ─────────────────────────────────────────────────
      case 'funnel': return res.json(await getFunnel(p));
      case 'events': return res.json(await getEventCounts(p));
      case 'trends': return res.json(await getTrends(p));
      case 'dashboard': return res.json(await getDashboardMetrics(p));
      case 'persons': return res.json(await getPersons(p));
      case 'feature_flags': return res.json(await getFeatureFlags());

      case 'run': return res.json(await fullReport(p));

      // ── Build Job Management (merged from jobs.js) ────────────────────────
      case 'get_job':    return res.json(await getJob(p.jobId));
      case 'list_jobs':  return res.json(await listJobs(p.limit || 20));
      case 'create_job': return res.json(await createJob(p.jobId, p.slug, p.keyword));
      case 'update_job': return res.json(await updateJob(p.jobId, p.patch));
      case 'check_dup':  return res.json(await checkDuplicate(p.slug));

      default: return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// REVENUE & PORTFOLIO
// ════════════════════════════════════════════════════════════════════════════

const BASE_URL = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';

async function selfApi(path, body) {
  const r = await fetch(`${BASE_URL}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return r.json();
}

async function fullReport({ dateFrom = '-7d' }) {
  const [mrrData, trafficData, portfolioData] = await Promise.allSettled([getMRR(), getTrafficDashboard({ dateFrom }), getPortfolioMetrics()]);
  return {
    mrr: mrrData.status === 'fulfilled' ? mrrData.value : null,
    traffic: trafficData.status === 'fulfilled' ? trafficData.value : null,
    portfolio: portfolioData.status === 'fulfilled' ? portfolioData.value : null,
    period: dateFrom,
    generated_at: new Date().toISOString(),
  };
}

async function getMRR() {
  // Stripe MRR
  let stripeMRR = 0, stripeSubs = 0, stripeByProduct = {};
  try {
    const stripeData = await selfApi('/api/stripe', { action: 'getMRR' });
    stripeMRR = parseFloat(stripeData?.mrr_usd || 0);
    stripeSubs = stripeData?.active_subscriptions || 0;
    stripeByProduct = stripeData?.by_product || {};
  } catch (_) { }

  // Gumroad revenue (inline, no separate /api/gumroad call)
  let gumroadRevenue = 0;
  try {
    const TOKEN = process.env.GUMROAD_ACCESS_TOKEN;
    if (TOKEN) {
      const r = await fetch(`https://api.gumroad.com/v2/sales?access_token=${TOKEN}`);
      const data = await r.json();
      const sales = data.sales || [];
      gumroadRevenue = sales.reduce((s, sale) => s + (sale.price / 100), 0);
    }
  } catch (_) { }

  return {
    mrr_usd: stripeMRR,
    one_time_usd: gumroadRevenue,
    total_revenue_usd: stripeMRR + gumroadRevenue,
    active_subscriptions: stripeSubs,
    arr_usd: stripeMRR * 12,
    by_product: stripeByProduct,
    milestone: getMilestone(stripeMRR),
    fetched_at: new Date().toISOString(),
  };
}

async function getTrafficDashboard({ dateFrom = '-7d', product } = {}) {
  return getDashboardMetrics({ product, dateFrom });
}

async function getRankings({ domain, keywords } = {}) {
  if (!keywords || keywords.length === 0) return { note: 'No keywords provided' };
  return selfApi('/api/discover', { action: 'batch_check', keywords, domain });
}

async function getPortfolioMetrics() {
  const GITHUB_USERNAME = process.env.GITHUB_USERNAME;
  let portfolio = [];
  if (GITHUB_USERNAME) {
    try {
      const r = await fetch(`https://raw.githubusercontent.com/${GITHUB_USERNAME}/agent-os/main/public/portfolio.json`);
      if (r.ok) portfolio = await r.json();
    } catch (_) { }
  }
  const live = portfolio.filter(p => p.status === 'live');
  const totalMRR = live.reduce((s, p) => s + (p.mrr_usd || 0), 0);
  const winners = live.filter(p => p.mrr_usd >= 200 && p.conversion_rate >= 0.015);
  const losers = live.filter(p => p.visitors > 100 && p.mrr_usd === 0 && p.conversion_rate < 0.005);
  return {
    total_products: portfolio.length,
    live_products: live.length,
    total_mrr_usd: totalMRR,
    total_visitors: live.reduce((s, p) => s + (p.visitors || 0), 0),
    winners: winners.length,
    losers: losers.length,
    avg_mrr_per_product: live.length > 0 ? (totalMRR / live.length).toFixed(2) : 0,
    top_products: live.sort((a, b) => (b.mrr_usd || 0) - (a.mrr_usd || 0)).slice(0, 5),
    by_category: groupByCategory(live),
  };
}

async function dailyDigest() {
  const [mrr, traffic] = await Promise.allSettled([getMRR(), getDashboardMetrics({ dateFrom: '-1d' })]);
  const m = mrr.status === 'fulfilled' ? mrr.value : {};
  const t = traffic.status === 'fulfilled' ? traffic.value : {};
  return {
    date: new Date().toLocaleDateString(),
    mrr: m.mrr_usd || 0,
    arr: m.arr_usd || 0,
    active_subscriptions: m.active_subscriptions || 0,
    visitors_today: t.metrics?.opens || 0,
    new_conversions_today: t.metrics?.clicks || 0,
    top_product: m.by_product ? Object.entries(m.by_product).sort((a, b) => b[1].mrr - a[1].mrr)[0]?.[0] : null,
    milestone: m.milestone,
    generated_at: new Date().toISOString(),
  };
}

async function checkWinners({ product } = {}) {
  const ph = await getDashboardMetrics({ product, dateFrom: '-7d' });
  const isWinner = ph.rates?.activation_rate >= 40 && ph.rates?.paywall_ctr >= 15;
  return { product, is_winner: isWinner, metrics: ph.rates, action: isWinner ? 'double_marketing' : 'continue_building' };
}

async function checkLosers({ product } = {}) {
  const ph = await getEventCounts({ events: 'tool_opened', product, dateFrom: '-30d' });
  const lowTraffic = (ph.events?.tool_opened || 0) < 900;
  return { product, retire: lowTraffic, visitors_30d: ph.events?.tool_opened || 0, action: lowTraffic ? '301_redirect_to_winner' : 'give_more_time' };
}

// ════════════════════════════════════════════════════════════════════════════
// POSTHOG ANALYTICS (inlined from posthog.js)
// ════════════════════════════════════════════════════════════════════════════

function phBase() {
  const PROJECT = process.env.POSTHOG_PROJECT_ID || '1';
  return { base: `https://app.posthog.com/api/projects/${PROJECT}`, h: { Authorization: `Bearer ${process.env.POSTHOG_PERSONAL_API_KEY}` } };
}

async function phCount(event, product, dateFrom) {
  try {
    const { base, h } = phBase();
    const r = await fetch(`${base}/insights/trend/`, {
      method: 'POST',
      headers: { ...h, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        insight: 'TRENDS',
        events: [{ id: event, type: 'events' }],
        date_from: dateFrom || '-7d',
        ...(product ? { properties: [{ key: 'product', value: product, operator: 'exact' }] } : {}),
      }),
    });
    const data = await r.json();
    return (data.result?.[0]?.data || []).reduce((s, v) => s + v, 0);
  } catch (_) { return 0; }
}

async function getFunnel({ product, dateFrom, dateTo } = {}) {
  const { base, h } = phBase();
  const steps = ['tool_opened', 'tool_used', 'free_limit_hit', 'paywall_shown', 'payment_clicked'];
  const stepNames = ['Opened tool', 'Used tool', 'Hit free limit', 'Saw paywall', 'Clicked pay'];
  const r = await fetch(`${base}/insights/funnel/`, {
    method: 'POST',
    headers: { ...h, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      insight: 'FUNNELS',
      events: steps.map((id, i) => ({ id, name: stepNames[i], type: 'events' })),
      date_from: dateFrom || '-7d',
      date_to: dateTo || null,
      ...(product ? { properties: [{ key: 'product', value: product, operator: 'exact' }] } : {}),
    }),
  });
  const data = await r.json();
  const results = data.result || [];
  return {
    funnel: results.map((step, i) => ({
      name: stepNames[i] || step.name,
      count: step.count,
      conversion: i === 0 ? 100 : Math.round((step.count / results[0].count) * 100),
    })),
    product, period: { from: dateFrom || '-7d', to: dateTo },
  };
}

async function getEventCounts({ events, dateFrom, product } = {}) {
  const eventList = events ? (Array.isArray(events) ? events : [events])
    : ['tool_opened', 'tool_used', 'paywall_shown', 'payment_clicked', 'email_captured'];
  const results = {};
  for (const event of eventList) results[event] = await phCount(event, product, dateFrom);
  return { events: results, product, period: dateFrom || '-7d' };
}

async function getTrends({ event, dateFrom, interval } = {}) {
  const { base, h } = phBase();
  const r = await fetch(`${base}/insights/trend/`, {
    method: 'POST',
    headers: { ...h, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      insight: 'TRENDS',
      events: [{ id: event || 'tool_opened', type: 'events' }],
      date_from: dateFrom || '-30d',
      interval: interval || 'day',
    }),
  });
  const data = await r.json();
  return { event: event || 'tool_opened', labels: data.result?.[0]?.labels || [], data: data.result?.[0]?.data || [] };
}

async function getDashboardMetrics({ product, dateFrom } = {}) {
  const [opens, uses, paywalls, clicks, captures] = await Promise.all([
    phCount('tool_opened', product, dateFrom),
    phCount('tool_used', product, dateFrom),
    phCount('paywall_shown', product, dateFrom),
    phCount('payment_clicked', product, dateFrom),
    phCount('email_captured', product, dateFrom),
  ]);
  const activation_rate = opens > 0 ? Math.round((uses / opens) * 100) : 0;
  const paywall_hit_rate = uses > 0 ? Math.round((paywalls / uses) * 100) : 0;
  const paywall_ctr = paywalls > 0 ? Math.round((clicks / paywalls) * 100) : 0;
  const email_capture_rate = paywalls > 0 ? Math.round((captures / paywalls) * 100) : 0;
  return {
    product, period: dateFrom || '-7d',
    metrics: { opens, uses, paywalls, clicks, captures },
    rates: { activation_rate, paywall_hit_rate, paywall_ctr, email_capture_rate },
    winner: activation_rate >= 40 && paywall_ctr >= 15,
    needs_attention: activation_rate < 20 || paywall_ctr < 5,
    fetched_at: new Date().toISOString(),
  };
}

async function getPersons({ search, limit = 100 } = {}) {
  const { base, h } = phBase();
  const r = await fetch(`${base}/persons/?${search ? `search=${encodeURIComponent(search)}&` : ''}limit=${limit}`, { headers: h });
  return r.json();
}

async function getFeatureFlags() {
  const { base, h } = phBase();
  const r = await fetch(`${base}/feature_flags/`, { headers: h });
  return r.json();
}

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

function getMilestone(mrr) {
  if (mrr >= 150000) return '$150k MRR — $1.8M ARR 🏆';
  if (mrr >= 50000) return '$50k MRR — $600k ARR 🚀';
  if (mrr >= 10000) return '$10k MRR — $120k ARR 💪';
  if (mrr >= 5000) return '$5k MRR — $60k ARR 🎯';
  if (mrr >= 1000) return '$1k MRR — ramen profitable 🍜';
  if (mrr >= 500) return '$500 MRR — add affiliates now';
  if (mrr >= 100) return '$100 MRR — first revenue!';
  if (mrr > 0) return 'First dollars! Keep building.';
  return 'Pre-revenue — focus on activation rate';
}

function groupByCategory(products) {
  const groups = {};
  for (const p of products) {
    const cat = p.category || 'other';
    if (!groups[cat]) groups[cat] = { count: 0, mrr: 0 };
    groups[cat].count += 1;
    groups[cat].mrr += p.mrr_usd || 0;
  }
  return groups;
}

// ─── Build Job Management (merged from jobs.js) ────────────────────────────

// Job functions imported from ../lib/jobs.js
