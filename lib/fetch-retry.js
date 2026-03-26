// lib/fetch-retry.js — Exponential backoff retry for all external fetch calls
// Usage: import { fetchWithRetry } from '../lib/fetch-retry.js';
//        const res = await fetchWithRetry(url, options);  // retries 3× by default

/**
 * Fetch with automatic exponential backoff.
 * Retries on:
 *   - Network errors (DNS failure, connection refused, ECONNRESET)
 *   - HTTP 429 (rate limited) — respects Retry-After header
 *   - HTTP 500–599 (server errors) — transient infra blips
 *
 * Does NOT retry on 4xx client errors (except 429) since retrying won't help.
 *
 * @param {string} url
 * @param {RequestInit} options  — standard fetch options
 * @param {number} maxRetries    — default 3 (4 total attempts)
 * @param {number} baseDelayMs   — default 1000ms; doubles each retry
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, options = {}, maxRetries = 3, baseDelayMs = 1000) {
  let lastErr;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, options);

      // 429 — rate limited: respect Retry-After header or use exponential backoff
      if (res.status === 429) {
        if (attempt >= maxRetries) return res; // return so caller sees the 429
        const retryAfter = parseInt(res.headers?.get?.('retry-after') || '0', 10);
        const delay = retryAfter > 0
          ? retryAfter * 1000
          : baseDelayMs * Math.pow(2, attempt);
        await sleep(Math.min(delay, 60_000)); // cap at 60s
        continue;
      }

      // 5xx — server error: retry with backoff
      if (res.status >= 500 && res.status < 600) {
        if (attempt >= maxRetries) return res; // return so caller sees the 5xx
        await sleep(baseDelayMs * Math.pow(2, attempt));
        continue;
      }

      return res; // 2xx, 3xx, 4xx (non-429) — return as-is

    } catch (e) {
      // Network-level errors (ECONNRESET, ENOTFOUND, fetch failed, etc.)
      lastErr = e;
      if (attempt < maxRetries) {
        await sleep(baseDelayMs * Math.pow(2, attempt));
      }
    }
  }

  throw lastErr || new Error(`fetchWithRetry: all ${maxRetries + 1} attempts failed for ${url}`);
}

/**
 * Convenience wrapper: POST JSON with retry.
 * Returns parsed JSON body or throws with HTTP status + body context.
 */
export async function postJSON(url, body, headers = {}, maxRetries = 3) {
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }, maxRetries);

  if (!res.ok) {
    let detail = '';
    try { detail = await res.text(); } catch (_) {}
    throw new Error(`POST ${url} → ${res.status}: ${detail.slice(0, 200)}`);
  }
  return res.json();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
