// api/devto.js — Dev.to Article Publishing + Stats
// Dev.to API: confirmed working, free, ~50-500 visitors per article

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, ...p } = req.body;
  const KEY = process.env.DEVTO_API_KEY;
  const BASE = 'https://dev.to/api';
  const h = { 'Content-Type': 'application/json', 'api-key': KEY };

  const actions = {
    publishArticle: () => fetch(`${BASE}/articles`, {
      method: 'POST', headers: h,
      body: JSON.stringify({
        article: {
          title: p.title,
          body_markdown: p.body_markdown || p.content,
          published: p.published !== false,
          tags: p.tags || ['saas', 'tools', 'ai', 'productivity'],
          series: p.series || null,
          canonical_url: p.canonical_url || null,
          description: p.description || null,
          main_image: p.main_image || null,
        },
      }),
    }),

    updateArticle: () => fetch(`${BASE}/articles/${p.articleId}`, {
      method: 'PUT', headers: h,
      body: JSON.stringify({ article: { title: p.title, body_markdown: p.body_markdown, published: p.published !== false } }),
    }),

    getArticle: () => fetch(`${BASE}/articles/${p.articleId}`, { headers: h }),

    getMyArticles: () => fetch(`${BASE}/articles/me?per_page=100`, { headers: h }),

    getStats: async () => {
      const r = await fetch(`${BASE}/articles/me?per_page=100`, { headers: h });
      const articles = await r.json();
      const total_views = articles.reduce((s, a) => s + (a.page_views_count || 0), 0);
      const total_reactions = articles.reduce((s, a) => s + (a.public_reactions_count || 0), 0);
      const top = [...articles].sort((a, b) => (b.page_views_count || 0) - (a.page_views_count || 0)).slice(0, 5);
      return new Response(JSON.stringify({
        total_articles: articles.length,
        total_views,
        total_reactions,
        top_articles: top.map(a => ({ title: a.title, views: a.page_views_count, url: a.url })),
        fetched_at: new Date().toISOString(),
      }), { status: 200 });
    },
  };

  try {
    const actionFn = actions[action];
    if (!actionFn) return res.status(400).json({ error: `Unknown action: ${action}` });
    const r = await actionFn();
    if (!r || typeof r.json !== 'function') {
      const text = await r.text();
      return res.status(r.status).json(JSON.parse(text));
    }
    return res.json(await r.json());
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
