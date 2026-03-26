# agent_docs/database_schema.md
# Supabase tables, relations, and RLS policies

## Tables

### leads
Captures email addresses from product paywalls.
```sql
CREATE TABLE leads (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email       text NOT NULL,
  product     text NOT NULL,           -- product slug
  context     text,                    -- 'paywall_extra_uses', 'newsletter', etc.
  source      text,                    -- document.referrer or 'direct'
  use_case    text,                    -- what the user typed / selected
  created_at  timestamptz DEFAULT now()
);
-- RLS: anon can INSERT (for lead capture from products)
--      service_role can SELECT ALL
```

### products
Registry of all live products — synced from portfolio.json.
```sql
CREATE TABLE products (
  id              text PRIMARY KEY,        -- slug
  name            text NOT NULL,
  slug            text UNIQUE NOT NULL,
  tagline         text,
  vercel_url      text,
  github_url      text,
  stripe_link     text,
  gumroad_link    text,
  devto_url       text,
  hashnode_url    text,
  status          text DEFAULT 'live',     -- 'live', 'retired', 'building'
  is_winner       boolean DEFAULT false,
  winner_since    timestamptz,
  mrr_usd         numeric DEFAULT 0,
  visitors        integer DEFAULT 0,
  activation_rate numeric DEFAULT 0,
  paywall_ctr     numeric DEFAULT 0,
  conversion_rate numeric DEFAULT 0,
  demand_score    numeric,
  icp             text,
  launched_at     timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
-- RLS: authenticated + service_role can read/write
```

### builds
Build pipeline job state — dedup key is slug + date.
```sql
CREATE TABLE builds (
  id           text PRIMARY KEY,      -- '{slug}-{YYYY-MM-DD}'
  slug         text NOT NULL,
  keyword      text,
  status       text DEFAULT 'running', -- 'running', 'completed', 'failed'
  phase        text,                  -- 'start', 'build_html', 'deploy', 'finalize'
  progress     integer DEFAULT 0,    -- 0-100
  phase1_data  jsonb,                 -- spec, stripe_product, gumroad_product
  phase2_data  jsonb,                 -- github_url, html_size
  phase3_data  jsonb,                 -- vercel_url, deployment_id
  phase4_data  jsonb,                 -- devto_url, hashnode_url, seo_pages
  error        text,
  started_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);
-- RLS: service_role manages all
--      authenticated can SELECT (dashboard reads job status)
```

### subscriptions
Stripe subscription mirror (populated by webhook).
```sql
CREATE TABLE subscriptions (
  id              text PRIMARY KEY,   -- Stripe subscription ID
  customer_id     text NOT NULL,
  product_slug    text,
  status          text NOT NULL,      -- 'active', 'canceled', 'past_due'
  amount_cents    integer,
  interval        text,               -- 'month', 'year'
  current_period_end timestamptz,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
-- RLS: service_role only (webhook writes, analytics reads)
```

### publish_queue
Tracks content distribution status.
```sql
CREATE TABLE publish_queue (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  product_slug text NOT NULL,
  channel     text NOT NULL,          -- 'devto', 'hashnode', 'reddit', 'twitter'
  status      text DEFAULT 'pending', -- 'pending', 'published', 'failed', 'skipped'
  published_url text,
  error       text,
  queued_at   timestamptz DEFAULT now(),
  published_at timestamptz
);
-- RLS: service_role manages all
```

## Key Queries

### Check if build exists today (dedup)
```sql
SELECT id, status, phase FROM builds
WHERE id = $1  -- '{slug}-{YYYY-MM-DD}'
AND status != 'failed';
```

### Get all active products with revenue
```sql
SELECT slug, name, mrr_usd, activation_rate, paywall_ctr, is_winner
FROM products
WHERE status = 'live'
ORDER BY mrr_usd DESC;
```

### Get today's leads
```sql
SELECT product, COUNT(*) as count
FROM leads
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY product
ORDER BY count DESC;
```

### Retire a loser product
```sql
UPDATE products
SET status = 'retired', updated_at = NOW()
WHERE slug = $1;
```

## Supabase Access Patterns
| Key | Used In | Can Do |
|-----|---------|--------|
| `SUPABASE_ANON_KEY` | `index.html` (browser) | INSERT leads only (RLS restricts) |
| `SUPABASE_SERVICE_KEY` | `api/*.js`, agents | Full read/write on all tables |

## Migration: Run supabase-schema.sql
Full schema is in `supabase-schema.sql` at the project root.
Run it in Supabase SQL Editor — it's idempotent (`CREATE TABLE IF NOT EXISTS`).
