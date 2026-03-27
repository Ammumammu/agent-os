#!/usr/bin/env node
// agents/traffic-agent.js — 100% Autonomous Viral Distribution Engine (v3)
// FIXED: All channel posts run directly — no Vercel API hop — no 405/timeout errors
//
// Auto channels (all run WITHOUT human action):
//  ✅ Dev.to            — publish article via Dev.to API
//  ✅ Hashnode          — publish article via GraphQL
//  ✅ Medium            — publish article via Integration Token
//  ✅ Twitter/X         — schedule thread via Typefully API
//  ✅ Reddit            — post via Reddit OAuth API
//  ✅ LinkedIn          — post via LinkedIn UGC API
//  ✅ Hacker News       — Show HN post via session auth
//  ✅ Telegram          — post to channel via Bot API
//  ✅ Backlinks         — ping Google + IndexNow + Bing
//  ✅ Newsletter        — blast Supabase leads via Resend batch

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { fetchWithRetry } from '../lib/fetch-retry.js';
import { sendAlert } from '../lib/alert.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.AGENT_OS_URL || 'https://agent-os-seven.vercel.app';
const LAUNCHED_FILE = join(__dirname, '../products/launched-products.json');
const PORTFOLIO_FILE = join(__dirname, '../public/portfolio.json');
const TRAFFIC_LOG = join(__dirname, '../products/traffic-agent.log');
const RESULTS_FILE = join(__dirname, '../products/distribution-results.json');

// ─── GROQ — direct call used for all content generation ──────────────────────
const GROQ_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
async function groq(prompt, maxTokens = 2000) {
  let lastErr;
  for (const model of GROQ_MODELS) {
    try {
      const r = await fetchWithRetry('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.75,
          max_tokens: maxTokens,
        }),
      });
      const d = await r.json();
      if (d.error) { lastErr = d.error.message; if (d.error.code === 'rate_limit_exceeded') await sleep(3000); continue; }
      const text = d.choices?.[0]?.message?.content || '';
      if (text) return text;
    } catch (e) { lastErr = e.message; }
  }
  throw new Error(lastErr || 'All Groq models failed');
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
async function run() {
  log('🚀 traffic-agent v3 — 100% AUTONOMOUS, direct API calls');
  log(`   Base: ${BASE_URL}`);

  const channelStatus = getChannelStatus();
  const activeChannels = Object.entries(channelStatus).filter(([, v]) => v).map(([k]) => k);
  log(`   Active channels: ${activeChannels.join(', ')}`);

  const products = getProductsToDistribute();
  if (!products.length) { log('⚠️  No products to distribute today.'); return; }
  log(`   Products: ${products.map(p => p.name).join(', ')}`);

  const allResults = [];

  for (const product of products) {
    log(`\n${'─'.repeat(60)}`);
    log(`📦 Distributing: ${product.name}`);
    log(`${'─'.repeat(60)}`);
    try {
      const result = await distributeProduct(product);
      allResults.push({ product: product.slug, ...result });
      await sleep(4000);
    } catch (e) {
      log(`  💥 Failed: ${e.message}`);
      allResults.push({ product: product.slug, error: e.message });
    }
  }

  writeFileSync(RESULTS_FILE, JSON.stringify({
    run_at: new Date().toISOString(),
    products_count: products.length,
    results: allResults,
  }, null, 2));

  const totalHits = allResults.reduce((s, r) => s + (r.channels_hit || 0), 0);
  log(`\n${'═'.repeat(60)}`);
  log(`✅ traffic-agent v3 COMPLETE`);
  log(`   Products distributed : ${products.length}`);
  log(`   Total channel posts  : ${totalHits}`);
  log(`${'═'.repeat(60)}`);

  // Report missing channels
  const missing = Object.entries(channelStatus).filter(([, v]) => !v);
  if (missing.length) {
    log(`\n⚡ UNLOCK MORE CHANNELS (add env vars):`);
    const instructions = {
      twitter: 'TYPEFULLY_API_KEY → free.typefully.com',
      reddit: 'REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET + REDDIT_USERNAME + REDDIT_PASSWORD → reddit.com/prefs/apps',
      linkedin: 'LINKEDIN_ACCESS_TOKEN + LINKEDIN_PERSON_URN → developers.linkedin.com',
      medium: 'MEDIUM_INTEGRATION_TOKEN → medium.com/me/settings',
      hackernews: 'HN_USERNAME + HN_PASSWORD → your HN account',
      telegram: 'TELEGRAM_BOT_TOKEN + TELEGRAM_CHANNEL_ID → t.me/BotFather',
    };
    missing.forEach(([ch]) => { if (instructions[ch]) log(`   ${instructions[ch]}`); });
  }

  return { products_count: products.length, total_channel_posts: totalHits, results: allResults };
}

