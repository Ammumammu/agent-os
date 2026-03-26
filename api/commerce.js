// api/commerce.js — Commerce Extensions: Gumroad + Chrome Web Store
// Merged from: gumroad.js + chrome.js

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, ...p } = req.body;

  try {
    switch (action) {
      // ── Gumroad ─────────────────────────────────────────────────────────────
      case 'createProduct':   return res.json(await gumroadAction('createProduct', p));
      case 'updateProduct':   return res.json(await gumroadAction('updateProduct', p));
      case 'getProduct':      return res.json(await gumroadAction('getProduct', p));
      case 'listProducts':    return res.json(await gumroadAction('listProducts', p));
      case 'getSales':        return res.json(await gumroadAction('getSales', p));
      case 'getRevenue':      return res.json(await gumroadAction('getRevenue', p));

      // ── Chrome Web Store ─────────────────────────────────────────────────────
      case 'upload':          return res.json(await uploadExtension(p));
      case 'publish':         return res.json(await publishExtension(p));
      case 'getToken':        return res.json(await refreshChromeToken());
      case 'getStatus':       return res.json(await getChromeStatus(p.extensionId));

      default: return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// GUMROAD
// ════════════════════════════════════════════════════════════════════════════

async function gumroadAction(action, p) {
  const TOKEN = process.env.GUMROAD_ACCESS_TOKEN;
  if (!TOKEN) return { skipped: true, reason: 'GUMROAD_ACCESS_TOKEN not set' };
  const BASE = 'https://api.gumroad.com/v2';

  const actions = {
    createProduct: async () => {
      const body = new URLSearchParams({
        access_token: TOKEN,
        name: p.name,
        description: p.description || p.tagline || '',
        price: String(Math.round((p.price_usd || 9) * 100)),
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
      return { sales, total_usd: sales.reduce((s, sale) => s + (sale.price / 100), 0).toFixed(2), count: sales.length };
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
      return { total_usd: sales.reduce((s, sale) => s + sale.price / 100, 0).toFixed(2), total_sales: sales.length, by_product: byProduct, fetched_at: new Date().toISOString() };
    },
  };

  const fn = actions[action];
  if (!fn) throw new Error(`Unknown gumroad action: ${action}`);
  const r = await fn();
  if (!r || typeof r.text !== 'function') return r; // already plain object (getSales/getRevenue)

  const text = await r.text();
  const contentType = r.headers?.get?.('content-type') || '';

  // Gumroad returns HTML when auth fails or endpoint is wrong — detect and surface clearly
  if (!contentType.includes('application/json') && text.trim().startsWith('<')) {
    return {
      error: 'Gumroad returned HTML instead of JSON',
      hint: 'Check GUMROAD_ACCESS_TOKEN — it may be expired or invalid. Regenerate at app.gumroad.com/settings/advanced',
      status: r.status,
    };
  }

  try {
    return JSON.parse(text);
  } catch (_) {
    return { error: 'Gumroad response parse error', raw: text.slice(0, 200), status: r.status };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CHROME WEB STORE
// ════════════════════════════════════════════════════════════════════════════

async function refreshChromeToken() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.CHROME_CLIENT_ID,
      client_secret: process.env.CHROME_CLIENT_SECRET,
      refresh_token: process.env.CHROME_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await r.json();
  return { access_token: data.access_token, expires_in: data.expires_in };
}

async function uploadExtension({ extensionId, zipBase64 }) {
  const { access_token } = await refreshChromeToken();
  const publisherId = process.env.CHROME_PUBLISHER_ID;
  const zipBuffer = Buffer.from(zipBase64, 'base64');
  const r = await fetch(`https://chromewebstore.googleapis.com/v2/publishers/${publisherId}/items/${extensionId}:uploadZip`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/zip', 'Content-Length': String(zipBuffer.length) },
    body: zipBuffer,
  });
  return r.json();
}

async function publishExtension({ extensionId, target = 'default' }) {
  const { access_token } = await refreshChromeToken();
  const publisherId = process.env.CHROME_PUBLISHER_ID;
  const r = await fetch(`https://chromewebstore.googleapis.com/v2/publishers/${publisherId}/items/${extensionId}:publish?publishTarget=${target}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${access_token}`, 'Content-Length': '0' },
  });
  return r.json();
}

async function getChromeStatus(extensionId) {
  const { access_token } = await refreshChromeToken();
  const publisherId = process.env.CHROME_PUBLISHER_ID;
  const r = await fetch(`https://chromewebstore.googleapis.com/v2/publishers/${publisherId}/items/${extensionId}`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  return r.json();
}
