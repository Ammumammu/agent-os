# .claude/rules/agent-patterns.md
# Patterns for agents/*.js (GitHub Actions cron jobs)

## Required Imports (every agent)
```js
import { fetchWithRetry } from '../lib/fetch-retry.js';
import { sendAlert, sendSuccess } from '../lib/alert.js';
```

## callAPI Helper (copy-paste into every agent)
```js
const BASE_URL = process.env.DASHBOARD_URL || 'https://your-dashboard.vercel.app';

async function callAPI(path, body = {}) {
  const res = await fetchWithRetry(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${path} → ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}
```

## Entry Point Pattern
```js
async function run() {
  const start = Date.now();
  console.log(`[${AGENT_NAME}] Starting at ${new Date().toISOString()}`);

  // Step 1
  // Step 2
  // ...

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  await sendSuccess(AGENT_NAME, `Completed in ${elapsed}s`, { ...summaryData });
}

run().catch(async (e) => {
  console.error(`[${AGENT_NAME}] Fatal error:`, e.message);
  await sendAlert(AGENT_NAME, e.message, { stack: e.stack?.slice(0, 500) });
  process.exit(1);
});
```

## Idempotency Rules
- Always check for existing work before doing it
- Build dedup: call `checkDuplicate(slug)` before starting any build
- Stripe dedup: use `createFull` (searches by metadata slug)
- SEO pages: check if GitHub file exists before pushing

## Retry Budget
- fetchWithRetry default: 3 retries, 1s/2s/4s backoff
- 429 responses: respect `Retry-After` header automatically
- For critical operations (Stripe, GitHub push): pass `maxRetries=5`
- Never retry indefinitely — always have a hard stop

## Logging Standard
```js
console.log(`[agent-name] Step 1/4: Fetching keywords...`);
console.log(`[agent-name] Step 2/4: Scoring 42 candidates...`);
console.log(`[agent-name] ✓ Top keyword: "${keyword}" (score: 8.7)`);
console.log(`[agent-name] Step 3/4: Writing queue...`);
console.log(`[agent-name] ✓ Done. 10 keywords queued.`);
```
Format: `[agent-name] Step N/Total: action...` then `[agent-name] ✓ result`

## Token Expiry Handling (traffic-agent pattern)
```js
function isAuthError(status) { return status === 401 || status === 403; }

async function handleTokenExpiry(platform) {
  await sendAlert(AGENT_NAME,
    `${platform} token expired — refresh required`,
    { instructions: `Refresh ${platform} token and update GitHub Secret` }
  );
  return { skipped: true, reason: 'token_expired' };
}

// In publish function:
if (isAuthError(res.status)) return handleTokenExpiry('linkedin');
```

## Shared Data Files
Read/write these for inter-agent coordination:
```js
// Read keyword queue (written by market-agent)
const queue = JSON.parse(await readFile('./public/keyword-queue.json', 'utf8'));

// Read portfolio (written by launch-agent)
const portfolio = JSON.parse(await readFile('./public/portfolio.json', 'utf8'));

// Write to copy queue (read by user in Traffic tab)
const copyQueue = JSON.parse(await readFile('./.claude/tmp/copy-queue.json', 'utf8').catch(() => '[]'));
copyQueue.push({ product, reddit, twitter, ih });
await writeFile('./.claude/tmp/copy-queue.json', JSON.stringify(copyQueue, null, 2));
```

## Winner / Loser Criteria
```js
// Winner: ALL true for 7 consecutive days
const isWinner = product.daily_visitors >= 200
  && product.activation_rate >= 0.40
  && product.paywall_ctr >= 0.15
  && product.mrr_usd >= 200;

// Loser: ALL true for 30 days, never a winner
const isLoser = product.daily_visitors < 30
  && product.mrr_usd === 0
  && product.conversion_rate < 0.005
  && !product.is_winner
  && daysSinceLaunch(product) >= 30;
```