// ─── Distribute a single product across all channels ─────────────────────────
async function distributeProduct(product) {
  const channelResults = {};
  let channelsHit = 0;

  // Generate all content first (async parallel for speed)
  log(`  📝 Generating content...`);
  const [article, twitterThread, redditPost, linkedInPost, mediumPost] = await Promise.allSettled([
    generateArticle(product),
    process.env.TYPEFULLY_API_KEY ? generateTwitterThread(product) : Promise.resolve(''),
    process.env.REDDIT_CLIENT_ID ? generateRedditPost(product) : Promise.resolve(''),
    process.env.LINKEDIN_ACCESS_TOKEN ? generateLinkedInPost(product) : Promise.resolve(''),
    process.env.MEDIUM_INTEGRATION_TOKEN ? generateMediumArticle(product) : Promise.resolve(''),
  ]);

  const articleText = article.status === 'fulfilled' ? article.value : '';
  const twitterText = twitterThread.status === 'fulfilled' ? twitterThread.value : '';
  const redditText = redditPost.status === 'fulfilled' ? redditPost.value : '';
  const linkedInText = linkedInPost.status === 'fulfilled' ? linkedInPost.value : '';
  const mediumText = mediumPost.status === 'fulfilled' ? mediumPost.value : '';

  // ── TIER 1: Always active ─────────────────────────────────────────────────

  // Dev.to
  if (articleText) {
    const r = await publishToDevTo(product, articleText).catch(e => ({ error: e.message }));
    channelResults.devto = r;
    if (r.url) { log(`  ✅ Dev.to: ${r.url}`); channelsHit++; }
    else if (r.skipped) log(`  ⏭️  Dev.to: ${r.reason}`);
    else log(`  ⚠️  Dev.to: ${r.error || 'unknown error'}`);
  }

  // Hashnode
  if (articleText) {
    const r = await publishToHashnode(product, articleText).catch(e => ({ error: e.message }));
    channelResults.hashnode = r;
    if (r.url) { log(`  ✅ Hashnode: ${r.url}`); channelsHit++; }
    else if (r.skipped) log(`  ⏭️  Hashnode: ${r.reason}`);
    else log(`  ⚠️  Hashnode: ${r.error || 'unknown error'}`);
  }

  // Backlinks (always)
  const backlinks = await pingBacklinks(product).catch(() => ({}));
  channelResults.backlinks = backlinks;
  if (backlinks.pinged_at) { log(`  ✅ Backlinks: pinged`); channelsHit++; }

  // ── TIER 2: Optional channels (enabled by env vars) ───────────────────────

  // Twitter/X via Typefully
  if (process.env.TYPEFULLY_API_KEY && twitterText) {
    const r = await postToTypefully(twitterText).catch(e => ({ error: e.message }));
    channelResults.twitter = r;
    if (r.scheduled_at) { log(`  ✅ Twitter: scheduled → ${r.scheduled_at}`); channelsHit++; }
    else log(`  ⚠️  Twitter: ${r.error || 'failed'}`);
  }

  // Reddit
  if (process.env.REDDIT_CLIENT_ID && redditText) {
    const r = await postToReddit(product, redditText).catch(e => ({ error: e.message }));
    channelResults.reddit = r;
    if (r.post_url) { log(`  ✅ Reddit: ${r.post_url}`); channelsHit++; }
    else log(`  ⚠️  Reddit: ${r.error || 'failed'}`);
  }

  // LinkedIn
  if (process.env.LINKEDIN_ACCESS_TOKEN && linkedInText) {
    const r = await postToLinkedIn(linkedInText).catch(e => ({ error: e.message }));
    channelResults.linkedin = r;
    if (r.post_id) { log(`  ✅ LinkedIn: post_id=${r.post_id}`); channelsHit++; }
    else if (r.skipped && r.reason === 'token_expired') log(`  🔑 LinkedIn: token expired — alert sent`);
    else if (r.skipped) log(`  ⏭️  LinkedIn: ${r.reason}`);
    else log(`  ⚠️  LinkedIn: ${r.error || 'failed'}`);
  }

  // Medium
  if (process.env.MEDIUM_INTEGRATION_TOKEN && mediumText) {
    const r = await postToMedium(product, mediumText).catch(e => ({ error: e.message }));
    channelResults.medium = r;
    if (r.url) { log(`  ✅ Medium: ${r.url}`); channelsHit++; }
    else if (r.skipped && r.reason === 'token_expired') log(`  🔑 Medium: token expired — alert sent`);
    else if (r.skipped) log(`  ⏭️  Medium: ${r.reason}`);
    else log(`  ⚠️  Medium: ${r.error || 'failed'}`);
  }

  // Hacker News
  if (process.env.HN_USERNAME) {
    const r = await postToHackerNews(product).catch(e => ({ error: e.message }));
    channelResults.hackernews = r;
    if (r.url && r.url !== 'posted') { log(`  ✅ HN: ${r.url}`); channelsHit++; }
    else if (r.error) log(`  ⚠️  HN: ${r.error}`);
    else { log(`  ✅ HN: submitted`); channelsHit++; }
  }

  // Telegram
  if (process.env.TELEGRAM_BOT_TOKEN) {
    const r = await postToTelegram(product).catch(e => ({ error: e.message }));
    channelResults.telegram = r;
    if (r.ok) { log(`  ✅ Telegram: msg ${r.message_id}`); channelsHit++; }
    else log(`  ⚠️  Telegram: ${r.error || 'failed'}`);
  }

  // Newsletter blast via Resend
  const newsletter = await sendNewsletterBlast(product).catch(e => ({ error: e.message }));
  channelResults.newsletter = newsletter;
  if (newsletter.sent_to) { log(`  ✅ Newsletter: sent to ${newsletter.sent_to} subscribers`); channelsHit++; }
  else log(`  📧 Newsletter: ${newsletter.reason || newsletter.error || 'no leads yet'}`);

  return { channels_hit: channelsHit, total_channels: Object.keys(channelResults).length, results: channelResults };
}

