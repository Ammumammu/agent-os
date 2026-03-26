// api/gumroad.js — Gumroad Product + Revenue Operations
// Gumroad: 10% fee, built-in marketplace, no setup required

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, ...p } = req.body;
  const TOKEN = process.env.GUMROAD_ACCESS_TOKEN;
  if (!TOKEN) return res.status(200).json({ skipped: true, reason: 'GUMROAD_ACCESS_TOKEN not set' });
  const BASE = 'https://api.gumroad.com/v2';
  const h = { 'Content-Type': 'application/json' };

  const actions = {
    createProduct: async () => {
      const body = new URLSearchParams({
        access_token: TOKEN,
        name: p.name,
        description: p.description || p.tagline || '',
        price: String(Math.round((p.price_usd || 9) * 100)), // cents
        url: p.productUrl || '',
        published: 'true',
        ...(p.suggested_price ? { suggested_price: String(Math.round(p.suggested_price * 100)) } : {}),
      });
      return fetch(`${BASE}/products`, { method: 'POST', body });
    },

    updateProduct: async () => {
      const body = new URLSearchParams({
        access_token: TOKEN,
        ...(p.name ? { name: p.name } : {}),
        ...(p.description ? { description: p.description } : {}),
        ...(p.price_usd ? { price: String(Math.round(p.price_usd * 100)) } : {}),
        ...(p.published !== undefined ? { published: String(p.published) } : {}),
      });
      return fetch(`${BASE}/products/${p.productId}`, { method: 'PUT', body });
    },

    getProduct: () => fetch(`${BASE}/products/${p.productId}?access_token=${TOKEN}`),

    listProducts: () => fetch(`${BASE}/products?access_token=${TOKEN}`),

    getSales: async () => {
      const url = `${BASE}/sales?access_token=${TOKEN}&before=${p.before || ''}&after=${p.after || ''}&product_id=${p.productId || ''}`;
      const r = await fetch(url);
      const data = await r.json();
      const sales = data.sales || [];
      const total = sales.reduce((s, sale) => s + (sale.price / 100), 0);
      return new Response(JSON.stringify({
        sales,
        total_usd: total.toFixed(2),
        count: sales.length,
        period: { before: p.before, after: p.after },
      }), { status: 200 });
    },

    getRevenue: async () => {
      const r = await fetch(`${BASE}/sales?access_token=${TOKEN}`);
      const data = await r.json();
      const sales = data.sales || [];
      const byProduct = {};
      for (const sale of sales) {
        const pid = sale.product_id;
        if (!byProduct[pid]) byProduct[pid] = { count: 0, revenue_usd: 0, name: sale.product_name };
        byProduct[pid].count += 1;
        byProduct[pid].revenue_usd += sale.price / 100;
      }
      return new Response(JSON.stringify({
        total_usd: (sales.reduce((s, sale) => s + sale.price / 100, 0)).toFixed(2),
        total_sales: sales.length,
        by_product: byProduct,
        fetched_at: new Date().toISOString(),
      }), { status: 200 });
    },
  };

  try {
    const actionFn = actions[action];
    if (!actionFn) return res.status(400).json({ error: `Unknown action: ${action}` });
    const r = await actionFn();
    if (!r || typeof r.text !== 'function') return res.json(r); // already plain object

    const text = await r.text();
    const contentType = r.headers?.get?.('content-type') || '';

    // Gumroad returns HTML when auth fails — detect and surface clearly
    if (!contentType.includes('application/json') && text.trim().startsWith('<')) {
      return res.status(200).json({
        error: 'Gumroad returned HTML instead of JSON',
        hint: 'GUMROAD_ACCESS_TOKEN may be expired. Regenerate at app.gumroad.com/settings/advanced',
        status: r.status,
      });
    }

    try {
      return res.status(r.status).json(JSON.parse(text));
    } catch (_) {
      return res.status(200).json({ error: 'Gumroad response parse error', raw: text.slice(0, 200) });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
