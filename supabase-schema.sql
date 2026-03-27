-- Agent OS v7 — Supabase Schema
-- Run this in the Supabase SQL Editor: https://app.supabase.com/project/_/sql
-- All tables use Row Level Security (RLS) so anon key is safe in browser for inserts.

-- ─── leads ────────────────────────────────────────────────────────────────────
create table if not exists leads (
  id          bigserial primary key,
  email       text not null,
  product     text not null,
  context     text,
  source      text,
  use_case    text,
  created_at  timestamptz default now()
);

alter table leads enable row level security;

-- Allow browser (anon) to insert leads (email capture on paywall)
create policy "anon can insert leads"
  on leads for insert
  to anon
  with check (true);

-- Only service role can read leads (server-side only)
create policy "service can select leads"
  on leads for select
  to service_role
  using (true);

-- ─── sales ────────────────────────────────────────────────────────────────────
create table if not exists sales (
  id                  bigserial primary key,
  stripe_payment_id   text unique,
  customer_email      text,
  product_name        text,
  product_id          text,
  amount_usd          numeric(10,2),
  currency            text default 'usd',
  created_at          timestamptz default now()
);

alter table sales enable row level security;

create policy "service can manage sales"
  on sales for all
  to service_role
  using (true);

-- ─── payments ─────────────────────────────────────────────────────────────────
create table if not exists payments (
  id                    bigserial primary key,
  stripe_payment_intent text unique,
  customer_email        text,
  amount_usd            numeric(10,2),
  product               text,
  status                text,
  created_at            timestamptz default now()
);

alter table payments enable row level security;

create policy "service can manage payments"
  on payments for all
  to service_role
  using (true);

-- ─── subscriptions ────────────────────────────────────────────────────────────
create table if not exists subscriptions (
  id              bigserial primary key,
  stripe_sub_id   text unique not null,
  customer_email  text,
  product         text,
  plan            text,
  status          text default 'active',
  amount_usd      numeric(10,2),
  interval        text default 'month',
  started_at      timestamptz,
  canceled_at     timestamptz,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

alter table subscriptions enable row level security;

create policy "service can manage subscriptions"
  on subscriptions for all
  to service_role
  using (true);

-- ─── products (portfolio) ─────────────────────────────────────────────────────
create table if not exists products (
  id              bigserial primary key,
  slug            text unique not null,
  name            text not null,
  tagline         text,
  status          text default 'building',  -- building|live|retired
  github_url      text,
  vercel_url      text,
  stripe_link     text,
  gumroad_link    text,
  devto_url       text,
  hashnode_url    text,
  demand_score    numeric(4,2),
  icp             text,
  category        text,
  mrr_usd         numeric(10,2) default 0,
  launched_at     timestamptz,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

alter table products enable row level security;

create policy "service can manage products"
  on products for all
  to service_role
  using (true);

-- Anon can read live products (for cross-sell widget)
create policy "anon can read live products"
  on products for select
  to anon
  using (status = 'live');

-- ─── builds (async job tracking for /api/build phased pipeline) ──────────────
-- Stores state between phases so the dashboard can chain calls and show progress.
-- Also acts as the dedup lock: one build per slug per day.
create table if not exists builds (
  id           text primary key,             -- "${slug}-${YYYY-MM-DD}"
  slug         text not null,
  keyword      text,
  status       text default 'pending',       -- pending|phase1_done|phase2_done|phase3_done|live|failed
  phase1_data  jsonb,                        -- spec, stripeLink, gumroadLink, stripeProductId
  phase2_data  jsonb,                        -- owner, githubUrl
  phase3_data  jsonb,                        -- liveUrl, product (set in finalize)
  error        text,                         -- last error message if status=failed
  started_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

alter table builds enable row level security;

-- Service role manages all build records
create policy "service can manage builds"
  on builds for all
  to service_role
  using (true);

-- Authenticated users (dashboard) can read builds
create policy "authed can read builds"
  on builds for select
  to authenticated
  using (true);

-- ─── publish_queue (semi-auto content pending human posting) ──────────────────
create table if not exists publish_queue (
  id              bigserial primary key,
  product_slug    text not null,
  product_name    text,
  product_url     text,
  status          text default 'pending_human',  -- pending_human|posted|skipped
  channels        jsonb,                           -- { reddit, twitter, indiehackers, producthunt }
  queued_at       timestamptz default now(),
  posted_at       timestamptz
);

alter table publish_queue enable row level security;

create policy "service can manage publish_queue"
  on publish_queue for all
  to service_role
  using (true);

-- ─── dunning_log (failed payment recovery tracking) ──────────────────────────
create table if not exists dunning_log (
  id                  bigserial primary key,
  customer_email      text not null,
  stripe_invoice_id   text unique,
  product_slug        text,
  attempt_count       int default 1,
  invoice_url         text,
  resolved_at         timestamptz,
  created_at          timestamptz default now()
);

alter table dunning_log enable row level security;

create policy "service can manage dunning_log"
  on dunning_log for all
  to service_role
  using (true);

-- ─── winback_log (canceled subscriber re-engagement tracking) ─────────────────
create table if not exists winback_log (
  id              bigserial primary key,
  customer_email  text not null,
  stripe_sub_id   text,
  product_slug    text,
  day1_sent_at    timestamptz,
  day3_sent_at    timestamptz,
  day7_sent_at    timestamptz,
  day14_sent_at   timestamptz,
  reactivated_at  timestamptz,
  created_at      timestamptz default now()
);

alter table winback_log enable row level security;

create policy "service can manage winback_log"
  on winback_log for all
  to service_role
  using (true);
