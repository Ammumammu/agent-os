# agent_docs/building_the_project.md
# How to set up, configure, and deploy Agent OS v7

## Prerequisites
- Node.js 18+
- Vercel CLI: `npm i -g vercel`
- A Vercel account (free tier works)
- GitHub account with a PAT (read/write repos)
- Stripe account (test mode for dev)
- Supabase project (free tier)

## Local Setup

### 1. Clone and install
```bash
git clone https://github.com/YOUR-USERNAME/agent-os
cd agent-os
# No npm install needed — no dependencies for the dashboard
# Agents use Node.js built-ins + fetch (Node 18+)
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env with your real keys
# See .env.example for all required variables
```

### 3. Set up Supabase
- Create a Supabase project at supabase.com
- Open SQL Editor → paste contents of `supabase-schema.sql` → Run
- Tables created: leads, products, builds, subscriptions, publish_queue
- Enable RLS on all tables (done by the schema SQL)

### 4. Local development
```bash
# Serve the dashboard locally (no build step required)
npx serve . -p 3000
# Open http://localhost:3000

# Or use Vercel dev (runs serverless functions locally)
vercel dev
```

### 5. Test an API endpoint
```bash
curl -X POST http://localhost:3000/api/health
# Expected: { "status": "ok", "checks": { "env": {...} } }

curl -X POST http://localhost:3000/api/stripe \
  -H "Content-Type: application/json" \
  -d '{"action":"getSubscriptions"}'
```

## Production Deployment

### 1. Deploy to Vercel
```bash
vercel --prod
# Follow prompts — link to your GitHub repo for auto-deploys
```

### 2. Set Vercel environment variables
```bash
vercel env add STRIPE_SECRET_KEY production
vercel env add GITHUB_TOKEN production
# ... repeat for all server-side secrets
# Or set them in Vercel dashboard → Project Settings → Environment Variables
```

### 3. Set GitHub Actions secrets (for cron agents)
In your GitHub repo → Settings → Secrets → Actions:
```
GH_TOKEN              = your GitHub PAT
VERCEL_API_KEY        = your Vercel API key
STRIPE_SECRET_KEY     = sk_live_...
SUPABASE_URL          = https://xxx.supabase.co
SUPABASE_SERVICE_KEY  = eyJ...
GROQ_API_KEY          = gsk_...
SLACK_WEBHOOK_URL     = https://hooks.slack.com/...
RESEND_API_KEY        = re_...
DASHBOARD_URL         = https://your-dashboard.vercel.app
```

### 4. Verify deployment
```bash
curl https://your-dashboard.vercel.app/api/health
# All checks should be { ok: true }
```

## First Product Build (manual test)
1. Open dashboard → Build tab
2. Enter a keyword (e.g., "cold email personalizer")
3. Click "Build Product"
4. Watch the 4-phase pipeline progress
5. Result card shows: live URL, Stripe payment link, Dev.to article URL

## Updating the Dashboard
Edit `index.html` directly → commit to GitHub → Vercel auto-deploys in ~30s.
No build step, no compilation.

## Updating Serverless Functions
Edit any `api/*.js` → commit → Vercel auto-deploys.
Functions redeploy individually — zero downtime.

## Adding a New Agent
1. Copy an existing agent as template (e.g., `agents/market-agent.js`)
2. Update `AGENT_NAME` constant
3. Implement `run()` function
4. Add to `.github/workflows/daily-agents.yml` with a cron schedule
5. Add `DASHBOARD_URL` and any new secrets to GitHub Secrets