// ════════════════════════════════════════════════════════════════════════════
// CHANNEL IMPLEMENTATIONS (direct API calls — no Vercel hop)
// ════════════════════════════════════════════════════════════════════════════

async function publishToDevTo(product, markdown) {
  const key = process.env.DEVTO_API_KEY;
  if (!key) return { skipped: true, reason: 'DEVTO_API_KEY not set' };
  const body = JSON.stringify({
    article: {
      title: `I built ${product.name} — ${product.tagline}`,
      body_markdown: markdown,
      published: true,
      tags: ['saas', 'tools', 'ai', product.category || 'productivity'],
    }
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch('https://dev.to/api/articles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': key },
      body,
    });
    if (r.status === 429) {
      const retryAfter = parseInt(r.headers.get('retry-after') || '30', 10);
      const waitMs = Math.min(retryAfter * 1000, 30000); // cap at 30s
      if (attempt === 0) { await sleep(waitMs); continue; }
      return { skipped: true, reason: `Dev.to rate limited — retry in ${retryAfter}s` };
    }
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `Dev.to ${r.status}`);
    return { url: data.url, id: data.id, platform: 'devto' };
  }
  return { skipped: true, reason: 'Dev.to rate limited' };
}

async function publishToHashnode(product, markdown) {
  const token = process.env.HASHNODE_TOKEN;
  const pubId = process.env.HASHNODE_PUBLICATION_ID;
  if (!token || !pubId) return { skipped: true, reason: 'HASHNODE_TOKEN or HASHNODE_PUBLICATION_ID not set' };
  const r = await fetch('https://gql.hashnode.com', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: token },
    body: JSON.stringify({
      query: `mutation PublishPost($input: PublishPostInput!) { publishPost(input: $input) { post { id url } } }`,
      variables: {
        input: {
          title: `I built ${product.name} — ${product.tagline}`,
          contentMarkdown: markdown,
          publicationId: pubId,
          tags: [{ slug: 'saas', name: 'SaaS' }, { slug: 'ai', name: 'AI' }],
        }
      },
    }),
  });
  const data = await r.json();
  const post = data?.data?.publishPost?.post;
  if (!post) throw new Error(JSON.stringify(data?.errors?.[0] || 'Hashnode failed'));
  return { url: post.url, id: post.id, platform: 'hashnode' };
}

