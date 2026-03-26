// api/reddit.js — Reddit CORS Proxy + Pain Signal Parser
// Reddit public JSON works but inconsistent on strict-mode browsers → proxy here

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).end();
  }

  const { subreddit, query, sort = 'top', limit = 25, t = 'month', action } = req.method === 'GET' ? req.query : req.body;

  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    switch (action || 'search') {
      case 'search':   return res.json(await searchSubreddit(subreddit, query, sort, limit, t));
      case 'hot':      return res.json(await getHot(subreddit, limit));
      case 'pain':     return res.json(await scanForPain(subreddit, query, limit));
      case 'multi':    return res.json(await multiSubredditSearch(query, limit));
      default:         return res.json(await searchSubreddit(subreddit, query, sort, limit, t));
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

async function searchSubreddit(subreddit = 'entrepreneur', query, sort, limit, t) {
  const url = query
    ? `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(query)}&sort=${sort}&t=${t}&limit=${limit}&restrict_sr=1`
    : `https://www.reddit.com/r/${subreddit}/${sort}.json?limit=${limit}&t=${t}`;

  const r = await fetch(url, { headers: { 'User-Agent': 'AgentOS/1.0 (market research; contact via github)' } });
  if (!r.ok) throw new Error(`Reddit returned ${r.status}`);
  return r.json();
}

async function getHot(subreddit, limit) {
  const r = await fetch(`https://www.reddit.com/r/${subreddit}/hot.json?limit=${limit}`, {
    headers: { 'User-Agent': 'AgentOS/1.0' }
  });
  return r.json();
}

// Scan subreddit for pain signals — returns scored posts
async function scanForPain(subreddit, baseQuery, limit) {
  const painTerms = [
    'i wish there was', 'does anyone know a tool',
    'we manually', 'spent hours', 'no good solution',
    'would pay for', 'hate doing', 'frustrating',
  ];

  const allPosts = [];
  const queries = baseQuery ? [baseQuery, ...painTerms.slice(0, 2)] : painTerms.slice(0, 4);

  for (const q of queries) {
    try {
      const data = await searchSubreddit(subreddit, q, 'top', limit, 'month');
      const posts = (data?.data?.children || []).map(p => ({
        title: p.data.title,
        text: p.data.selftext?.slice(0, 300),
        upvotes: p.data.ups,
        comments: p.data.num_comments,
        url: `https://reddit.com${p.data.permalink}`,
        subreddit: p.data.subreddit,
        pain_signal: q,
        pain_score: scorePainPost(p.data),
      }));
      allPosts.push(...posts);
    } catch (_) {}
  }

  const deduped = dedup(allPosts, 'url');
  return {
    subreddit,
    total: deduped.length,
    top_pain: deduped.sort((a, b) => b.pain_score - a.pain_score).slice(0, 20),
  };
}

// Search multiple subreddits at once
async function multiSubredditSearch(query, limit) {
  const subs = ['entrepreneur', 'SideProject', 'indiehackers', 'saas', 'webdev', 'startups', 'freelance', 'smallbusiness'];
  const results = [];

  for (const sub of subs.slice(0, 5)) {
    try {
      const data = await searchSubreddit(sub, query, 'top', Math.min(limit, 10), 'month');
      const posts = (data?.data?.children || []).map(p => ({
        title: p.data.title,
        upvotes: p.data.ups,
        comments: p.data.num_comments,
        url: `https://reddit.com${p.data.permalink}`,
        subreddit: sub,
        pain_score: scorePainPost(p.data),
      }));
      results.push(...posts);
    } catch (_) {}
  }

  return {
    query,
    total: results.length,
    results: results.sort((a, b) => b.pain_score - a.pain_score),
  };
}

function scorePainPost(post) {
  let score = 0;
  const text = `${post.title} ${post.selftext || ''}`.toLowerCase();
  // Pain signals
  if (/i wish|if only|would be great if/.test(text)) score += 3;
  if (/manually|by hand|copy.paste|spreadsheet/.test(text)) score += 2;
  if (/hours|days|weeks|pain|frustrat|annoying/.test(text)) score += 2;
  if (/would pay|looking for|anyone know/.test(text)) score += 3;
  if (/no tool|nothing works|hate this|tired of/.test(text)) score += 3;
  // Engagement signals
  if (post.ups > 100) score += 2;
  if (post.ups > 500) score += 2;
  if (post.num_comments > 20) score += 1;
  if (post.num_comments > 100) score += 2;
  return score;
}

function dedup(arr, key) {
  const seen = new Set();
  return arr.filter(item => {
    if (seen.has(item[key])) return false;
    seen.add(item[key]);
    return true;
  });
}
