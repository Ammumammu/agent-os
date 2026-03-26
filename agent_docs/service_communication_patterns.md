# agent_docs/service_communication_patterns.md
# How the three layers communicate with each other

## Layer Communication Rules

```
Browser  ──→  /api/*          ← ALWAYS. Never call Stripe/GitHub directly from browser.
Agents   ──→  /api/*          ← ALWAYS. Agents call the same /api/* endpoints.
Browser  ──→  Groq/Gemini/Pinecone  ← Direct (CORS-enabled, no secrets needed)
Browser  ──→  HN Algolia      ← Direct (CORS: *, free, no auth)
Browser  ──→  PostHog write   ← Direct (CORS-enabled, public write key safe)
Browser  ──→  Supabase anon   ← Direct (RLS protects rows)
Agents   ──X→ Browser         ← Never. Agents have no way to call the browser.
/api/*   ──X→ /api/*          ← Never. Functions don't call each other; use lib/ helpers.
```

## Browser → /api/* Pattern
```js
// In index.html
async function apiCall(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json();
}

// Usage
const data = await apiCall('/api/stripe', { action: 'getRevenue' });
const job  = await apiCall('/api/build',  { action: 'start', keyword: 'invoice tool' });
```

## Agent → /api/* Pattern
```js
// In agents/*.js — uses fetchWithRetry for resilience
async function callAPI(path, body = {}) {
  const res = await fetchWithRetry(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}
```

## Build Pipeline: Dashboard ↔ /api/build (4 phases)
```
Dashboard                          /api/build
    │                                  │
    ├─── POST {action:'start', keyword}→│── validate + spec (Groq)
    │                                  │── Stripe createFull
    │                                  │── Supabase builds INSERT
    │←── { jobId, phase:'start', ... } ┤
    │                                  │
    ├─── POST {action:'build_html', jobId}→│── Claude Sonnet generateHTML
    │                                  │── GitHub createRepo + pushFile
    │                                  │── Supabase builds UPDATE phase2_data
    │←── { phase:'build_html', ... }   ┤
    │                                  │
    ├─── POST {action:'deploy', jobId}→ │── Vercel createProject
    │                                  │── Poll until READY (max 90s)
    │                                  │── Supabase builds UPDATE phase3_data
    │←── { phase:'deploy', vercel_url }┤
    │                                  │
    ├─── POST {action:'finalize', jobId}→│── Generate 6 SEO pages (Groq)
    │                                  │── Push SEO pages to GitHub
    │                                  │── Dev.to + Hashnode publish
    │                                  │── Update portfolio.json
    │                                  │── Pinecone upsert
    │←── { phase:'finalize', complete }┤
```

## Analytics Data Aggregation
```
/api/analytics (action:'getDashboard')
    │
    ├── Stripe API → getSubscriptions → MRR calculation
    ├── Gumroad API → getSales → one-time revenue
    ├── PostHog API → getFunnel → activation/conversion rates
    ├── Supabase → products table → portfolio metrics
    │
    └── Returns: { mrr_usd, arr_usd, active_subscribers, by_product[], funnel }
```

## Agent Inter-coordination (file-based, not direct)
```
market-agent writes:   public/keyword-queue.json
                            ↓
product-agent reads:   public/keyword-queue.json → generates specs
builder-agent reads:   public/keyword-queue.json → builds top 3

launch-agent writes:   public/portfolio.json
                            ↓
traffic-agent reads:   public/portfolio.json → publishes for new products
analytics-agent reads: public/portfolio.json → evaluates all products

analytics-agent writes: .claude/tmp/tomorrow.json
                            ↓
market-agent reads:    .claude/tmp/tomorrow.json → seeds next keyword search
```

## Error Propagation
```
Agent failure → sendAlert(agentName, message)
                    │
                    ├── Slack webhook (primary)
                    └── Resend email (fallback if no Slack webhook)

/api/* failure → { error: 'message', status: 500 }
                    │
                    └── Browser/agent catches → logs → shows in dashboard

Build job failure → Supabase builds { status: 'failed', error: 'message' }
                    │
                    └── Dashboard polling sees status='failed' → shows error card
```

## External Service Timeouts
| Service | Timeout Set | Location |
|---------|-------------|----------|
| Groq API | 30s (default fetch) | Inline in callGroq() |
| Stripe API | 30s (default fetch) | api/stripe.js |
| Vercel deploy poll | 90s total, 10s intervals | api/build.js |
| GitHub API | 30s (default fetch) | api/github.js |
| Health checks | 5s each | api/health.js (AbortSignal.timeout) |
| fetchWithRetry | 1s/2s/4s backoff | lib/fetch-retry.js |
