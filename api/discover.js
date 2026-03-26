// api/discover.js — Market Discovery: Keywords + SERP + ProductHunt + Reddit
// Merged from: keywords.js + serp.js + ph.js + reddit.js
// Actions: autosuggest, hn, niche_slugs, score_batch, daily_discover, ph_trending, ph_search, ph_topics, ph_pain_scan
//          check_rank, batch_check, track_page, get_history, top_pages
//          reddit_search, reddit_hot, reddit_pain, reddit_multi

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  res.setHeader('Access-Control-Allow-Origin', '*');

  const params = req.method === 'GET' ? req.query : req.body;
  const { action, query, niche, limit = 20, ...p } = params;

  try {
    switch (action) {
      // ── Keyword Discovery ────────────────────────────────────────────────────
      case 'autosuggest':      return res.json(await googleAutosuggest(query));
      case 'hn':               return res.json(await hnKeywords(query, limit));
      case 'niche_slugs':      return res.json(generateNicheSlugs(niche));
      case 'score_batch':      return res.json(await scoreBatch(params.keywords));
      case 'daily_discover':   return res.json(await dailyDiscover());

      // ── ProductHunt ─────────────────────────────────────────────────────────
      case 'ph_trending':      return res.json(await phTrending(p));
      case 'ph_search':        return res.json(await phSearch({ query, limit }));
      case 'ph_topics':        return res.json(await phTopics());
      case 'ph_pain_scan':     return res.json(await phPainScan(p));

      // ── SERP Rankings ────────────────────────────────────────────────────────
      case 'check_rank':       return res.json(await checkRank(p.keyword, p.domain));
      case 'batch_check':      return res.json(await batchCheck(p.keywords, p.domain));
      case 'track_page':       return res.json(await trackPage(p.url, p.keywords));
      case 'get_history':      return res.json(await getRankHistory(p.keyword, p.domain));
      case 'top_pages':        return res.json(await getTopPages(p.domain));

      // ── Reddit CORS Proxy ────────────────────────────────────────────────────
      case 'reddit_search':    return res.json(await redditSearch(p.subreddit, query, p.sort, limit, p.t));
      case 'reddit_hot':       return res.json(await redditHot(p.subreddit, limit));
      case 'reddit_pain':      return res.json(await redditPain(p.subreddit, limit));
      case 'reddit_multi':     return res.json(await redditMulti(query, limit));
      // Legacy compat: plain 'search', 'hot', 'pain', 'multi' still work
      case 'search':           return res.json(await redditSearch(p.subreddit, query, p.sort, limit, p.t));
      case 'hot':              return res.json(await redditHot(p.subreddit, limit));
      case 'pain':             return res.json(await redditPain(p.subreddit, limit));
      case 'multi':            return res.json(await redditMulti(query, limit));

      default: return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// KEYWORD DISCOVERY
// ════════════════════════════════════════════════════════════════════════════

async function googleAutosuggest(query) {
  const url = `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(query)}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AgentOS/1.0)' } });
  const data = await r.json();
  const suggestions = (data[1] || []).map(s => ({ keyword: s, source: 'google_autosuggest', intent: classifyIntent(s) }));
  return { query, suggestions, count: suggestions.length };
}

async function hnKeywords(query, limit) {
  const painQueries = query
    ? [query]
    : ['i wish there was', 'does anyone know a tool', 'we manually', 'spent hours', 'no good solution'];
  const results = [];
  for (const q of painQueries) {
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=${limit}`;
    const r = await fetch(url);
    const data = await r.json();
    results.push(...(data.hits || []).map(h => ({
      keyword: extractKeyword(h.title),
      source: 'hackernews',
      title: h.title,
      points: h.points,
      comments: h.num_comments,
      url: `https://news.ycombinator.com/item?id=${h.objectID}`,
      pain_signal: q,
      intent: classifyIntent(h.title),
    })));
  }
  return { results: dedup(results, 'keyword'), count: results.length };
}

const NICHES = {
  resume: { baseSlug: 'resume-template-for', variants: ['developer','designer','marketer','student','manager','nurse','teacher','accountant','engineer','writer','sales','product-manager','data-scientist','ux-designer','freelancer'] },
  youtube: { baseSlug: 'youtube', variants: ['title-generator','description-writer','thumbnail-idea','tag-generator','script-writer','hook-generator','chapter-marker','seo-optimizer'] },
  seo: { baseSlug: 'seo-checker-for', variants: ['shopify','wordpress','etsy','amazon','youtube','instagram','tiktok','wix','squarespace','webflow','ghost','medium'] },
  email: { baseSlug: 'email-writer-for', variants: ['cold-outreach','follow-up','newsletter','subject-line','apology','sales','partnership','job-application','investor-pitch','client-proposal'] },
  marketing: { baseSlug: 'marketing-copy-for', variants: ['twitter','linkedin','instagram','facebook','tiktok','reddit','email','product-hunt','app-store','google-ads'] },
  image: { baseSlug: 'image-generator-for', variants: ['logo','banner','thumbnail','product-photo','social-post','infographic','og-image','avatar','icon','background'] },
  pdf: { baseSlug: 'pdf', variants: ['converter','compressor','merger','splitter','editor','to-word','to-excel','password-protector','watermarker','page-remover'] },
  coding: { baseSlug: 'code-helper-for', variants: ['python','javascript','typescript','sql','bash','rust','go','java','php','ruby','swift','kotlin','react','vue','nextjs'] },
};

function generateNicheSlugs(niche) {
  if (niche && NICHES[niche]) {
    const n = NICHES[niche];
    return { niche, slugs: n.variants.map(v => `${n.baseSlug}-${v}`), count: n.variants.length };
  }
  const all = {};
  for (const [key, n] of Object.entries(NICHES)) all[key] = n.variants.map(v => `${n.baseSlug}-${v}`);
  return { niches: all, total: Object.values(all).reduce((s, a) => s + a.length, 0) };
}

async function scoreBatch(keywords = []) {
  return keywords.map(kw => ({
    keyword: kw, score: estimateDemandScore(kw), intent: classifyIntent(kw),
    recommended_action: estimateDemandScore(kw) >= 7 ? 'build' : estimateDemandScore(kw) >= 5 ? 'seo_only' : 'skip',
  }));
}

async function dailyDiscover() {
  const painTerms = ['automate', 'generator', 'writer', 'builder', 'tracker', 'calculator', 'converter', 'checker'];
  const all = [];
  try { const hn = await hnKeywords(null, 10); all.push(...hn.results); } catch (_) {}
  for (const term of painTerms.slice(0, 4)) {
    try {
      const gs = await googleAutosuggest(`ai ${term}`);
      all.push(...gs.suggestions.map(s => ({ ...s, source: 'google_autosuggest' })));
    } catch (_) {}
  }
  const scored = all.map(k => ({ ...k, score: estimateDemandScore(k.keyword || k) }))
    .filter(k => k.score >= 5).sort((a, b) => b.score - a.score).slice(0, 50);
  return {
    discovered: all.length,
    scored: scored.length,
    buildQueue: scored.filter(k => k.score >= 7.0),
    seoQueue: scored.filter(k => k.score >= 5.0 && k.score < 7.0),
    timestamp: new Date().toISOString(),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// PRODUCTHUNT
// ════════════════════════════════════════════════════════════════════════════

async function phGql(query, variables = {}) {
  const r = await fetch('https://api.producthunt.com/v2/api/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.PH_TOKEN}` },
    body: JSON.stringify({ query, variables }),
  });
  return r.json();
}

async function phTrending({ limit = 20, daysAgo = 7 }) {
  const after = new Date(Date.now() - daysAgo * 86400000).toISOString();
  const query = `query GetTrending($first: Int!, $after: DateTime!) {
    posts(first: $first, order: VOTES, postedAfter: $after) {
      edges { node { id name tagline votesCount commentsCount thumbnail { url } topics { edges { node { name slug } } } url } }
    }
  }`;
  const data = await phGql(query, { first: Number(limit), after });
  const posts = (data?.data?.posts?.edges || []).map(e => ({
    id: e.node.id, name: e.node.name, tagline: e.node.tagline,
    votes: e.node.votesCount, comments: e.node.commentsCount,
    topics: e.node.topics.edges.map(t => t.node.name), url: e.node.url, thumbnail: e.node.thumbnail?.url,
    demand_signal: e.node.votesCount > 500 ? 'high' : e.node.votesCount > 100 ? 'medium' : 'low',
  }));
  return { posts, total: posts.length, period_days: daysAgo };
}

async function phSearch({ query, limit = 10 }) {
  const gql = `query SearchProducts($query: String!, $first: Int!) {
    posts(first: $first, topic: $query) { edges { node { id name tagline votesCount url } } }
  }`;
  const data = await phGql(gql, { query, first: Number(limit) });
  return { results: (data?.data?.posts?.edges || []).map(e => e.node), query };
}

async function phTopics() {
  const query = `query GetTopics { topics(first: 50, order: FOLLOWERS_COUNT) { edges { node { id name slug followersCount } } } }`;
  const data = await phGql(query);
  return { topics: (data?.data?.topics?.edges || []).map(e => e.node) };
}

async function phPainScan({ limit = 30 }) {
  const data = await phTrending({ limit, daysAgo: 14 });
  const opportunities = data.posts
    .filter(p => p.votes < 200)
    .map(p => ({ ...p, opportunity: `Build a better version of: ${p.name} — ${p.tagline}`, keyword: p.tagline.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim() }));
  return { opportunities, insight: `${opportunities.length} products under 200 votes — potential to outcompete`, fetched_at: new Date().toISOString() };
}

// ════════════════════════════════════════════════════════════════════════════
// SERP RANKINGS
// ════════════════════════════════════════════════════════════════════════════

async function checkRank(keyword, domain) {
  const SERP_KEY = process.env.SERP_API_KEY;
  const CSE_KEY = process.env.GOOGLE_CSE_API_KEY;
  const CSE_ID = process.env.GOOGLE_CSE_ID;
  if (SERP_KEY) return serpApiCheck(keyword, domain, SERP_KEY);
  if (CSE_KEY && CSE_ID) return cseCheck(keyword, domain, CSE_KEY, CSE_ID);
  return { keyword, domain, rank: null, method: 'none_configured', note: 'Set SERP_API_KEY or GOOGLE_CSE_API_KEY + GOOGLE_CSE_ID' };
}

async function serpApiCheck(keyword, domain, apiKey) {
  const r = await fetch(`https://serpapi.com/search.json?q=${encodeURIComponent(keyword)}&api_key=${apiKey}&num=100&gl=us&hl=en`);
  const data = await r.json();
  const results = data.organic_results || [];
  let rank = null, matchedUrl = null;
  for (let i = 0; i < results.length; i++) {
    if ((results[i].link || '').includes(domain)) { rank = i + 1; matchedUrl = results[i].link; break; }
  }
  return { keyword, domain, rank, matchedUrl, totalResults: results.length, method: 'serpapi', checkedAt: new Date().toISOString() };
}

async function cseCheck(keyword, domain, apiKey, cseId) {
  const r = await fetch(`https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(keyword)}&key=${apiKey}&cx=${cseId}&num=10`);
  const data = await r.json();
  const items = data.items || [];
  let rank = null, matchedUrl = null;
  for (let i = 0; i < items.length; i++) {
    if ((items[i].link || '').includes(domain)) { rank = i + 1; matchedUrl = items[i].link; break; }
  }
  return { keyword, domain, rank: rank ?? '>10', matchedUrl, method: 'google_cse', checkedAt: new Date().toISOString() };
}

async function batchCheck(keywords = [], domain) {
  const results = [];
  const chunks = chunkArray(keywords, 5);
  for (const chunk of chunks) {
    const chunkResults = await Promise.all(chunk.map(kw => checkRank(kw, domain).catch(e => ({ keyword: kw, domain, rank: null, error: e.message }))));
    results.push(...chunkResults);
    if (chunks.indexOf(chunk) < chunks.length - 1) await sleep(1000);
  }
  const ranked = results.filter(r => r.rank && r.rank <= 100).sort((a, b) => a.rank - b.rank);
  return { domain, total: results.length, ranked: ranked.length, top10: ranked.filter(r => r.rank <= 10).length, top3: ranked.filter(r => r.rank <= 3).length, results, checkedAt: new Date().toISOString() };
}

async function trackPage(url, keywords = []) {
  const domain = new URL(url).hostname;
  const results = await batchCheck(keywords, domain);
  return { url, domain, keywords, rankings: results.results, bestRank: results.results.reduce((b, r) => (r.rank && r.rank < b) ? r.rank : b, 999), inTop10: results.top10, checkedAt: new Date().toISOString() };
}

async function getRankHistory(keyword, domain) {
  const SB = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SB || !KEY) return { keyword, domain, history: [], note: 'Supabase not configured' };
  const r = await fetch(`${SB}/rest/v1/serp_rankings?keyword=eq.${encodeURIComponent(keyword)}&domain=eq.${encodeURIComponent(domain)}&order=checked_at.desc&limit=30`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Accept-Profile': 'public' } });
  return { keyword, domain, history: await r.json() };
}

async function getTopPages(domain) {
  const SB = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SB || !KEY) return { domain, pages: [], note: 'Supabase not configured' };
  const r = await fetch(`${SB}/rest/v1/serp_rankings?domain=eq.${encodeURIComponent(domain)}&rank=lte.10&order=rank.asc&limit=50`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Accept-Profile': 'public' } });
  const pages = await r.json();
  return { domain, pages, count: pages.length };
}

// ════════════════════════════════════════════════════════════════════════════
// REDDIT CORS PROXY
// ════════════════════════════════════════════════════════════════════════════

const UA = { 'User-Agent': 'AgentOS/1.0 (market research; contact via github)' };

async function redditSearch(subreddit = 'entrepreneur', query, sort = 'top', limit = 25, t = 'month') {
  const url = query
    ? `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(query)}&sort=${sort}&t=${t}&limit=${limit}&restrict_sr=1`
    : `https://www.reddit.com/r/${subreddit}/${sort}.json?limit=${limit}&t=${t}`;
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`Reddit returned ${r.status}`);
  return r.json();
}

async function redditHot(subreddit = 'entrepreneur', limit = 25) {
  const r = await fetch(`https://www.reddit.com/r/${subreddit}/hot.json?limit=${limit}`, { headers: UA });
  return r.json();
}

async function redditPain(subreddit = 'entrepreneur', limit = 25) {
  const painTerms = ['i wish there was', 'does anyone know a tool', 'we manually', 'spent hours', 'no good solution', 'would pay for', 'hate doing', 'frustrating'];
  const results = [];
  for (const term of painTerms.slice(0, 3)) {
    try {
      const data = await redditSearch(subreddit, term, 'top', limit, 'month');
      const posts = ((data.data || {}).children || []).map(p => ({
        ...p.data,
        pain_score: scorePainPost(p.data),
        matched_term: term,
      }));
      results.push(...posts.filter(p => p.pain_score > 0));
    } catch (_) {}
  }
  return { posts: results.sort((a, b) => b.pain_score - a.pain_score).slice(0, 20), subreddit, count: results.length };
}

async function redditMulti(query, limit = 10) {
  const subs = ['entrepreneur', 'SideProject', 'indiehackers', 'saas', 'startups'];
  const results = await Promise.allSettled(subs.map(sub => redditSearch(sub, query, 'top', limit, 'month')));
  const all = results.flatMap((r, i) => {
    if (r.status !== 'fulfilled') return [];
    return ((r.value.data || {}).children || []).map(p => ({ ...p.data, subreddit: subs[i] }));
  });
  return { results: all.sort((a, b) => b.ups - a.ups).slice(0, 30), query, subreddits: subs };
}

function scorePainPost(post) {
  const text = `${post.title} ${post.selftext}`.toLowerCase();
  let score = 0;
  const signals = ['i wish', 'would pay', 'spent hours', 'manually', 'frustrat', 'annoying', 'hate doing', 'no tool', 'looking for a way'];
  for (const s of signals) if (text.includes(s)) score += 2;
  score += Math.min(5, Math.floor((post.ups || 0) / 100));
  score += Math.min(3, Math.floor((post.num_comments || 0) / 20));
  return score;
}

// ════════════════════════════════════════════════════════════════════════════
// SHARED HELPERS
// ════════════════════════════════════════════════════════════════════════════

function classifyIntent(text = '') {
  const t = text.toLowerCase();
  if (/generat|creat|build|make|write/.test(t)) return 'generative_tool';
  if (/check|analyz|audit|review|scan/.test(t)) return 'analysis_tool';
  if (/convert|transform|export|import/.test(t)) return 'conversion_tool';
  if (/track|monitor|watch|alert/.test(t)) return 'tracking_tool';
  if (/calculat|estimat|pric/.test(t)) return 'calculator_tool';
  if (/template|example|sample/.test(t)) return 'template_page';
  if (/vs|alternative|compet|better than/.test(t)) return 'comparison_page';
  return 'informational';
}

function extractKeyword(title = '') {
  return title.replace(/^(Ask HN:|Show HN:|I built|We built|Launching|Introducing|)\s*/i, '').replace(/\s*[-–|].*$/, '').trim().toLowerCase().slice(0, 60);
}

function estimateDemandScore(keyword = '') {
  const k = keyword.toLowerCase();
  let score = 5.0;
  if (/ai|gpt|llm|claude|gemini/.test(k)) score += 1.0;
  if (/generat|automat|write|creat/.test(k)) score += 0.8;
  if (/resume|email|seo|youtube|invoice|proposal/.test(k)) score += 1.2;
  if (/free|cheap|fast|instant|quick/.test(k)) score += 0.5;
  if (/learn|tutorial|how to|guide/.test(k)) score -= 0.5;
  if (/reddit|hacker|news|blog/.test(k)) score -= 1.0;
  return Math.min(10, Math.max(1, Math.round(score * 10) / 10));
}

function dedup(arr, key) {
  const seen = new Set();
  return arr.filter(item => { const v = item[key]; if (seen.has(v)) return false; seen.add(v); return true; });
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
