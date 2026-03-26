// api/keywords.js — Keyword Discovery Engine
// Sources: Google autosuggest, HN Algolia, Reddit JSON, ProductHunt, Twitter trends
// All ToS-compliant. No scraping. Public APIs only.

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, query, niche, limit = 20 } = req.method === 'GET' ? req.query : req.body;

  try {
    switch (action) {
      case 'autosuggest':    return res.json(await googleAutosuggest(query));
      case 'hn':             return res.json(await hnKeywords(query, limit));
      case 'reddit':         return res.json(await redditKeywords(query, limit));
      case 'ph':             return res.json(await phKeywords(query));
      case 'niche_slugs':    return res.json(generateNicheSlugs(niche));
      case 'score_batch':    return res.json(await scoreBatch(req.body.keywords));
      case 'daily_discover': return res.json(await dailyDiscover());
      default: return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// ─── Google Autosuggest (public, no auth required) ──────────────────────────
async function googleAutosuggest(query) {
  const url = `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(query)}`;
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AgentOS/1.0)' }
  });
  const data = await r.json();
  const suggestions = (data[1] || []).map(s => ({
    keyword: s,
    source: 'google_autosuggest',
    intent: classifyIntent(s),
  }));
  return { query, suggestions, count: suggestions.length };
}

// ─── HackerNews Algolia (CORS: *, free, no auth) ─────────────────────────────
async function hnKeywords(query, limit) {
  const painQueries = query
    ? [query]
    : ['i wish there was', 'does anyone know a tool', 'we manually', 'spent hours', 'no good solution'];

  const results = [];
  for (const q of painQueries) {
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=${limit}`;
    const r = await fetch(url);
    const data = await r.json();
    const hits = (data.hits || []).map(h => ({
      keyword: extractKeyword(h.title),
      source: 'hackernews',
      title: h.title,
      points: h.points,
      comments: h.num_comments,
      url: `https://news.ycombinator.com/item?id=${h.objectID}`,
      pain_signal: q,
      intent: classifyIntent(h.title),
    }));
    results.push(...hits);
  }
  return { results: dedup(results, 'keyword'), count: results.length };
}

// ─── Reddit (via public JSON, no auth for read) ──────────────────────────────
async function redditKeywords(query, limit) {
  const subs = ['entrepreneur', 'SideProject', 'indiehackers', 'saas', 'webdev', 'startups'];
  const results = [];
  for (const sub of subs.slice(0, 3)) {
    try {
      const url = `https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(query || 'i built')}&sort=top&t=month&limit=${limit}&restrict_sr=1`;
      const r = await fetch(url, { headers: { 'User-Agent': 'AgentOS/1.0 (market research)' } });
      const data = await r.json();
      const posts = ((data.data || {}).children || []).map(p => ({
        keyword: extractKeyword(p.data.title),
        source: `reddit_${sub}`,
        title: p.data.title,
        upvotes: p.data.ups,
        comments: p.data.num_comments,
        url: `https://reddit.com${p.data.permalink}`,
        intent: classifyIntent(p.data.title),
      }));
      results.push(...posts);
    } catch (_) { /* skip failed subreddit */ }
  }
  return { results: dedup(results, 'keyword'), count: results.length };
}

// ─── ProductHunt (server-side, requires PH_TOKEN) ────────────────────────────
async function phKeywords(query) {
  const TOKEN = process.env.PH_TOKEN;
  const gql = `{
    posts(first: 20, order: VOTES, postedAfter: "${sevenDaysAgo()}") {
      edges { node { name tagline votesCount commentsCount topics { edges { node { name } } } } }
    }
  }`;
  const r = await fetch('https://api.producthunt.com/v2/api/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query: gql }),
  });
  const data = await r.json();
  const products = ((data.data || {}).posts?.edges || []).map(e => ({
    keyword: e.node.tagline,
    source: 'producthunt',
    name: e.node.name,
    votes: e.node.votesCount,
    topics: e.node.topics.edges.map(t => t.node.name),
    intent: 'product_validation',
  }));
  return { results: products, count: products.length };
}

