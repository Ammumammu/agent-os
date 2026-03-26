#!/usr/bin/env node
// setup.js — One-time Vercel project setup + env var push
// Run ONCE before your first `node run.js`
// Usage: node setup.js

import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env
const raw = readFileSync(join(__dirname, '.env'), 'utf8');
raw.split('\n').forEach(line => {
  const [k, ...v] = line.split('=');
  if (k && !k.startsWith('#') && v.length) process.env[k.trim()] = v.join('=').trim();
});

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m',
};
const ok   = m => console.log(`${C.green}✅ ${m}${C.reset}`);
const warn = m => console.log(`${C.yellow}⚠️  ${m}${C.reset}`);
const fail = m => console.log(`${C.red}❌ ${m}${C.reset}`);
const info = m => console.log(`${C.dim}   ${m}${C.reset}`);
const head = m => console.log(`\n${C.bold}${C.cyan}${m}${C.reset}`);

// ─── Parse env vars ───────────────────────────────────────────────────────────
const envVars = [];
raw.split('\n').forEach(line => {
  line = line.trim();
  if (!line || line.startsWith('#')) return;
  const idx = line.indexOf('=');
  if (idx === -1) return;
  const key   = line.slice(0, idx).trim();
  const value = line.slice(idx + 1).trim();
  if (key && value && !value.includes('...') && !value.includes('xxx')) {
    envVars.push({ key, value });
  }
});

console.log(`\n${C.bold}${C.cyan}╔════════════════════════════════════════╗${C.reset}`);
console.log(`${C.bold}${C.cyan}║   Agent OS v7 — One-Time Setup         ║${C.reset}`);
console.log(`${C.bold}${C.cyan}╚════════════════════════════════════════╝${C.reset}`);

// ─── Step 1: Check vercel CLI ─────────────────────────────────────────────────
head('Step 1/4 — Vercel CLI');
try {
  const ver = execSync('vercel --version', { encoding: 'utf8' }).trim();
  ok(`vercel CLI: ${ver}`);
} catch {
  fail('vercel CLI not installed');
  info('Install it: npm install -g vercel');
  process.exit(1);
}

// ─── Step 2: Deploy (creates the project) ────────────────────────────────────
head('Step 2/4 — Deploy to Vercel (creates project)');
info('This may prompt for login or project name the first time');
info('When asked "Link to existing project?" → N (create new)');
info('Project name → agent-os');
console.log();

try {
  execSync('vercel --prod --yes', {
    cwd: __dirname,
    stdio: 'inherit',
    env: {
      ...process.env,
      VERCEL_TOKEN: process.env.VERCEL_API_KEY,
      VERCEL_ORG_ID: process.env.VERCEL_TEAM_ID,
      FORCE_COLOR: '1',
    },
  });
  ok('Deployed successfully');
} catch (e) {
  warn(`Deploy exited with error — continuing to push env vars anyway`);
}

// ─── Step 3: Find project ID ──────────────────────────────────────────────────
head('Step 3/4 — Finding project on Vercel API');
const TOKEN  = process.env.VERCEL_API_KEY;
const TEAM   = process.env.VERCEL_TEAM_ID;

let projectId = null;
const candidates = [
  `https://api.vercel.com/v9/projects?teamId=${TEAM}&limit=100`,
  `https://api.vercel.com/v9/projects?limit=100`,
];

for (const url of candidates) {
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const d = await r.json();
    const p = (d.projects || []).find(p => p.name === 'agent-os' || (p.targets?.production?.alias || []).some(a => a.includes('agent-os')));
    if (p) { projectId = p.id; ok(`Found project: ${p.name} (${p.id})`); break; }
  } catch (_) {}
}

if (!projectId) {
  // Try reading .vercel/project.json created by CLI
  const localProject = join(__dirname, '.vercel', 'project.json');
  if (existsSync(localProject)) {
    const lp = JSON.parse(readFileSync(localProject, 'utf8'));
    projectId = lp.projectId;
    ok(`Found project ID from .vercel/project.json: ${projectId}`);
  }
}

if (!projectId) {
  warn('Could not find project ID automatically');
  info('Go to vercel.com → agent-os project → Settings → copy Project ID');
  info('Then run: VERCEL_PROJECT_ID=xxx node setup.js --env-only');
  process.exit(1);
}

// ─── Step 4: Push all env vars ────────────────────────────────────────────────
head(`Step 4/4 — Pushing ${envVars.length} env vars to Vercel`);

// Get existing to avoid 409 conflicts
let existing = new Map();
try {
  const er = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env?teamId=${TEAM}&limit=100`, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });
  const ed = await er.json();
  existing = new Map((ed.envs || []).map(e => [e.key, e.id]));
  info(`${existing.size} vars already on Vercel`);
} catch (_) {}

let added = 0, updated = 0, failed = 0;
for (const { key, value } of envVars) {
  const existId = existing.get(key);
  try {
    if (existId) {
      const r = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env/${existId}?teamId=${TEAM}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ value, target: ['production', 'preview', 'development'] }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error.message);
      updated++;
    } else {
      const r = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env?teamId=${TEAM}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value, type: 'encrypted', target: ['production', 'preview', 'development'] }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error.message);
      added++;
    }
  } catch (e) {
    warn(`${key}: ${e.message}`);
    failed++;
  }
}

ok(`Env vars: ${added} added, ${updated} updated${failed ? `, ${failed} failed` : ''}`);

// ─── Step 5: Redeploy to activate env vars ────────────────────────────────────
head('Final — Redeploying to activate env vars');
try {
  execSync('vercel --prod --yes', {
    cwd: __dirname,
    stdio: 'inherit',
    env: {
      ...process.env,
      VERCEL_TOKEN: process.env.VERCEL_API_KEY,
      VERCEL_ORG_ID: process.env.VERCEL_TEAM_ID,
      FORCE_COLOR: '1',
    },
  });
  ok('Redeploy complete — all env vars are now live');
} catch {
  warn('Redeploy had issues — trigger manually: vercel --prod');
}

console.log(`\n${C.bold}${C.green}╔════════════════════════════════════════╗${C.reset}`);
console.log(`${C.bold}${C.green}║   Setup Complete! Run the pipeline:    ║${C.reset}`);
console.log(`${C.bold}${C.green}║                                        ║${C.reset}`);
console.log(`${C.bold}${C.green}║   node run.js                          ║${C.reset}`);
console.log(`${C.bold}${C.green}╚════════════════════════════════════════╝${C.reset}\n`);