async function postToTypefully(content) {
  const r = await fetch('https://api.typefully.com/v1/drafts/', {
    method: 'POST',
    headers: { 'X-API-KEY': `Bearer ${process.env.TYPEFULLY_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, schedule_date: nextBestPostTime(), auto_retweet_enabled: false }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || `Typefully ${r.status}`);
  return { platform: 'twitter', scheduled_at: data.scheduled_date, draft_id: data.id };
}

async function postToReddit(product, copy) {
  const { REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD } = process.env;
  const tokenRes = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': `agent-os/1.0 by ${REDDIT_USERNAME}`,
    },
    body: new URLSearchParams({ grant_type: 'password', username: REDDIT_USERNAME, password: REDDIT_PASSWORD }),
  });
  const { access_token } = await tokenRes.json();
  if (!access_token) throw new Error('Reddit auth failed — check credentials');

  const subreddit = guessSubreddit(product);
  const submitRes = await fetch('https://oauth.reddit.com/api/submit', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${access_token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': `agent-os/1.0 by ${REDDIT_USERNAME}`,
    },
    body: new URLSearchParams({
      kind: 'self',
      sr: subreddit,
      title: `I built ${product.name} — ${product.tagline}`,
      text: copy,
      nsfw: 'false',
      spoiler: 'false',
      resubmit: 'true',
    }),
  });
  const data = await submitRes.json();
  const errors = data?.json?.errors;
  if (errors?.length) throw new Error(errors.map(e => e[1]).join('; '));
  const postUrl = data?.json?.data?.url;
  return { platform: 'reddit', subreddit, post_url: postUrl || 'posted' };
}

// ── TOKEN EXPIRY HELPERS ────────────────────────────────────────────────────
// LinkedIn OAuth tokens expire every 60 days.
// Medium Integration Tokens do not expire, but can be revoked.
// Both return 401 when expired/revoked — we detect this and alert with
// clear instructions instead of crashing or silently failing.

function isAuthError(status) {
  return status === 401 || status === 403;
}

async function handleTokenExpiry(platform, status, detail = '') {
  const instructions = {
    linkedin: [
      'LinkedIn OAuth token expired (tokens last 60 days).',
      'To refresh: go to https://www.linkedin.com/developers/apps → your app → Auth tab → request new token',
      'Or re-run the OAuth flow and update LINKEDIN_ACCESS_TOKEN in GitHub Secrets.',
    ].join(' '),
    medium: [
      'Medium Integration Token rejected (revoked or invalid).',
      'To refresh: go to https://medium.com/me/settings → Integration Tokens → generate new token',
      'Update MEDIUM_INTEGRATION_TOKEN in GitHub Secrets.',
    ].join(' '),
  };

  const msg = instructions[platform] || `${platform} auth failed (${status})`;
  log(`  🔑 ${platform.toUpperCase()} TOKEN EXPIRED: ${msg}`);

  await sendAlert('traffic-agent', `${platform} token expired or revoked`, {
    platform,
    status,
    detail: detail.slice(0, 300),
    action: instructions[platform] || 'Refresh the token in GitHub Secrets',
  });

  // Return a structured skip result (caller logs this, doesn't throw)
  return { skipped: true, reason: `token_expired`, platform, instructions: msg };
}

async function postToLinkedIn(text) {
  const TOKEN = process.env.LINKEDIN_ACCESS_TOKEN;
  const URN = process.env.LINKEDIN_PERSON_URN;

  const r = await fetchWithRetry('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify({
      author: URN,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text },
          shareMediaCategory: 'NONE',
        },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    }),
  });

  if (isAuthError(r.status)) {
    const detail = await r.text().catch(() => '');
    return handleTokenExpiry('linkedin', r.status, detail);
  }

  const data = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(data).slice(0, 300));
  return { platform: 'linkedin', post_id: data.id };
}

async function postToMedium(product, content) {
  const TOKEN = process.env.MEDIUM_INTEGRATION_TOKEN;

  // Resolve user ID (required for post endpoint)
  let userId = process.env.MEDIUM_USER_ID;
  if (!userId) {
    const me = await fetchWithRetry('https://api.medium.com/v1/me', {
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    });

    if (isAuthError(me.status)) {
      const detail = await me.text().catch(() => '');
      return handleTokenExpiry('medium', me.status, detail);
    }

    const meData = await me.json();
    userId = meData?.data?.id;
    if (!userId) throw new Error(`Could not resolve Medium user ID: ${JSON.stringify(meData).slice(0, 200)}`);
  }

  const r = await fetchWithRetry(`https://api.medium.com/v1/users/${userId}/posts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: `I built ${product.name} — and here's what happened`,
      contentFormat: 'markdown',
      content,
      tags: ['saas', 'programming', 'ai', 'startups'],
      publishStatus: 'public',
    }),
  });

  if (isAuthError(r.status)) {
    const detail = await r.text().catch(() => '');
    return handleTokenExpiry('medium', r.status, detail);
  }

  const data = await r.json();
  if (data.errors) throw new Error(data.errors[0]?.message || 'Medium failed');
  return { platform: 'medium', url: data?.data?.url, id: data?.data?.id };
}