// ─── Niche Slug Generator (programmatic SEO pages) ───────────────────────────
const NICHES = {
  resume: {
    baseSlug: 'resume-template-for',
    variants: ['developer','designer','marketer','student','manager','nurse','teacher','accountant','engineer','writer','sales','product-manager','data-scientist','ux-designer','freelancer'],
  },
  youtube: {
    baseSlug: 'youtube',
    variants: ['title-generator','description-writer','thumbnail-idea','tag-generator','script-writer','hook-generator','chapter-marker','seo-optimizer'],
  },
  seo: {
    baseSlug: 'seo-checker-for',
    variants: ['shopify','wordpress','etsy','amazon','youtube','instagram','tiktok','wix','squarespace','webflow','ghost','medium'],
  },
  email: {
    baseSlug: 'email-writer-for',
    variants: ['cold-outreach','follow-up','newsletter','subject-line','apology','sales','partnership','job-application','investor-pitch','client-proposal'],
  },
  marketing: {
    baseSlug: 'marketing-copy-for',
    variants: ['twitter','linkedin','instagram','facebook','tiktok','reddit','email','product-hunt','app-store','google-ads'],
  },
  image: {
    baseSlug: 'image-generator-for',
    variants: ['logo','banner','thumbnail','product-photo','social-post','infographic','og-image','avatar','icon','background'],
  },
  pdf: {
    baseSlug: 'pdf',
    variants: ['converter','compressor','merger','splitter','editor','to-word','to-excel','password-protector','watermarker','page-remover'],
  },
  coding: {
    baseSlug: 'code-helper-for',
    variants: ['python','javascript','typescript','sql','bash','rust','go','java','php','ruby','swift','kotlin','react','vue','nextjs'],
  },
};

function generateNicheSlugs(niche) {
  if (niche && NICHES[niche]) {
    const n = NICHES[niche];
    return {
      niche,
      slugs: n.variants.map(v => `${n.baseSlug}-${v}`),
      count: n.variants.length,
    };
  }
  // Return all niches
  const all = {};
  for (const [key, n] of Object.entries(NICHES)) {
    all[key] = n.variants.map(v => `${n.baseSlug}-${v}`);
  }
  const total = Object.values(all).reduce((s, a) => s + a.length, 0);
  return { niches: all, total };
}

// ─── Score a batch of keywords ───────────────────────────────────────────────
async function scoreBatch(keywords) {
  return keywords.map(kw => ({
    keyword: kw,
    score: estimateDemandScore(kw),
    intent: classifyIntent(kw),
    recommended_action: estimateDemandScore(kw) >= 7 ? 'build' : estimateDemandScore(kw) >= 5 ? 'seo_only' : 'skip',
  }));
}

// ─── Daily Discovery (orchestrates all sources) ──────────────────────────────
async function dailyDiscover() {
  const painTerms = ['automate', 'generator', 'writer', 'builder', 'tracker', 'calculator', 'converter', 'checker'];
  const all = [];

  // HN pain signals
  try {
    const hn = await hnKeywords(null, 10);
    all.push(...hn.results);
  } catch (_) {}

  // Google autosuggest for each pain term
  for (const term of painTerms.slice(0, 4)) {
    try {
      const gs = await googleAutosuggest(`ai ${term}`);
      all.push(...gs.suggestions.map(s => ({ ...s, source: 'google_autosuggest' })));
    } catch (_) {}
  }

  // Score and rank
  const scored = all
    .map(k => ({ ...k, score: estimateDemandScore(k.keyword || k) }))
    .filter(k => k.score >= 5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 50);

  const buildQueue = scored.filter(k => k.score >= 7.0);
  const seoQueue = scored.filter(k => k.score >= 5.0 && k.score < 7.0);

  return {
    discovered: all.length,
    scored: scored.length,
    buildQueue,
    seoQueue,
    timestamp: new Date().toISOString(),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
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
  // Strip common HN/Reddit prefixes, extract core keyword
  return title
    .replace(/^(Ask HN:|Show HN:|I built|We built|Launching|Introducing|)\s*/i, '')
    .replace(/\s*[-–|].*$/, '')
    .trim()
    .toLowerCase()
    .slice(0, 60);
}

function estimateDemandScore(keyword = '') {
  const k = keyword.toLowerCase();
  let score = 5.0;
  // Signals that raise score
  if (/ai|gpt|llm|claude|gemini/.test(k)) score += 1.0;
  if (/generat|automat|write|creat/.test(k)) score += 0.8;
  if (/resume|email|seo|youtube|invoice|proposal/.test(k)) score += 1.2;
  if (/free|cheap|fast|instant|quick/.test(k)) score += 0.5;
  // Signals that lower score
  if (/learn|tutorial|how to|guide/.test(k)) score -= 0.5;
  if (/reddit|hacker|news|blog/.test(k)) score -= 1.0;
  return Math.min(10, Math.max(1, Math.round(score * 10) / 10));
}

function dedup(arr, key) {
  const seen = new Set();
  return arr.filter(item => {
    const val = item[key];
    if (seen.has(val)) return false;
    seen.add(val);
    return true;
  });
}

function sevenDaysAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString();
}
