# agents/CLAUDE.md — Subdirectory Context
# Loaded automatically when working in this directory.

## What's In This Directory
GitHub Actions cron agents — each runs independently on a schedule, calls `/api/*` endpoints.

## Standard Agent Structure
Every agent in this directory MUST follow this pattern:

```js
import { fetchWithRetry } from '../lib/fetch-retry.js';
import { sendAlert, sendSuccess } from '../lib/alert.js';

const AGENT_NAME = 'agent-name';
const BASE_URL = process.env.DASHBOARD_URL || 'https://your-dashboard.vercel.app';

async function callAPI(path, body) {
  const res = await fetchWithRetry(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json();
}

async function run() {
  console.log(`[${AGENT_NAME}] Starting...`);
  // ... agent logic
  await sendSuccess(AGENT_NAME, 'Completed', { result });
}

run().catch(async (e) => {
  console.error(`[${AGENT_NAME}] Fatal:`, e.message);
  await sendAlert(AGENT_NAME, e.message, { stack: e.stack });
  process.exit(1);
});
```

## Agent Responsibilities
| Agent | Input | Output | Calls |
|-------|-------|--------|-------|
| market-agent | – | keyword queue file | /api/keywords |
| seo-agent | keyword queue | 50 SEO pages on GitHub | /api/content, /api/github |
| product-agent | keyword queue | product specs | /api/keywords (generate mode) |
| builder-agent | product specs | live HTML deployed | /api/build (build_product) |
| launch-agent | built products | Stripe + Gumroad links | /api/stripe, /api/gumroad |
| traffic-agent | live products | Dev.to + Hashnode posts | /api/publish |
| analytics-agent | – | insights + tomorrow queue | /api/analytics, Pinecone |
| revenue-agent | – | MRR report | /api/analytics |

## Data Files (shared state between agents)
- `public/keyword-queue.json` — today's scored keywords (market-agent writes, others read)
- `public/portfolio.json` — all live products (launch-agent writes, traffic/analytics read)
- `.claude/tmp/copy-queue.json` — marketing copy ready for human posting
- `.claude/tmp/tomorrow.json` — tomorrow's build queue

## When Modifying an Agent
1. Keep the `callAPI()` + `fetchWithRetry` pattern — never raw fetch()
2. Keep the `run().catch(sendAlert)` wrapper
3. Test locally: `node agents/[agent-name].js` with a valid DASHBOARD_URL env var
4. All external API calls must have explicit error handling (check `res.ok`)
5. Log progress with `console.log('[agent-name] Step N: ...')` for GitHub Actions visibility
