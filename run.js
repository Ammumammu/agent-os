#!/usr/bin/env node
// run.js — Single command to execute the full Agent OS pipeline
// Usage: node run.js
//        node run.js --local     (starts vercel dev automatically)
//        node run.js --from=builder  (resume from a specific agent)

import { readFileSync, existsSync } from 'fs';
import { execSync, spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Load .env ────────────────────────────────────────────────────────────────
const envFile = join(__dirname, '.env');
if (existsSync(envFile)) {
  // Load .env for local development — in GitHub Actions env vars come from workflow secrets
  readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && !k.startsWith('#') && v.length) process.env[k.trim()] = v.join('=').trim();
  });
}

// ─── Config ───────────────────────────────────────────────────────────────────
const ARGS = process.argv.slice(2);
const LOCAL_MODE = ARGS.includes('--local');
const FROM_ARG = (ARGS.find(a => a.startsWith('--from=')) || '').replace('--from=', '');
const BASE_URL = process.env.AGENT_OS_URL || 'http://localhost:3000';

const AGENTS = [
  { id: 'market', file: 'agents/market-agent.js', emoji: '🔍', label: 'Market Intelligence', desc: 'Discovers 50 keywords → scores → writes build-queue.json' },
  { id: 'product', file: 'agents/product-agent.js', emoji: '📋', label: 'Product Spec Gen', desc: 'Converts top keywords → product specs with pricing + ICP' },
  { id: 'seo', file: 'agents/seo-agent.js', emoji: '📄', label: 'SEO Page Factory', desc: 'Generates 50 SEO pages → pushes to GitHub' },
  { id: 'builder', file: 'agents/builder-agent.js', emoji: '🔨', label: 'Product Builder', desc: 'Builds 3 HTML tools via NVIDIA NIM → pushes to GitHub' },
  { id: 'launch', file: 'agents/launch-agent.js', emoji: '🚀', label: 'Deploy + Monetize', desc: 'Vercel deploy + Stripe payment links + Gumroad listing' },
  { id: 'traffic', file: 'agents/traffic-agent.js', emoji: '📡', label: 'Viral Distribution', desc: '10 channels: Dev.to+Hashnode+Medium+Twitter+Reddit+LinkedIn+HN+Telegram+Backlinks+Newsletter' },
  { id: 'analytics', file: 'agents/analytics-agent.js', emoji: '📊', label: 'Analytics + Memory', desc: 'MRR + SERP rankings + Pinecone insights + tomorrow plan' },
  { id: 'revenue', file: 'agents/revenue-agent.js', emoji: '💰', label: '$108 Revenue Mission', desc: 'Stripe/Gumroad audit → conversion banners → PH launch → CEO digest' },
  { id: 'acos', file: 'agents/acos-orchestrator.js', emoji: '🎬', label: 'ACOS Content Engine', desc: 'Trend scan → Ideation → Hook engineer → Script writer → Platform adapter' },
];

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m',
  cyan: '\x1b[36m', magenta: '\x1b[35m', blue: '\x1b[34m', white: '\x1b[37m',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function banner() {
  console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║      AGENT OS v7 — 100% Autonomous Viral Factory       ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════════════════════╝${C.reset}`);
  console.log(`${C.dim}  Mode:   ${LOCAL_MODE ? 'local (vercel dev)' : 'production'}${C.reset}`);
  console.log(`${C.dim}  Server: ${BASE_URL}${C.reset}`);
  console.log(`${C.dim}  Date:   ${new Date().toLocaleString()}${C.reset}\n`);
}

function step(emoji, label, desc) {
  console.log(`\n${C.bold}${emoji}  ${label}${C.reset}`);
  console.log(`${C.dim}   ${desc}${C.reset}`);
  console.log(`${C.dim}   ${'─'.repeat(52)}${C.reset}`);
}

function ok(msg) { console.log(`   ${C.green}✅ ${msg}${C.reset}`); }
function warn(msg) { console.log(`   ${C.yellow}⚠️  ${msg}${C.reset}`); }
function fail(msg) { console.log(`   ${C.red}❌ ${msg}${C.reset}`); }
function info(msg) { console.log(`   ${C.dim}   ${msg}${C.reset}`); }

function elapsed(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function summaryTable(results) {
  console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║                   PIPELINE SUMMARY                   ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╠══════════════════════════════════════════════════════╣${C.reset}`);
  let totalMs = 0;
  for (const r of results) {
    totalMs += r.ms;
    const status = r.skipped ? `${C.dim}SKIPPED${C.reset}` : r.ok ? `${C.green}✅ OK${C.reset}   ` : `${C.red}❌ FAIL${C.reset}`;
    const time = r.skipped ? '      ' : elapsed(r.ms).padStart(6);
    const label = r.label.padEnd(22);
    console.log(`${C.cyan}║${C.reset}  ${r.emoji}  ${C.bold}${label}${C.reset}  ${status}  ${C.dim}${time}${C.reset}  ${C.cyan}║${C.reset}`);
  }
  console.log(`${C.bold}${C.cyan}╠══════════════════════════════════════════════════════╣${C.reset}`);
  console.log(`${C.bold}${C.cyan}║${C.reset}  ⏱️  Total time: ${C.bold}${elapsed(totalMs)}${C.reset}${' '.repeat(33 - elapsed(totalMs).length)}${C.bold}${C.cyan}║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════════════════════╝${C.reset}`);
}

