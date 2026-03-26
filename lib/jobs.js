// lib/jobs.js — Build job management (Supabase 'builds' table)
// Shared by api/build.js and api/analytics.js

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL or SUPABASE_SERVICE_KEY not set');
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
  return {
    async select(table, filters = '') {
      const r = await fetch(`${url}/rest/v1/${table}${filters}`, { headers });
      if (!r.ok) throw new Error(`Supabase GET ${table}: ${r.status}`);
      return r.json();
    },
    async upsert(table, row) {
      const r = await fetch(`${url}/rest/v1/${table}`, { method: 'POST', headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(row) });
      if (!r.ok) throw new Error(`Supabase UPSERT ${table}: ${r.status} — ${await r.text()}`);
      return r.json();
    },
    async update(table, id, patch) {
      const r = await fetch(`${url}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers, body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }) });
      if (!r.ok) throw new Error(`Supabase UPDATE ${table}: ${r.status}`);
      return r.json();
    },
  };
}

export async function createJob(jobId, slug, keyword) {
  const sb = getSupabase();
  const row = { id: jobId, slug, keyword, status: 'pending', started_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  const result = await sb.upsert('builds', row);
  return Array.isArray(result) ? result[0] : result;
}

export async function getJob(jobId) {
  if (!jobId) throw new Error('jobId required');
  const sb = getSupabase();
  const rows = await sb.select('builds', `?id=eq.${encodeURIComponent(jobId)}&limit=1`);
  return rows?.[0] || null;
}

export async function updateJob(jobId, patch) {
  const sb = getSupabase();
  return sb.update('builds', jobId, patch);
}

export async function listJobs(limit = 20) {
  const sb = getSupabase();
  return sb.select('builds', `?order=started_at.desc&limit=${limit}`);
}

export async function checkDuplicate(slug) {
  if (!slug) return { duplicate: false };
  const today = new Date().toISOString().slice(0, 10);
  const jobId = `${slug}-${today}`;
  const existing = await getJob(jobId).catch(() => null);
  if (!existing) return { duplicate: false, jobId };
  if (existing.status === 'failed') return { duplicate: false, jobId };
  return { duplicate: true, jobId, status: existing.status, product: existing.phase3_data?.product };
}
