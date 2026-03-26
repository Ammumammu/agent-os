// api/deploy.js — Vercel Deployment Operations
// Actions: createProject, triggerDeploy, getStatus, getAnalytics, listProjects, deleteProject

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, ...p } = req.body || {};
  const KEY = process.env.VERCEL_API_KEY;
  const TEAM = process.env.VERCEL_TEAM_ID;
  const BASE = 'https://api.vercel.com';
  const teamQ = TEAM ? `?teamId=${TEAM}` : '';
  const h = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

  const actions = {
    // Create a new Vercel project linked to a GitHub repo
    createProject: () => fetch(`${BASE}/v9/projects${teamQ}`, {
      method: 'POST', headers: h,
      body: JSON.stringify({
        name: p.name,
        framework: null,
        gitRepository: {
          type: 'github',
          repo: p.repo, // format: "owner/repo-name"
        },
        buildCommand: null,
        outputDirectory: null,
        rootDirectory: null,
      }),
    }),

    // Trigger a new deployment for a project
    triggerDeploy: () => fetch(`${BASE}/v13/deployments${teamQ}`, {
      method: 'POST', headers: h,
      body: JSON.stringify({
        name: p.name,
        gitSource: {
          type: 'github',
          org: p.owner || process.env.GITHUB_USERNAME,
          repo: p.repo,
          ref: p.branch || 'main',
        },
        target: 'production',
      }),
    }),

    // Get deployment status
    getStatus: () => fetch(`${BASE}/v13/deployments/${p.deploymentId || p.name}${teamQ}`, { headers: h }),

    // Get project info + latest deployment URL
    getProject: () => fetch(`${BASE}/v9/projects/${p.name}${teamQ}`, { headers: h }),

    // List all projects
    listProjects: () => fetch(`${BASE}/v9/projects${teamQ}&limit=100`, { headers: h }),

    // Get project analytics (page views etc.)
    getAnalytics: () => fetch(`${BASE}/v1/analytics${teamQ}&projectId=${p.projectId}&from=${p.from || Date.now() - 86400000}&to=${p.to || Date.now()}`, { headers: h }),

    // Delete project (for cleanup)
    deleteProject: () => fetch(`${BASE}/v9/projects/${p.name}${teamQ}`, { method: 'DELETE', headers: h }),

    // Poll until deployment is live (blocking — returns URL when ready)
    pollUntilLive: async () => {
      const maxAttempts = p.maxAttempts || 24; // 24 × 5s = 120s max
      const interval = p.intervalMs || 5000;

      for (let i = 0; i < maxAttempts; i++) {
        try {
          const r = await fetch(`${BASE}/v9/projects/${p.name}${teamQ}`, { headers: h });
          const project = await r.json();
          const latestDeploy = project.latestDeployments?.[0];

          if (latestDeploy?.readyState === 'READY') {
            // Use production alias (stable), not deployment-hash URL (changes every deploy)
            // Vercel scoped projects: {slug}-{scope}.vercel.app
            const scope = process.env.VERCEL_SCOPE || TEAM || '';
            const fallbackDomain = scope ? `${p.name}-${scope}.vercel.app` : `${p.name}.vercel.app`;
            const productionAlias = project.alias?.[0]?.domain
              || project.targets?.production?.alias?.[0]
              || fallbackDomain;
            const url = `https://${productionAlias}`;
            const deployUrl = `https://${latestDeploy.url}`;
            return new Response(JSON.stringify({ url, deployUrl, ready: true, attempts: i + 1 }), { status: 200 });
          }
          if (latestDeploy?.readyState === 'ERROR') {
            return new Response(JSON.stringify({
              ready: false, error: 'Deployment failed',
              state: latestDeploy.readyState, attempts: i + 1,
            }), { status: 500 });
          }
        } catch (_) {}
        await sleep(interval);
      }
      // Timeout — try to return URL anyway (project might be live even if poll timed out)
      const scope = process.env.VERCEL_SCOPE || TEAM || '';
      const fallbackUrl = scope ? `https://${p.name}-${scope}.vercel.app` : `https://${p.name}.vercel.app`;
      return new Response(JSON.stringify({ ready: false, error: 'Poll timeout', url: fallbackUrl }), { status: 408 });
    },

    // Deploy files directly without GitHub (no GitHub App needed)
    // p.name = project/deployment name, p.files = [{ path, content }]
    deployFiles: async () => {
      const { createHash } = await import('crypto');
      const files = p.files || [];

      // Step 1: Create/ensure project exists (no GitHub needed)
      await fetch(`${BASE}/v9/projects${teamQ}`, {
        method: 'POST', headers: h,
        body: JSON.stringify({ name: p.name, framework: null }),
      });

      // Step 2: Disable deployment protection so pages are publicly accessible
      await fetch(`${BASE}/v9/projects/${p.name}${teamQ}`, {
        method: 'PATCH', headers: h,
        body: JSON.stringify({ ssoProtection: null, passwordProtection: null }),
      });

      // Step 3: Upload each file (SHA1 deduplication)
      const uploadedFiles = [];
      for (const f of files) {
        const buf = Buffer.from(f.content, 'utf8');
        const size = buf.length;
        const sha = createHash('sha1').update(buf).digest('hex');
        await fetch(`${BASE}/v2/files${teamQ}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${KEY}`,
            'Content-Type': 'application/octet-stream',
            'x-vercel-digest': sha,
            'x-vercel-size': String(size),
          },
          body: buf,
        });
        uploadedFiles.push({ file: f.path, sha, size });
      }

      // Step 4: Create production deployment linked to project
      const deployRes = await fetch(`${BASE}/v13/deployments${teamQ}`, {
        method: 'POST', headers: h,
        body: JSON.stringify({
          name: p.name,
          files: uploadedFiles,
          projectSettings: { framework: null },
          target: 'production',
        }),
      });
      return deployRes;
    },

    // Set environment variables on a project
    setEnvVars: () => fetch(`${BASE}/v9/projects/${p.name}/env${teamQ}`, {
      method: 'POST', headers: h,
      body: JSON.stringify((p.vars || []).map(v => ({
        key: v.key,
        value: v.value,
        type: 'encrypted',
        target: ['production', 'preview'],
      }))),
    }),

    // Get domains for a project
    getDomains: () => fetch(`${BASE}/v9/projects/${p.name}/domains${teamQ}`, { headers: h }),

    // run = alias for listProjects (agent dashboard "▶ Run" button)
    run: () => fetch(`${BASE}/v9/projects${teamQ}&limit=100`, { headers: h }),
  };

  try {
    const actionFn = actions[action];
    if (!actionFn) return res.status(400).json({ error: `Unknown action: ${action}` });
    const r = await actionFn();
    if (!r || typeof r.json !== 'function') {
      const text = await r.text();
      return res.status(r.status).json(JSON.parse(text));
    }
    const data = await r.json();
    return res.status(r.ok ? 200 : r.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