// ─── Preflight checks ─────────────────────────────────────────────────────────
async function preflight() {
  step('🔎', 'Preflight Checks', 'Verifying keys and server reachability');

  const required = ['GROQ_API_KEY', 'GITHUB_TOKEN', 'GITHUB_USERNAME', 'VERCEL_API_KEY',
    'STRIPE_SECRET_KEY', 'NVIDIA_API_KEY', 'SUPABASE_URL', 'PINECONE_API_KEY'];
  let allKeysOk = true;
  for (const key of required) {
    if (!process.env[key] || process.env[key].includes('...') || process.env[key].includes('xxx')) {
      fail(`${key} not set`);
      allKeysOk = false;
    }
  }
  if (allKeysOk) ok(`All ${required.length} required env vars present`);

  // Check server reachability
  try {
    const r = await fetch(`${BASE_URL}/api/product`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'score_idea', keyword: 'test' }),
    });
    if (r.ok) {
      ok(`Server reachable: ${BASE_URL}`);
    } else {
      warn(`Server returned ${r.status} — agents may fail`);
    }
  } catch (_) {
    if (LOCAL_MODE) {
      warn(`Server not reachable — will start vercel dev`);
      return 'start_server';
    } else {
      fail(`Server not reachable at ${BASE_URL}`);
      info(`Deploy first: vercel --prod`);
      info(`Or run locally: node run.js --local`);
      process.exit(1);
    }
  }

  return 'ok';
}

// ─── Start local server ───────────────────────────────────────────────────────
async function startLocalServer() {
  step('⚡', 'Starting Local Server', 'Running vercel dev on port 3000');
  return new Promise((resolve) => {
    const server = spawn('vercel', ['dev', '--listen', '3000'], {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let ready = false;
    const checkReady = async () => {
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000));
        try {
          const r = await fetch('http://localhost:3000/api/product', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'score_idea', keyword: 'test' }),
          });
          if (r.ok) { ok('vercel dev ready on http://localhost:3000'); resolve(server); return; }
        } catch (_) { }
      }
      fail('vercel dev did not start in 60s');
      process.exit(1);
    };

    server.stdout.on('data', d => {
      const line = d.toString().trim();
      if (line) info(line.slice(0, 80));
      if (!ready && (line.includes('Ready') || line.includes('localhost'))) {
        ready = true;
        checkReady();
      }
    });
    server.stderr.on('data', d => info(d.toString().trim().slice(0, 80)));

    // Start checking even if we don't see "Ready" line
    setTimeout(() => { if (!ready) { ready = true; checkReady(); } }, 5000);
  });
}

// ─── Run a single agent ───────────────────────────────────────────────────────
async function runAgent(agent) {
  step(agent.emoji, agent.label, agent.desc);
  const start = Date.now();

  return new Promise((resolve) => {
    const proc = spawn('node', [join(__dirname, agent.file)], {
      env: { ...process.env, AGENT_OS_URL: BASE_URL },
      cwd: __dirname,
    });

    let lastLine = '';
    const handleLine = (line) => {
      line = line.trim();
      if (!line) return;
      lastLine = line;
      // Color key lines
      if (line.includes('✅') || line.includes('✓')) info(`${C.green}${line}${C.reset}`);
      else if (line.includes('❌') || line.includes('Error')) info(`${C.red}${line}${C.reset}`);
      else if (line.includes('⚠️') || line.includes('warn')) info(`${C.yellow}${line}${C.reset}`);
      else info(line);
    };

    let buffer = '';
    const processOutput = (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      lines.forEach(handleLine);
    };

    proc.stdout.on('data', processOutput);
    proc.stderr.on('data', processOutput);
    if (buffer) handleLine(buffer);

    proc.on('close', (code) => {
      const ms = Date.now() - start;
      if (code === 0) {
        ok(`${agent.label} complete — ${elapsed(ms)}`);
        resolve({ ...agent, ok: true, ms, code });
      } else {
        fail(`${agent.label} exited with code ${code} after ${elapsed(ms)}`);
        resolve({ ...agent, ok: false, ms, code });
      }
    });

    proc.on('error', (e) => {
      fail(`Failed to start ${agent.file}: ${e.message}`);
      resolve({ ...agent, ok: false, ms: Date.now() - start, error: e.message });
    });
  });
}