async function postToHackerNews(product) {
  const HN_USER = process.env.HN_USERNAME;
  const HN_PASS = process.env.HN_PASSWORD;
  const loginRes = await fetch('https://news.ycombinator.com/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ acct: HN_USER, pw: HN_PASS, goto: 'news' }),
    redirect: 'manual',
  });
  const cookie = loginRes.headers.get('set-cookie');
  if (!cookie) return { error: 'HN login failed — check credentials' };

  const submitPage = await fetch('https://news.ycombinator.com/submit', { headers: { Cookie: cookie } });
  const html = await submitPage.text();
  const fnidMatch = html.match(/name="fnid" value="([^"]+)"/);
  if (!fnidMatch) return { error: 'Could not get HN CSRF token' };

  const postRes = await fetch('https://news.ycombinator.com/r', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: new URLSearchParams({
      fnid: fnidMatch[1],
      fnop: 'submit-page',
      title: `Show HN: ${product.name} – ${product.tagline}`.slice(0, 80),
      url: product.vercel_url,
      text: '',
    }),
    redirect: 'manual',
  });
  const location = postRes.headers.get('location');
  const postId = location?.match(/item\?id=(\d+)/)?.[1];
  return { platform: 'hackernews', url: postId ? `https://news.ycombinator.com/item?id=${postId}` : 'posted' };
}

async function postToTelegram(product) {
  const BOT = process.env.TELEGRAM_BOT_TOKEN;
  const CH = process.env.TELEGRAM_CHANNEL_ID;
  const text = `🚀 <b>${product.name}</b> just launched!\n\n` +
    `<i>${product.tagline}</i>\n\n` +
    `✅ Free to start · no account\n` +
    `💳 Unlimited: $${product.pricing?.monthly_usd || 9}/mo\n\n` +
    `👉 <a href="${product.vercel_url}">Try it free</a>`;
  const r = await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CH, text, parse_mode: 'HTML', disable_web_page_preview: false }),
  });
  const data = await r.json();
  if (!data.ok) throw new Error(data.description || 'Telegram failed');
  return { platform: 'telegram', ok: data.ok, message_id: data.result?.message_id };
}

async function pingBacklinks(product) {
  const url = encodeURIComponent(product.vercel_url);
  const pings = await Promise.allSettled([
    fetch(`https://www.google.com/ping?sitemap=${url}`).then(r => ({ service: 'google', status: r.status })),
    fetch(`https://www.bing.com/ping?sitemap=${url}`).then(r => ({ service: 'bing', status: r.status })),
  ]);

  let indexNow = null;
  if (process.env.BING_INDEXNOW_KEY) {
    const r = await fetch('https://api.indexnow.org/IndexNow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: new URL(product.vercel_url).hostname,
        key: process.env.BING_INDEXNOW_KEY,
        urlList: [product.vercel_url],
      }),
    });
    indexNow = { status: r.status };
  }

  return {
    platform: 'backlinks',
    pings: pings.map(r => r.status === 'fulfilled' ? r.value : { error: r.reason?.message }),
    indexnow: indexNow,
    pinged_at: new Date().toISOString(),
  };
}

