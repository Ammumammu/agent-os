// api/ph.js — ProductHunt Read + Trend Discovery
// Uses PH GraphQL API (free read access with token)

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, ...p } = req.method === 'GET' ? req.query : req.body;

  try {
    switch (action) {
      case 'trending':   return res.json(await getTrending(p));
      case 'search':     return res.json(await searchProducts(p));
      case 'topics':     return res.json(await getTopics());
      case 'pain_scan':  return res.json(await scanForPain(p));
      default: return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

async function phGql(query, variables = {}) {
  const r = await fetch('https://api.producthunt.com/v2/api/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.PH_TOKEN}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  return r.json();
}

async function getTrending({ limit = 20, daysAgo = 7 }) {
  const after = new Date(Date.now() - daysAgo * 86400000).toISOString();
  const query = `
    query GetTrending($first: Int!, $after: DateTime!) {
      posts(first: $first, order: VOTES, postedAfter: $after) {
        edges {
          node {
            id name tagline votesCount commentsCount
            thumbnail { url }
            topics { edges { node { name slug } } }
            url
          }
        }
      }
    }`;

  const data = await phGql(query, { first: Number(limit), after });
  const posts = (data?.data?.posts?.edges || []).map(e => ({
    id: e.node.id,
    name: e.node.name,
    tagline: e.node.tagline,
    votes: e.node.votesCount,
    comments: e.node.commentsCount,
    topics: e.node.topics.edges.map(t => t.node.name),
    url: e.node.url,
    thumbnail: e.node.thumbnail?.url,
    demand_signal: e.node.votesCount > 500 ? 'high' : e.node.votesCount > 100 ? 'medium' : 'low',
  }));

  return { posts, total: posts.length, period_days: daysAgo };
}

async function searchProducts({ query, limit = 10 }) {
  const gql = `
    query SearchProducts($query: String!, $first: Int!) {
      posts(first: $first, topic: $query) {
        edges {
          node { id name tagline votesCount url }
        }
      }
    }`;

  const data = await phGql(gql, { query, first: Number(limit) });
  return { results: (data?.data?.posts?.edges || []).map(e => e.node), query };
}

async function getTopics() {
  const query = `
    query GetTopics {
      topics(first: 50, order: FOLLOWERS_COUNT) {
        edges { node { id name slug followersCount } }
      }
    }`;
  const data = await phGql(query);
  return { topics: (data?.data?.topics?.edges || []).map(e => e.node) };
}

async function scanForPain({ limit = 30 }) {
  // Get recent launches and look at comments for pain signals
  const data = await getTrending({ limit, daysAgo: 14 });
  const opportunities = data.posts
    .filter(p => p.votes < 200) // not already massive — opportunity exists
    .map(p => ({
      ...p,
      opportunity: `Build a better version of: ${p.name} — ${p.tagline}`,
      keyword: p.tagline.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim(),
    }));

  return {
    opportunities,
    insight: `${opportunities.length} products under 200 votes — potential to outcompete`,
    fetched_at: new Date().toISOString(),
  };
}