// ─── Show output files ────────────────────────────────────────────────────────
function showOutputs() {
  step('📁', 'Output Files', 'What was written to disk');

  const files = [
    { path: 'products/build-queue.json', label: 'Keyword queue' },
    { path: 'products/product-specs.json', label: 'Product specs' },
    { path: 'products/built-products.json', label: 'Built products' },
    { path: 'products/launched-products.json', label: 'Launched products' },
    { path: 'public/portfolio.json', label: 'Portfolio (live)' },
  ];

  for (const { path, label } of files) {
    const full = join(__dirname, path);
    if (!existsSync(full)) { info(`${label}: not created yet`); continue; }
    try {
      const data = JSON.parse(readFileSync(full, 'utf8'));
      const count = data.build_queue?.length ?? data.selected_for_build?.length
        ?? data.products?.length ?? (Array.isArray(data) ? data.length : 1);
      ok(`${label}: ${count} entries → ${path}`);
    } catch (_) {
      ok(`${label} → ${path}`);
    }
  }
}

// ─── Autonomous distribution status ──────────────────────────────────────────
function humanActions() {
  const channels = {
    'Dev.to + Hashnode': true, // always on
    'Twitter/X (Typefully)': !!process.env.TYPEFULLY_API_KEY,
    'Reddit (OAuth)': !!process.env.REDDIT_CLIENT_ID,
    'LinkedIn': !!process.env.LINKEDIN_ACCESS_TOKEN,
    'Medium': !!process.env.MEDIUM_INTEGRATION_TOKEN,
    'Hacker News': !!process.env.HN_USERNAME,
    'Telegram Channel': !!process.env.TELEGRAM_BOT_TOKEN,
    'Backlink Pings': true, // always on
    'Newsletter (Resend)': !!process.env.RESEND_API_KEY,
  };
  const active = Object.entries(channels).filter(([, v]) => v).map(([k]) => k);
  const inactive = Object.entries(channels).filter(([, v]) => !v).map(([k]) => k);

  console.log(`\n${C.bold}${C.green}╔══════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.green}║       ✅ 100% AUTONOMOUS DISTRIBUTION ACTIVE          ║${C.reset}`);
  console.log(`${C.bold}${C.green}╠══════════════════════════════════════════════════════╣${C.reset}`);
  active.forEach(ch => console.log(`${C.green}║${C.reset}  ✅ ${ch}`));
  if (inactive.length) {
    console.log(`${C.green}╠══════════════════════════════════════════════════════╣${C.reset}`);
    console.log(`${C.green}║${C.reset}  ${C.dim}🔒 Unlock more channels (add to .env):${C.reset}`);
    inactive.forEach(ch => console.log(`${C.green}║${C.reset}  ${C.dim}   ${ch}${C.reset}`));
  }
  console.log(`${C.bold}${C.green}╚══════════════════════════════════════════════════════╝${C.reset}\n`);
}


// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  banner();

  // Preflight
  const preflightResult = await preflight();
  let server = null;
  if (preflightResult === 'start_server') {
    server = await startLocalServer();
  }

  // Determine which agents to run (--from support)
  const fromIdx = FROM_ARG ? AGENTS.findIndex(a => a.id === FROM_ARG) : 0;
  if (FROM_ARG && fromIdx === -1) {
    fail(`Unknown agent: ${FROM_ARG}. Valid: ${AGENTS.map(a => a.id).join(', ')}`);
    process.exit(1);
  }
  const agentsToRun = AGENTS.slice(fromIdx);
  const skippedAgents = AGENTS.slice(0, fromIdx).map(a => ({ ...a, ok: true, ms: 0, skipped: true }));

  if (FROM_ARG) info(`Resuming from: ${FROM_ARG} (skipping ${fromIdx} agents)`);

  // Run agents in sequence
  const results = [...skippedAgents];
  for (const agent of agentsToRun) {
    const result = await runAgent(agent);
    results.push(result);

    // Don't stop on failure — log and continue
    if (!result.ok) {
      warn(`${agent.label} failed — continuing to next agent`);
    }
  }

  // Summary
  showOutputs();
  summaryTable(results);
  humanActions();

  const failed = results.filter(r => !r.ok && !r.skipped);
  if (failed.length > 0) {
    console.log(`${C.yellow}Retry failed agents with:${C.reset}`);
    failed.forEach(f => console.log(`  node run.js --from=${f.id}`));
    console.log();
  }

  // Cleanup local server
  if (server) {
    server.kill();
    info('vercel dev stopped');
  }

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
