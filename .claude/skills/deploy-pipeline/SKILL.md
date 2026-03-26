# SKILL: deploy-pipeline
# Trigger: "deploy this", "push to Vercel", "redeploy", "update live URL", "inject payment links"
# Use for deploying or redeploying an existing product.

## Overview
Takes an existing GitHub repo → ensures Vercel project exists → triggers deploy → polls until live.
Also handles: injecting new payment links into existing HTML, redeploying after code changes.

## Pre-Deploy Checklist
```
[ ] Read current index.html from GitHub (check sha for updates)
[ ] Verify Stripe payment link is real (contains 'buy.stripe.com' or 'payment_links')
[ ] Verify Gumroad link is real (contains 'gumroad.com/l/')
[ ] Verify PostHog key is set (not empty string)
[ ] Run validateCode() — no Node.js APIs, </html> present
[ ] File size sanity check: 10KB–200KB (too small = incomplete, too large = bloated)
```

## Inject Payment Links (most common operation)
```js
// Read current HTML from GitHub
const fileData = await apiCall('/api/github', { action: 'getFile', owner, repo, path: 'index.html' });
const currentHtml = atob(fileData.content);  // base64 decode
const sha = fileData.sha;

// Replace placeholder URLs with real ones
const updatedHtml = currentHtml
  .replace(/STRIPE_LINK_PRO:.*?".*?"/,  `STRIPE_LINK_PRO: "${stripeUrl}"`)
  .replace(/GUMROAD_LINK:.*?".*?"/,     `GUMROAD_LINK: "${gumroadUrl}"`)
  .replace(/POSTHOG_WRITE_KEY:.*?".*?"/, `POSTHOG_WRITE_KEY: "${posthogKey}"`);

// Push update
await apiCall('/api/github', {
  action: 'pushFile', owner, repo, path: 'index.html',
  content: updatedHtml,
  sha,  // required for updates
  message: 'feat: inject real payment links'
});
// Vercel auto-deploys on push — no manual trigger needed
```

## Create New Vercel Project (first deploy)
```js
await apiCall('/api/deploy', {
  action: 'createProject',
  name: slug,
  repo: `${githubUsername}/${slug}`,
});
// Returns: { projectId, deploymentId }
// Then poll:
await apiCall('/api/deploy', { action: 'checkStatus', projectId });
// Poll every 10s until status === 'READY' or timeout at 90s
```

## Poll Until Live
```js
const liveUrl = await pollDeployment(slug, 120);  // 120s max

async function pollDeployment(slug, timeoutSec) {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    const status = await apiCall('/api/deploy', { action: 'checkStatus', name: slug });
    if (status.state === 'READY') return `https://${slug}.vercel.app`;
    if (status.state === 'ERROR') throw new Error(`Vercel deployment failed: ${status.errorCode}`);
    await new Promise(r => setTimeout(r, 10000));
  }
  throw new Error(`Deployment timeout after ${timeoutSec}s`);
}
```

## Verify Live
```js
const check = await fetch(`https://${slug}.vercel.app`);
if (!check.ok) throw new Error(`Live URL returned ${check.status}`);
console.log(`✓ Live at https://${slug}.vercel.app`);
```

## Common Issues
| Problem | Solution |
|---------|----------|
| "Project already exists" | Get existing project ID, trigger new deployment instead |
| Deploy stuck in BUILDING | Usually resolves in 60-90s. Wait and re-poll. |
| SHA mismatch on GitHub push | Re-fetch the file to get current SHA |
| Vercel 402 (payment required) | Team has hit free tier limit — check Vercel dashboard |
| HTML not updating after push | Vercel cache — append `?v=${Date.now()}` to test URL |
