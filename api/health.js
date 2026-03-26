// api/health.js — Readiness + liveness probe
// GET /api/health → { status, uptime_s, timestamp, version, checks }
// Used by: Vercel deployment verification, uptime monitors (UptimeRobot, BetterStack),
//          GitHub Actions post-deploy smoke tests, dashboard header status pill.

const START_TIME = Date.now();

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const checks = await runChecks();
  const allOk = Object.values(checks).every(c => c.ok);

  return res.status(allOk ? 200 : 503).json({
    status: allOk ? 'ok' : 'degraded',
    uptime_s: Math.floor((Date.now() - START_TIME) / 1000),
    timestamp: new Date().toISOString(),
    version: 'agent-os-v7',
    checks,
  });
}

async function runChecks() {
  const checks = {};

  // ── Env vars (critical secrets present) ─────────────────────────────────
  checks.env = {
    ok: !!(process.env.GITHUB_TOKEN && process.env.STRIPE_SECRET_KEY && process.env.GROQ_API_KEY),
    details: {
      github:  !!process.env.GITHUB_TOKEN,
      stripe:  !!process.env.STRIPE_SECRET_KEY,
      groq:    !!process.env.GROQ_API_KEY,
      supabase: !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY),
      resend:  !!process.env.RESEND_API_KEY,
      vercel:  !!process.env.VERCEL_API_KEY,
    },
  };

  // ── Groq reachability (free, fast) ──────────────────────────────────────
  if (process.env.GROQ_API_KEY) {
    try {
      const r = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
        signal: AbortSignal.timeout(5000),
      });
      checks.groq = { ok: r.ok, status: r.status };
    } catch (e) {
      checks.groq = { ok: false, error: e.message };
    }
  } else {
    checks.groq = { ok: false, error: 'GROQ_API_KEY not set' };
  }

  // ── Stripe reachability ──────────────────────────────────────────────────
  if (process.env.STRIPE_SECRET_KEY) {
    try {
      const r = await fetch('https://api.stripe.com/v1/balance', {
        headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
        signal: AbortSignal.timeout(5000),
      });
      checks.stripe = { ok: r.ok, status: r.status, live_mode: !process.env.STRIPE_SECRET_KEY.startsWith('sk_test_') };
    } catch (e) {
      checks.stripe = { ok: false, error: e.message };
    }
  } else {
    checks.stripe = { ok: false, error: 'STRIPE_SECRET_KEY not set' };
  }

  // ── Supabase reachability ───────────────────────────────────────────────
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    try {
      const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/leads?limit=1`, {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        },
        signal: AbortSignal.timeout(5000),
      });
      checks.supabase = { ok: r.ok, status: r.status };
    } catch (e) {
      checks.supabase = { ok: false, error: e.message };
    }
  } else {
    checks.supabase = { ok: false, error: 'SUPABASE_URL or SUPABASE_SERVICE_KEY not set' };
  }

  return checks;
}
