#!/usr/bin/env node
// scripts/fix-proxy-url.js — Patch AI_PROXY URL in all product repos on GitHub
//
// Run: GITHUB_TOKEN=ghp_... AGENT_OS_URL=https://your-agent-os.vercel.app node scripts/fix-proxy-url.js
//
// What it does:
//   For each product repo, fetches index.html, replaces the AI_PROXY URL,
//   and pushes the update back. Vercel auto-redeploys on push.

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TOKEN = process.env.GITHUB_TOKEN;
const NEW_URL = process.env.AGENT_OS_URL;

if (!TOKEN) { console.error('Missing GITHUB_TOKEN'); process.exit(1); }
if (!NEW_URL) { console.error('Missing AGENT_OS_URL (e.g. https://agent-os-seven.vercel.app)'); process.exit(1); }

const GH = 'https://api.github.com';
const HEADERS = {
  Authorization: `token ${TOKEN}`,
  'Content-Type': 'application/json',
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

// Load portfolio to get all product repos
const portfolio = JSON.parse(readFileSync(join(__dirname, '../public/portfolio.json'), 'utf8'));

// Extract owner from first github_url
const firstGhUrl = portfolio.find(p => p.github_url)?.github_url || '';
const OWNER = firstGhUrl.split('/')[3];
if (!OWNER) { console.error('Could not determine GitHub owner from portfolio.json'); process.exit(1); }

console.log(`Owner: ${OWNER}`);
console.log(`New AI proxy URL: ${NEW_URL}/api/ai`);
console.log(`Patching ${portfolio.length} repos...\n`);

async function getFile(repo, path) {
  const r = await fetch(`${GH}/repos/${OWNER}/${repo}/contents/${path}`, { headers: HEADERS });
  if (!r.ok) return null;
  return r.json();
}

async function pushFile(repo, path, content, sha, message) {
  const r = await fetch(`${GH}/repos/${OWNER}/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: HEADERS,
    body: JSON.stringify({
      message,
      content: Buffer.from(content).toString('base64'),
      sha,
    }),
  });
  return r.json();
}

async function patchRepo(product) {
  const repo = product.slug;
  try {
    const file = await getFile(repo, 'index.html');
    if (!file?.content) {
      console.log(`  ⚠️  ${product.name}: index.html not found`);
      return;
    }

    const html = Buffer.from(file.content, 'base64').toString('utf8');

    // Match any AI_PROXY assignment (old URL or any https:// URL)
    const oldUrlMatch = html.match(/const AI_PROXY\s*=\s*['"]([^'"]+)['"]/);
    if (!oldUrlMatch) {
      console.log(`  ⚠️  ${product.name}: no AI_PROXY found — skipping`);
      return;
    }

    const oldUrl = oldUrlMatch[1];
    const newProxyUrl = `${NEW_URL}/api/ai`;

    if (oldUrl === newProxyUrl) {
      console.log(`  ✓  ${product.name}: already correct — skipping`);
      return;
    }

    const patched = html.replace(
      /const AI_PROXY\s*=\s*['"][^'"]+['"]/,
      `const AI_PROXY = '${newProxyUrl}'`
    );

    const result = await pushFile(repo, 'index.html', patched, file.sha, 'fix: update AI proxy URL to current Agent OS deployment');
    if (result.content) {
      console.log(`  ✅  ${product.name}: updated ${oldUrl} → ${newProxyUrl}`);
    } else {
      console.log(`  ✗  ${product.name}: push failed — ${JSON.stringify(result).slice(0, 100)}`);
    }
  } catch (e) {
    console.log(`  ✗  ${product.name}: ${e.message}`);
  }
}

// Run sequentially to avoid GitHub rate limits
for (const product of portfolio) {
  await patchRepo(product);
  await new Promise(r => setTimeout(r, 500)); // 500ms between pushes
}

console.log('\nDone. Vercel will auto-redeploy each repo within ~30s.');
console.log('Verify: curl -s https://YOUR_PRODUCT.vercel.app | grep AI_PROXY');
