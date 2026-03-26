// api/stripe.js — Stripe Payment Operations
// Actions: createProduct, createPrice, createPaymentLink, getRevenue, getSubscriptions,
//          getMRR, getCustomers, createPortalLink

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, ...p } = req.body;
  const KEY = process.env.STRIPE_SECRET_KEY;
  const sh = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' };
  const BASE = 'https://api.stripe.com/v1';
  const qs = (obj) => new URLSearchParams(flattenForStripe(obj)).toString();

  const actions = {
    createProduct: () => fetch(`${BASE}/products`, {
      method: 'POST', headers: sh,
      body: qs({ name: p.name, description: p.description || '', 'metadata[slug]': p.slug || '' }),
    }),

    createPrice: () => fetch(`${BASE}/prices`, {
      method: 'POST', headers: sh,
      body: qs({
        product: p.productId,
        unit_amount: String(p.amountCents),
        currency: p.currency || 'usd',
        ...(p.interval ? { 'recurring[interval]': p.interval } : {}),
        'metadata[tier]': p.tier || 'pro',
      }),
    }),

    createPaymentLink: () => fetch(`${BASE}/payment_links`, {
      method: 'POST', headers: sh,
      body: qs({
        'line_items[0][price]': p.priceId,
        'line_items[0][quantity]': '1',
        'after_completion[type]': 'redirect',
        'after_completion[redirect][url]': p.successUrl || 'https://example.com/success',
      }),
    }),

    getRevenue: () => fetch(`${BASE}/charges?limit=100&expand[]=data.invoice`, { headers: sh }),

    getSubscriptions: () => fetch(`${BASE}/subscriptions?limit=100&status=active`, { headers: sh }),

    getMRR: async () => {
      const r = await fetch(`${BASE}/subscriptions?limit=100&status=active`, { headers: sh });
      const data = await r.json();
      const subs = data.data || [];
      const mrr = subs.reduce((sum, sub) => {
        const amount = sub.items?.data?.[0]?.price?.unit_amount || 0;
        const interval = sub.items?.data?.[0]?.price?.recurring?.interval;
        const monthly = interval === 'year' ? amount / 12 : amount;
        return sum + monthly;
      }, 0);
      const byProduct = {};
      for (const sub of subs) {
        const slug = sub.items?.data?.[0]?.price?.metadata?.slug || 'unknown';
        if (!byProduct[slug]) byProduct[slug] = { count: 0, mrr: 0 };
        byProduct[slug].count += 1;
        const amount = sub.items?.data?.[0]?.price?.unit_amount || 0;
        byProduct[slug].mrr += amount;
      }
      return new Response(JSON.stringify({
        mrr_cents: mrr,
        mrr_usd: (mrr / 100).toFixed(2),
        active_subscriptions: subs.length,
        by_product: byProduct,
        fetched_at: new Date().toISOString(),
      }), { status: 200 });
    },

    getCustomers: () => fetch(`${BASE}/customers?limit=100`, { headers: sh }),

    createPortalLink: () => fetch(`${BASE}/billing_portal/sessions`, {
      method: 'POST', headers: sh,
      body: qs({ customer: p.customerId, return_url: p.returnUrl }),
    }),

    // Full product + price + payment link in one call (used by builder-agent)
    // Dedup: searches for existing Stripe product by metadata[slug] before creating.
    // Safe to call multiple times — returns existing product if already created today.
    createFull: async () => {
      // ── Dedup: check if product with this slug already exists in Stripe ──
      let product = null;
      if (p.slug) {
        const searchRes = await fetch(`${BASE}/products/search?query=${encodeURIComponent(`metadata["slug"]:"${p.slug}"`)}`, { headers: sh });
        const searchData = await searchRes.json();
        const existing = searchData?.data?.find(pr => pr.active && pr.metadata?.slug === p.slug);
        if (existing) {
          console.log(`[stripe] createFull: reusing existing product for slug "${p.slug}" (id: ${existing.id})`);
          product = existing;

          // Find existing active price for this product
          const pricesRes = await fetch(`${BASE}/prices?product=${existing.id}&active=true&limit=5`, { headers: sh });
          const pricesData = await pricesRes.json();
          const existingPrice = pricesData?.data?.find(pr => pr.recurring?.interval === 'month');

          if (existingPrice) {
            // Find existing payment link for this price
            const linksRes = await fetch(`${BASE}/payment_links?active=true&limit=20`, { headers: sh });
            const linksData = await linksRes.json();
            const existingLink = linksData?.data?.find(l => l.line_items?.data?.[0]?.price?.id === existingPrice.id);
            if (existingLink) {
              return new Response(JSON.stringify({ product, price: existingPrice, link: existingLink, payment_url: existingLink.url, reused: true }), { status: 200 });
            }
            // Recreate payment link (links are cheap to recreate)
            const newLink = await (await fetch(`${BASE}/payment_links`, {
              method: 'POST', headers: sh,
              body: qs({ 'line_items[0][price]': existingPrice.id, 'line_items[0][quantity]': '1', 'after_completion[type]': 'redirect', 'after_completion[redirect][url]': p.successUrl || `https://${p.slug}.vercel.app/success` }),
            })).json();
            return new Response(JSON.stringify({ product, price: existingPrice, link: newLink, payment_url: newLink.url, reused: true }), { status: 200 });
          }
        }
      }

      // ── Create new product (no duplicate found) ───────────────────────────
      if (!product) {
        product = await (await fetch(`${BASE}/products`, {
          method: 'POST', headers: sh,
          body: qs({ name: p.name, description: p.description || '', 'metadata[slug]': p.slug || '' }),
        })).json();
      }

      const price = await (await fetch(`${BASE}/prices`, {
        method: 'POST', headers: sh,
        body: qs({
          product: product.id,
          unit_amount: String((p.monthly_usd || 9) * 100),
          currency: 'usd',
          'recurring[interval]': 'month',
          'metadata[tier]': 'pro',
          'metadata[slug]': p.slug || '',
        }),
      })).json();

      const link = await (await fetch(`${BASE}/payment_links`, {
        method: 'POST', headers: sh,
        body: qs({
          'line_items[0][price]': price.id,
          'line_items[0][quantity]': '1',
          'after_completion[type]': 'redirect',
          'after_completion[redirect][url]': p.successUrl || `https://${p.slug}.vercel.app/success`,
        }),
      })).json();

      return new Response(JSON.stringify({ product, price, link, payment_url: link.url, reused: false }), { status: 200 });
    },
  };

  // Gumroad actions (merged from commerce.js)
  if (['gumroad_create', 'gumroad_update', 'gumroad_get', 'gumroad_list', 'gumroad_sales', 'gumroad_revenue'].includes(action)) {
    try {
      const gumAct = action.replace('gumroad_', '');
      const map = { create: 'createProduct', update: 'updateProduct', get: 'getProduct', list: 'listProducts', sales: 'getSales', revenue: 'getRevenue' };
      return res.json(await gumroadAction(map[gumAct], p));
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // Chrome Web Store actions (merged from commerce.js)
  if (action === 'chrome_upload') { try { return res.json(await uploadExtension(p)); } catch (e) { return res.status(500).json({ error: e.message }); } }
  if (action === 'chrome_publish') { try { return res.json(await publishExtension(p)); } catch (e) { return res.status(500).json({ error: e.message }); } }

  try {
    const actionFn = actions[action];
    if (!actionFn) return res.status(400).json({ error: `Unknown action: ${action}` });
    const r = await actionFn();
    if (!r || typeof r.json !== 'function') {
      const text = await r.text();
      return res.status(r.status).json(JSON.parse(text));
    }
    const data = await r.json();
    return res.status(r.ok ? 200 : r.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// ─── Gumroad + Chrome Web Store (merged from commerce.js) ─────────────────

async function gumroadAction(action, p) {
  const TOKEN = process.env.GUMROAD_ACCESS_TOKEN;
  if (!TOKEN) return { skipped: true, reason: 'GUMROAD_ACCESS_TOKEN not set' };
  const BASE = 'https://api.gumroad.com/v2';
  const acts = {
    createProduct: () => fetch(`${BASE}/products`, { method: 'POST', body: new URLSearchParams({ access_token: TOKEN, name: p.name, description: p.description || '', price: String(Math.round((p.price_usd || 9) * 100)), url: p.productUrl || '', published: 'true' }) }),
    updateProduct: () => fetch(`${BASE}/products/${p.productId}`, { method: 'PUT', body: new URLSearchParams({ access_token: TOKEN, ...(p.name ? { name: p.name } : {}), ...(p.price_usd ? { price: String(Math.round(p.price_usd * 100)) } : {}) }) }),
    getProduct: () => fetch(`${BASE}/products/${p.productId}?access_token=${TOKEN}`),
    listProducts: () => fetch(`${BASE}/products?access_token=${TOKEN}`),
    getSales: async () => { const r = await fetch(`${BASE}/sales?access_token=${TOKEN}&product_id=${p.productId || ''}`); const data = await r.json(); const sales = data.sales || []; return { sales, total_usd: sales.reduce((s, sale) => s + (sale.price / 100), 0).toFixed(2), count: sales.length }; },
    getRevenue: async () => { const r = await fetch(`${BASE}/sales?access_token=${TOKEN}`); const data = await r.json(); const sales = data.sales || []; const byProduct = {}; for (const sale of sales) { const pid = sale.product_id; if (!byProduct[pid]) byProduct[pid] = { count: 0, revenue_usd: 0, name: sale.product_name }; byProduct[pid].count += 1; byProduct[pid].revenue_usd += sale.price / 100; } return { total_usd: sales.reduce((s, sale) => s + sale.price / 100, 0).toFixed(2), total_sales: sales.length, by_product: byProduct }; },
  };
  const fn = acts[action];
  if (!fn) throw new Error(`Unknown gumroad action: ${action}`);
  const r = await fn();
  if (!r || typeof r.text !== 'function') return r;
  const text = await r.text();
  if (!(r.headers?.get?.('content-type') || '').includes('application/json') && text.trim().startsWith('<')) return { error: 'Gumroad returned HTML — check GUMROAD_ACCESS_TOKEN', status: r.status };
  try { return JSON.parse(text); } catch (_) { return { error: 'Gumroad parse error', raw: text.slice(0, 200) }; }
}

async function refreshChromeToken() {
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: process.env.CHROME_CLIENT_ID, client_secret: process.env.CHROME_CLIENT_SECRET, refresh_token: process.env.CHROME_REFRESH_TOKEN, grant_type: 'refresh_token' }) });
  const data = await r.json();
  return { access_token: data.access_token, expires_in: data.expires_in };
}

async function uploadExtension({ extensionId, zipBase64 }) {
  const { access_token } = await refreshChromeToken();
  const publisherId = process.env.CHROME_PUBLISHER_ID;
  const zipBuffer = Buffer.from(zipBase64, 'base64');
  const r = await fetch(`https://chromewebstore.googleapis.com/v2/publishers/${publisherId}/items/${extensionId}:uploadZip`, { method: 'PUT', headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/zip', 'Content-Length': String(zipBuffer.length) }, body: zipBuffer });
  return r.json();
}

async function publishExtension({ extensionId, target = 'default' }) {
  const { access_token } = await refreshChromeToken();
  const publisherId = process.env.CHROME_PUBLISHER_ID;
  const r = await fetch(`https://chromewebstore.googleapis.com/v2/publishers/${publisherId}/items/${extensionId}:publish?publishTarget=${target}`, { method: 'POST', headers: { Authorization: `Bearer ${access_token}`, 'Content-Length': '0' } });
  return r.json();
}

// Flatten nested objects for Stripe's form-encoded format
function flattenForStripe(obj, prefix = '') {
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(result, flattenForStripe(v, key));
    } else {
      result[key] = String(v);
    }
  }
  return result;
}