async function sendNewsletterBlast(product) {
  const RESEND_KEY = process.env.RESEND_API_KEY;
  const FROM = process.env.RESEND_FROM_EMAIL || 'noreply@yourdomain.com';
  if (!RESEND_KEY) return { skipped: true, reason: 'RESEND_API_KEY not set' };

  // Fetch audience from Supabase
  let emails = [];
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/leads?select=email&limit=500`, {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      });
      const leads = await r.json();
      // Guard: Supabase may return an error object {code, message} instead of an array
      emails = Array.isArray(leads) ? leads.map(l => l.email).filter(Boolean) : [];
    } catch (_) { emails = []; }
  }

  if (!emails.length) return { skipped: true, reason: 'No subscribers yet' };

  const html = `<div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto">
  <p style="font-size:13px;color:#6b7280">New tool from the lab 🧪</p>
  <h2 style="margin:0 0 8px;color:#0f172a">${product.name}</h2>
  <p style="color:#374151;margin:0 0 20px">${product.tagline}</p>
  <a href="${product.vercel_url}" style="display:inline-block;background:#6366f1;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700">Try it free →</a>
  <p style="margin-top:20px;font-size:14px;color:#374151">Free · No account required</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
  <p style="font-size:12px;color:#9ca3af">You're getting this because you used one of our tools.</p>
</div>`;

  let sent = 0;
  const BATCH = 50;
  for (let i = 0; i < emails.length; i += BATCH) {
    const batch = emails.slice(i, i + BATCH);
    await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(batch.map(to => ({
        from: FROM,
        to,
        subject: `🚀 New: ${product.name} — ${product.tagline}`,
        html,
      }))),
    });
    sent += batch.length;
    await sleep(300);
  }
  return { platform: 'newsletter', sent_to: sent };
}

// ════════════════════════════════════════════════════════════════════════════
// CONTENT GENERATORS (Groq — direct)
// ════════════════════════════════════════════════════════════════════════════

async function generateArticle(product) {
  return groq(`Write a Dev.to article (700 words) about building ${product.name} (${product.vercel_url}).

## The Problem (150 words) — personal story about ${product.tagline.toLowerCase()}
## What I Tried First (150 words) — 2-3 specific tools and why each failed
## How I Built It (250 words) — React + Groq + Vercel + Stripe, 1 real code snippet
## What I Learned (100 words) — surprising insight about users or pricing
## Try It Free (50 words) — CTA to ${product.vercel_url}

Tone: honest senior developer, no marketing fluff. Include real code snippet.`);
}

async function generateTwitterThread(product) {
  return groq(`Write a viral 7-tweet thread for ${product.name} (${product.vercel_url}).
Tweet 1 (hook — no number): Bold counterintuitive claim about "${product.tagline}". ≤240 chars.
Tweet 2: Why this problem costs real time/money (specific numbers)
Tweet 3: What everyone tries — and exactly why it fails
Tweet 4: What I built + the one key technical decision
Tweet 5: Show exact example output (format like actual output, not marketing)
Tweet 6: Surprising thing I learned from first 100 users
Tweet 7: 🔗 ${product.vercel_url} — free, no account. RT if useful.
Each tweet ≤280 chars. Separated by: ---`);
}

async function generateRedditPost(product) {
  const sub = guessSubreddit(product);
  return groq(`Write an authentic Reddit post for r/${sub} about ${product.name}.
- Open with 1 personal sentence about personally experiencing "${product.tagline.toLowerCase()}"
- Paragraph 2: 2-3 tools you tried first and exactly why each failed (specific)
- Paragraph 3: What you built, how it works technically, one actual example output
- Close: "Still rough — ${product.vercel_url} if anyone wants to try it"
- ≤280 words total. No bullet points. No marketing. One admitted flaw.
- End with a question to invite replies.`);
}

async function generateLinkedInPost(product) {
  return groq(`Write a LinkedIn post (250 words) about building ${product.name}.
Line 1: Bold counterintuitive claim about "${product.tagline}" — make someone stop scrolling
[blank line], 2-3 short paragraphs: problem → what I tried → what I built
[blank line], 3 bullet points: specific things I learned
[blank line], CTA: ${product.vercel_url} — curious what you think
Tone: thoughtful founder, not salesy. Include one mistake or vulnerability.`);
}

async function generateMediumArticle(product) {
  return groq(`Write a 800-word Medium article: "I built ${product.name} in one day — here's what happened"

## The Problem (150w) — personal story about ${product.tagline.toLowerCase()}
## What I Tried First (150w) — 3 tools, why each failed specifically  
## Building It in One Day (300w) — stack, hardest technical challenge, real code snippet
## Launch Results (100w) — what surprised me about early users
## Try It (100w) — ${product.vercel_url}, free, no account

Tone: honest indie dev. No hype. Include actual code.`);
}

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

function getProductsToDistribute() {
  if (existsSync(LAUNCHED_FILE)) {
    try {
      const data = JSON.parse(readFileSync(LAUNCHED_FILE, 'utf8'));
      if ((data.products || []).length) return data.products;
    } catch (_) { }
  }
  const portfolio = getPortfolio();
  return portfolio.filter(p => p.status === 'live' && (p.visitors || 0) < 200).slice(0, 3);
}

function getPortfolio() {
  if (!existsSync(PORTFOLIO_FILE)) return [];
  try { return JSON.parse(readFileSync(PORTFOLIO_FILE, 'utf8')); } catch (_) { return []; }
}

function getChannelStatus() {
  return {
    devto: !!process.env.DEVTO_API_KEY,
    hashnode: !!(process.env.HASHNODE_TOKEN && process.env.HASHNODE_PUBLICATION_ID),
    backlinks: true,
    newsletter: !!process.env.RESEND_API_KEY,
    twitter: !!process.env.TYPEFULLY_API_KEY,
    reddit: !!process.env.REDDIT_CLIENT_ID,
    linkedin: !!process.env.LINKEDIN_ACCESS_TOKEN,
    medium: !!process.env.MEDIUM_INTEGRATION_TOKEN,
    hackernews: !!process.env.HN_USERNAME,
    telegram: !!process.env.TELEGRAM_BOT_TOKEN,
  };
}

function guessSubreddit(product) {
  const cat = (product.category || '').toLowerCase();
  const tag = (product.name + ' ' + (product.tagline || '')).toLowerCase();
  if (/resume|cv/.test(tag)) return 'resumes';
  if (/youtube|video/.test(tag)) return 'NewTubers';
  if (/seo|rank/.test(tag)) return 'bigseo';
  if (/email|outreach/.test(tag)) return 'Entrepreneur';
  if (/marketing/.test(tag)) return 'marketing';
  if (/image|logo|design/.test(tag)) return 'graphic_design';
  if (/code|script|dev/.test(tag)) return 'webdev';
  if (/ai|gpt/.test(tag)) return 'artificial';
  return 'SideProject';
}

function nextBestPostTime() {
  const now = new Date();
  const est = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = est.getDay();
  const hour = est.getHours();
  const goodDays = [2, 3, 4]; // Tue-Thu
  const goodHours = [9, 12];
  for (let d = 0; d < 7; d++) {
    const checkDay = (day + d) % 7;
    if (!goodDays.includes(checkDay)) continue;
    for (const h of goodHours) {
      if (d === 0 && h <= hour) continue;
      const t = new Date(now);
      t.setDate(now.getDate() + d);
      t.setHours(h, 0, 0, 0);
      return t.toISOString();
    }
  }
  return new Date(Date.now() + 2 * 3600 * 1000).toISOString();
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    const existing = existsSync(TRAFFIC_LOG) ? readFileSync(TRAFFIC_LOG, 'utf8') : '';
    writeFileSync(TRAFFIC_LOG, existing + line + '\n');
  } catch (_) { }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

run().catch(async (e) => {
  log(`💥 Fatal: ${e.message}`);
  await sendAlert('traffic-agent', e.message, { stack: (e.stack || '').slice(0, 500) });
  console.error(e);
  process.exit(1);
});
