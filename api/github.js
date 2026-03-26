// api/github.js — GitHub Operations
// Actions: createRepo, pushFile, updateFile, getFile, getStats, listRepos, createBranch

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, ...p } = req.body;
  const TOKEN = process.env.GITHUB_TOKEN;
  const BASE = 'https://api.github.com';
  const h = {
    Authorization: `token ${TOKEN}`,
    'Content-Type': 'application/json',
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  const actions = {
    createRepo: () => fetch(`${BASE}/user/repos`, {
      method: 'POST', headers: h,
      body: JSON.stringify({
        name: p.name,
        description: p.description || '',
        private: false,
        auto_init: false,
        has_issues: false,
        has_wiki: false,
      }),
    }),

    pushFile: async () => {
      // Get existing SHA if file exists (required for updates)
      let sha;
      try {
        const existing = await fetch(`${BASE}/repos/${p.owner}/${p.repo}/contents/${p.path}`, { headers: h });
        if (existing.ok) {
          const d = await existing.json();
          sha = d.sha;
        }
      } catch (_) {}
      return fetch(`${BASE}/repos/${p.owner}/${p.repo}/contents/${p.path}`, {
        method: 'PUT', headers: h,
        body: JSON.stringify({
          message: p.message || 'chore: update',
          content: Buffer.from(p.content).toString('base64'),
          ...(sha ? { sha } : {}),
          ...(p.branch ? { branch: p.branch } : {}),
        }),
      });
    },

    getFile: () => fetch(`${BASE}/repos/${p.owner}/${p.repo}/contents/${p.path}`, { headers: h }),

    getStats: () => fetch(`${BASE}/repos/${p.owner}/${p.repo}`, { headers: h }),

    listRepos: () => fetch(`${BASE}/users/${p.username || p.owner}/repos?type=public&sort=created&per_page=100`, { headers: h }),

    deleteRepo: () => fetch(`${BASE}/repos/${p.owner}/${p.repo}`, { method: 'DELETE', headers: h }),

    createBranch: async () => {
      // Get default branch SHA first
      const repoR = await fetch(`${BASE}/repos/${p.owner}/${p.repo}`, { headers: h });
      const repo = await repoR.json();
      const defaultBranch = repo.default_branch || 'main';
      const refR = await fetch(`${BASE}/repos/${p.owner}/${p.repo}/git/refs/heads/${defaultBranch}`, { headers: h });
      const ref = await refR.json();
      return fetch(`${BASE}/repos/${p.owner}/${p.repo}/git/refs`, {
        method: 'POST', headers: h,
        body: JSON.stringify({ ref: `refs/heads/${p.branch}`, sha: ref.object.sha }),
      });
    },

    // Push multiple files at once (for batch SEO page deployment)
    pushMultipleFiles: async () => {
      const results = [];
      for (const file of (p.files || [])) {
        try {
          let sha;
          try {
            const ex = await fetch(`${BASE}/repos/${p.owner}/${p.repo}/contents/${file.path}`, { headers: h });
            if (ex.ok) sha = (await ex.json()).sha;
          } catch (_) {}
          const r = await fetch(`${BASE}/repos/${p.owner}/${p.repo}/contents/${file.path}`, {
            method: 'PUT', headers: h,
            body: JSON.stringify({
              message: file.message || `feat: add ${file.path}`,
              content: Buffer.from(file.content).toString('base64'),
              ...(sha ? { sha } : {}),
            }),
          });
          results.push({ path: file.path, status: r.ok ? 'pushed' : 'failed', code: r.status });
        } catch (e) {
          results.push({ path: file.path, status: 'error', error: e.message });
        }
      }
      return new Response(JSON.stringify({ results, total: results.length }), { status: 200 });
    },
  };

  try {
    const actionFn = actions[action];
    if (!actionFn) return res.status(400).json({ error: `Unknown action: ${action}` });
    const r = await actionFn();
    if (!r || typeof r.json !== 'function') return res.json(r); // pushMultipleFiles returns raw Response
    const data = await r.json();
    // 409/422 on createRepo = repo already exists, treat as success
    const repoExists = action === 'createRepo' && (r.status === 409 || (r.status === 422 && data?.errors?.[0]?.message?.includes('already exists')));
    const status = repoExists ? 200 : (r.ok ? 200 : r.status);
    return res.status(status).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
