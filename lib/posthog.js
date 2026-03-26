// api/posthog.js — PostHog Analytics Read (server-side, personal API key)
// PostHog: 1M events/mo free, no credit card required
// Write key goes in browser; read key (personal API key) stays server-side here

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, ...p } = req.method === 'GET' ? req.query : req.body;
  const KEY = process.env.POSTHOG_PERSONAL_API_KEY;
  const PROJECT = process.env.POSTHOG_PROJECT_ID || '1';
  const BASE = `https://app.posthog.com/api/projects/${PROJECT}`;
  const h = { Authorization: `Bearer ${KEY}` };

  try {
    switch (action) {
      case 'funnel':     return res.json(await getFunnel(p, BASE, h));
      case 'events':     return res.json(await getEventCounts(p, BASE, h));
      case 'trends':     return res.json(await getTrends(p, BASE, h));
      case 'dashboard':  return res.json(await getDashboardMetrics(p, BASE, h));
      case 'persons':    return res.json(await getPersons(p, BASE, h));
      case 'feature_flags': return res.json(await getFeatureFlags(BASE, h));
      default: return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

async function getFunnel({ product, dateFrom, dateTo }, BASE, h) {
  const steps = [
    { id: 'tool_opened', name: 'Opened tool', type: 'events' },
    { id: 'tool_used', name: 'Used tool', type: 'events' },
    { id: 'free_limit_hit', name: 'Hit free limit', type: 'events' },
    { id: 'paywall_shown', name: 'Saw paywall', type: 'events' },
    { id: 'payment_clicked', name: 'Clicked pay', type: 'events' },
  ];

  const r = await fetch(`${BASE}/insights/funnel/`, {
    method: 'POST',
    headers: { ...h, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      insight: 'FUNNELS',
      events: steps.map(s => ({ id: s.id, name: s.name, type: 'events' })),
      date_from: dateFrom || '-7d',
      date_to: dateTo || null,
      ...(product ? { properties: [{ key: 'product', value: product, operator: 'exact' }] } : {}),
    }),
  });
  const data = await r.json();
  const results = data.result || [];
  return {
    funnel: results.map((step, i) => ({
      name: steps[i]?.name || step.name,
      count: step.count,
      conversion: i === 0 ? 100 : Math.round((step.count / results[0].count) * 100),
    })),
    product,
    period: { from: dateFrom || '-7d', to: dateTo },
  };
}

async function getEventCounts({ events, dateFrom, product }, BASE, h) {
  const eventList = events ? (Array.isArray(events) ? events : [events]) : [
    'tool_opened', 'tool_used', 'paywall_shown', 'payment_clicked', 'email_captured',
  ];

  const results = {};
  for (const event of eventList) {
    try {
      const r = await fetch(`${BASE}/insights/trend/`, {
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
      const count = (data.result?.[0]?.data || []).reduce((s, v) => s + v, 0);
      results[event] = count;
    } catch (_) { results[event] = 0; }
  }
  return { events: results, product, period: dateFrom || '-7d' };
}

async function getTrends({ event, dateFrom, interval }, BASE, h) {
  const r = await fetch(`${BASE}/insights/trend/`, {
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
  return {
    event: event || 'tool_opened',
    labels: data.result?.[0]?.labels || [],
    data: data.result?.[0]?.data || [],
  };
}

async function getDashboardMetrics({ product, dateFrom }, BASE, h) {
  const [opens, uses, paywalls, clicks, captures] = await Promise.all([
    getCount('tool_opened', product, dateFrom, BASE, h),
    getCount('tool_used', product, dateFrom, BASE, h),
    getCount('paywall_shown', product, dateFrom, BASE, h),
    getCount('payment_clicked', product, dateFrom, BASE, h),
    getCount('email_captured', product, dateFrom, BASE, h),
  ]);

  const activation_rate = opens > 0 ? Math.round((uses / opens) * 100) : 0;
  const paywall_hit_rate = uses > 0 ? Math.round((paywalls / uses) * 100) : 0;
  const paywall_ctr = paywalls > 0 ? Math.round((clicks / paywalls) * 100) : 0;
  const email_capture_rate = paywalls > 0 ? Math.round((captures / paywalls) * 100) : 0;

  return {
    product,
    period: dateFrom || '-7d',
    metrics: { opens, uses, paywalls, clicks, captures },
    rates: { activation_rate, paywall_hit_rate, paywall_ctr, email_capture_rate },
    winner: activation_rate >= 40 && paywall_ctr >= 15,
    needs_attention: activation_rate < 20 || paywall_ctr < 5,
    fetched_at: new Date().toISOString(),
  };
}

async function getPersons({ search, limit = 100 }, BASE, h) {
  const r = await fetch(`${BASE}/persons/?${search ? `search=${encodeURIComponent(search)}&` : ''}limit=${limit}`, { headers: h });
  return r.json();
}

async function getFeatureFlags(BASE, h) {
  const r = await fetch(`${BASE}/feature_flags/`, { headers: h });
  return r.json();
}

async function getCount(event, product, dateFrom, BASE, h) {
  try {
    const r = await fetch(`${BASE}/insights/trend/`, {
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
