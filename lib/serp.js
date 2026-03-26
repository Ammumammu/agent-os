// api/serp.js — SERP Rank Tracking
// Uses: SerpAPI (free 100 searches/mo) or Google Custom Search API (free 100/day)
// Tracks keyword rankings for all deployed pages

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, ...p } = req.method === 'GET' ? req.query : req.body;

  try {
    switch (action) {
      case 'check_rank':     return res.json(await checkRank(p.keyword, p.domain));
      case 'batch_check':    return res.json(await batchCheck(p.keywords, p.domain));
      case 'track_page':     return res.json(await trackPage(p.url, p.keywords));
      case 'get_history':    return res.json(await getRankHistory(p.keyword, p.domain));
      case 'top_pages':      return res.json(await getTopPages(p.domain));
      default: return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// ─── Check rank for a single keyword ─────────────────────────────────────────
async function checkRank(keyword, domain) {
  const SERP_KEY = process.env.SERP_API_KEY;
  const CSE_KEY = process.env.GOOGLE_CSE_API_KEY;
  const CSE_ID = process.env.GOOGLE_CSE_ID;

  // Prefer SerpAPI if available
  if (SERP_KEY) {
    return serpApiCheck(keyword, domain, SERP_KEY);
  }
  // Fall back to Google Custom Search
  if (CSE_KEY && CSE_ID) {
    return cseCheck(keyword, domain, CSE_KEY, CSE_ID);
  }
  // Free fallback: estimate based on domain authority signals
  return { keyword, domain, rank: null, method: 'none_configured', note: 'Set SERP_API_KEY or GOOGLE_CSE_API_KEY + GOOGLE_CSE_ID' };
}

async function serpApiCheck(keyword, domain, apiKey) {
  const url = `https://serpapi.com/search.json?q=${encodeURIComponent(keyword)}&api_key=${apiKey}&num=100&gl=us&hl=en`;
  const r = await fetch(url);
  const data = await r.json();

  const results = data.organic_results || [];
  let rank = null;
  let matchedUrl = null;

  for (let i = 0; i < results.length; i++) {
    if ((results[i].link || '').includes(domain)) {
      rank = i + 1;
      matchedUrl = results[i].link;
      break;
    }
  }

  return {
    keyword,
    domain,
    rank,
    matchedUrl,
    totalResults: results.length,
    method: 'serpapi',
    checkedAt: new Date().toISOString(),
  };
}

async function cseCheck(keyword, domain, apiKey, cseId) {
  // Google CSE: search for keyword, check if domain appears in results
  const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(keyword)}&key=${apiKey}&cx=${cseId}&num=10`;
  const r = await fetch(url);
  const data = await r.json();

  const items = data.items || [];
  let rank = null;
  let matchedUrl = null;

  for (let i = 0; i < items.length; i++) {
    if ((items[i].link || '').includes(domain)) {
      rank = i + 1;
      matchedUrl = items[i].link;
      break;
    }
  }

  return {
    keyword,
    domain,
    rank: rank ? rank : '>10',
    matchedUrl,
    method: 'google_cse',
    checkedAt: new Date().toISOString(),
  };
}

// ─── Batch check multiple keywords ───────────────────────────────────────────
async function batchCheck(keywords = [], domain) {
  const results = [];
  // Rate limit: check 5 at a time with delay
  const chunks = chunkArray(keywords, 5);
  for (const chunk of chunks) {
    const chunkResults = await Promise.all(chunk.map(kw => checkRank(kw, domain).catch(e => ({
      keyword: kw, domain, rank: null, error: e.message
    }))));
    results.push(...chunkResults);
    if (chunks.indexOf(chunk) < chunks.length - 1) await sleep(1000);
  }

  const ranked = results.filter(r => r.rank && r.rank <= 100).sort((a, b) => a.rank - b.rank);
  const top10 = ranked.filter(r => r.rank <= 10);
  const top3 = ranked.filter(r => r.rank <= 3);

  return {
    domain,
    total: results.length,
    ranked: ranked.length,
    top10: top10.length,
    top3: top3.length,
    results,
    checkedAt: new Date().toISOString(),
  };
}

// ─── Track a specific page for its target keywords ───────────────────────────
async function trackPage(url, keywords = []) {
  const domain = new URL(url).hostname;
  const results = await batchCheck(keywords, domain);
  return {
    url,
    domain,
    keywords,
    rankings: results.results,
    bestRank: results.results.reduce((b, r) => (r.rank && r.rank < b) ? r.rank : b, 999),
    inTop10: results.top10,
    checkedAt: new Date().toISOString(),
  };
}

// ─── Get rank history from Supabase (if configured) ──────────────────────────
async function getRankHistory(keyword, domain) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { keyword, domain, history: [], note: 'Supabase not configured — history unavailable' };
  }

  const url = `${SUPABASE_URL}/rest/v1/serp_rankings?keyword=eq.${encodeURIComponent(keyword)}&domain=eq.${encodeURIComponent(domain)}&order=checked_at.desc&limit=30`;
  const r = await fetch(url, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
  });
  const history = await r.json();
  return { keyword, domain, history };
}

// ─── Get all top-ranking pages for a domain ───────────────────────────────────
async function getTopPages(domain) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { domain, pages: [], note: 'Supabase not configured' };
  }

  const url = `${SUPABASE_URL}/rest/v1/serp_rankings?domain=eq.${encodeURIComponent(domain)}&rank=lte.10&order=rank.asc&limit=50`;
  const r = await fetch(url, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
  });
  const pages = await r.json();
  return { domain, pages, count: pages.length };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
