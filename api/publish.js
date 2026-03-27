// api/publish.js — Multi-Channel Content Publisher
// Handles auto-publishing to Dev.to, Hashnode, and content queuing for Reddit/Twitter/IH/PH

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { action, ...p } = req.body || {};
    switch (action) {
      case 'auto_publish':   return res.json(await autoPublish(p));
      case 'queue_semi':     return res.json(await queueSemiAuto(p));
      case 'get_queue':      return res.json(await getQueue());
      case 'batch_publish':  return res.json(await batchPublish(p));
      case 'ph_submission':  return res.json(await generatePHSubmission(p));
      case 'run':            return res.json(await getQueue());

      // ── Email Operations (merged from email.js) ───────────────────────────
      case 'email_send':               return res.json(await sendEmail(p));
      case 'email_welcome':            return res.json(await sendWelcome(p));
      case 'email_sequence':           return res.json(await startSequence(p));
      case 'email_post_payment':       return res.json(await postPaymentSequence(p));
      case 'email_digest':             return res.json(await sendDigest(p));
      case 'email_followup':           return res.json(await sendFollowUp(p));
      case 'email_dunning':            return res.json(await sendDunning(p));
      case 'email_winback':            return res.json(await sendWinback(p));

      default: return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// ─── Auto-publish to Dev.to + Hashnode ───────────────────────────────────────
async function autoPublish({ product, article }) {
  const title = article?.title || `I built ${product.name} to solve ${product.pain_point || product.tagline}`;
  const markdown = article?.markdown || generateFallbackArticle(product);
  const tags = ['saas', 'tools', 'ai', product.category || 'productivity'];

  const [devto, hashnode] = await Promise.allSettled([
    publishToDevTo(title, markdown, tags),
    publishToHashnode(title, markdown, tags),
  ]);

  return {
    product: product.slug,
    devto: devto.status === 'fulfilled' ? devto.value : { error: devto.reason?.message },
    hashnode: hashnode.status === 'fulfilled' ? hashnode.value : { error: hashnode.reason?.message },
    publishedAt: new Date().toISOString(),
  };
}

async function publishToDevTo(title, body_markdown, tags) {
  const r = await fetch('https://dev.to/api/articles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': process.env.DEVTO_API_KEY },
    body: JSON.stringify({ article: { title, body_markdown, published: true, tags } }),
  });
  const data = await r.json();
  return { url: data.url, id: data.id, platform: 'devto' };
}

async function publishToHashnode(title, contentMarkdown, tags) {
  const query = `
    mutation PublishPost($input: PublishPostInput!) {
      publishPost(input: $input) { post { id url } }
    }`;
  const r = await fetch('https://gql.hashnode.com', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: process.env.HASHNODE_TOKEN },
    body: JSON.stringify({
      query,
      variables: {
        input: {
          title,
          contentMarkdown,
          publicationId: process.env.HASHNODE_PUBLICATION_ID,
          tags: tags.map(t => ({ slug: t.toLowerCase().replace(/\s+/g, '-'), name: t })),
        },
      },
    }),
  });
  const data = await r.json();
  const post = data?.data?.publishPost?.post;
  return { url: post?.url, id: post?.id, platform: 'hashnode' };
}

// ─── Queue semi-auto content (Reddit/Twitter/IH/PH) for human posting ────────
async function queueSemiAuto({ product, reddit, twitter, ih, ph }) {
  const item = {
    id: Date.now(),
    product_slug: product.slug,
    product_name: product.name,
    product_url: product.vercel_url,
    queued_at: new Date().toISOString(),
    status: 'pending_human',
    channels: {
      reddit: { copy: reddit, subreddit: product.target_subreddit || 'SideProject', status: 'ready' },
      twitter: { copy: twitter, status: 'ready' },
      indiehackers: { copy: ih, status: 'ready' },
      producthunt: { copy: ph, status: 'ready' },
    },
  };

  // Save to Supabase if configured
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (SUPABASE_URL && SUPABASE_KEY) {
    await fetch(`${SUPABASE_URL}/rest/v1/publish_queue`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Content-Profile': 'public', Prefer: 'return=minimal' },
      body: JSON.stringify(item),
    });
  }

  return { queued: true, item };
}

// ─── Get pending semi-auto queue ──────────────────────────────────────────────
async function getQueue() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { queue: [], note: 'Supabase not configured' };
  }

  const r = await fetch(`${SUPABASE_URL}/rest/v1/publish_queue?status=eq.pending_human&order=queued_at.desc&limit=20`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Accept-Profile': 'public' },
  });
  const queue = await r.json();
  return { queue, count: queue.length };
}

// ─── Batch publish multiple products ─────────────────────────────────────────
async function batchPublish({ products = [] }) {
  const results = [];
  for (const product of products) {
    try {
      const article = generateFallbackArticle(product);
      const result = await autoPublish({
        product,
        article: { title: `${product.name} — ${product.tagline}`, markdown: article },
      });
      results.push({ slug: product.slug, ...result });
      await sleep(2000); // rate limit
    } catch (e) {
      results.push({ slug: product.slug, error: e.message });
    }
  }
  return { results, total: results.length, succeeded: results.filter(r => !r.error).length };
}

// ─── Generate ProductHunt submission copy ────────────────────────────────────
async function generatePHSubmission({ product }) {
  const raw = await groq(`Generate a ProductHunt launch submission for ${product.name}.

Return JSON:
{
  "name": "${product.name}",
  "tagline": "pain-first tagline, ≤60 chars, no period",
  "description": "3 sentences: problem → solution → who it's for. No hype.",
  "first_comment": "founder comment (200 words): personal story → what it does → how you built it → what feedback you want",
  "topics": ["relevant topic 1", "relevant topic 2", "relevant topic 3"],
  "launch_timing": "Tuesday 12:01am PST",
  "url": "${product.vercel_url}"
}`);

  const ph = parseJSON(raw);
  return { ph: ph || { name: product.name, tagline: product.tagline, url: product.vercel_url } };
}

function generateFallbackArticle(product) {
  return `# ${product.name}

${product.tagline}

## The Problem

${product.pain_point || `I kept running into the same problem: ${product.tagline.toLowerCase()}.`}

## What I Built

${product.name} is a tool that ${product.core_feature || product.tagline.toLowerCase()}.

Designed for: ${product.icp || 'anyone dealing with this problem daily'}.

## How It Works

1. Describe what you need
2. AI generates your output in seconds
3. Copy, use, done

## Try It Free

${product.vercel_url}

Free to start. No account required.

---

*Built with React, Groq API, Vercel, and Stripe. Questions? Reply here.*`;
}

async function groq(prompt) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 1500,
    }),
  });
  const d = await r.json();
  return d.choices?.[0]?.message?.content || '';
}

function parseJSON(text = '') {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch (_) { return null; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Email Operations (merged from email.js) ──────────────────────────────

const FROM = process.env.RESEND_FROM_EMAIL || 'noreply@yourdomain.com';

async function resendSend(payload) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify(payload),
  });
  return r.json();
}

async function sendEmail({ to, subject, html, text }) {
  return resendSend({ from: FROM, to, subject, html, text });
}

async function sendWelcome({ to, productName, productUrl, freeLimit }) {
  const html = `<div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a"><h2 style="color:#6366f1">Welcome to ${productName}!</h2><p>You just got <strong>${freeLimit || 3} extra free uses</strong> — they're ready to go.</p><a href="${productUrl}" style="display:inline-block;background:#6366f1;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;margin:16px 0">Open ${productName} →</a><p style="color:#6b7280;font-size:14px">Reply with any feedback — I read every response.</p></div>`;
  return resendSend({ from: FROM, to, subject: `Your extra uses are ready — ${productName}`, html });
}

async function startSequence({ to, productName, productUrl, stripeLink }) {
  const day3 = new Date(Date.now() + 3 * 864e5).toISOString();
  const day7 = new Date(Date.now() + 7 * 864e5).toISOString();
  const [r2, r3] = await Promise.all([
    resendSend({ from: FROM, to, subject: `Quick tip for ${productName}`, scheduledAt: day3, html: `<div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto"><p>Here's one thing most people don't know about ${productName}: you can use it for multiple use cases, not just the obvious one.</p><p><a href="${productUrl}" style="color:#6366f1">Try it now →</a></p></div>` }),
    resendSend({ from: FROM, to, subject: `${productName} — one week in`, scheduledAt: day7, html: `<div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto"><p>Unlock unlimited for <strong>$9/month</strong> — cancel anytime.</p><a href="${stripeLink}" style="display:inline-block;background:#6366f1;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">Get Unlimited Access →</a></div>` }),
  ]);
  return { email2: r2, email3: r3, sequence: 'started' };
}

async function postPaymentSequence({ to, productName, productUrl }) {
  const day3 = new Date(Date.now() + 3 * 864e5).toISOString();
  const day14 = new Date(Date.now() + 14 * 864e5).toISOString();
  const [r2, r3] = await Promise.all([
    resendSend({ from: FROM, to, subject: `How is ${productName} working for you?`, scheduledAt: day3, html: `<div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto"><p>Checking in — everything running smoothly? Reply with feature requests!</p><p><a href="${productUrl}" style="color:#6366f1">Go to ${productName} →</a></p></div>` }),
    resendSend({ from: FROM, to, subject: `Leave a review for ${productName}?`, scheduledAt: day14, html: `<div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto"><p>It's been two weeks! If ${productName} saved you time, I'd love a quick shoutout on Twitter or ProductHunt.</p></div>` }),
  ]);
  return { email2: r2, email3: r3, sequence: 'post_payment_started' };
}

async function sendDigest({ to, data }) {
  const { mrr, visitors, newLeads, topProduct, date } = data || {};
  const html = `<div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto"><h2>Daily Digest — ${date || new Date().toLocaleDateString()}</h2><table style="width:100%;border-collapse:collapse;margin:16px 0"><tr style="background:#f9fafb"><th style="padding:12px;text-align:left">Metric</th><th style="padding:12px;text-align:right">Value</th></tr><tr><td style="padding:10px">MRR</td><td style="padding:10px;text-align:right;font-weight:700;color:#6366f1">$${mrr || 0}</td></tr><tr style="background:#f9fafb"><td style="padding:10px">Visitors Today</td><td style="padding:10px;text-align:right">${visitors || 0}</td></tr><tr><td style="padding:10px">New Leads</td><td style="padding:10px;text-align:right">${newLeads || 0}</td></tr><tr style="background:#f9fafb"><td style="padding:10px">Top Product</td><td style="padding:10px;text-align:right">${topProduct || '—'}</td></tr></table><p style="color:#6b7280;font-size:13px">Agent OS Daily Report · Auto-generated</p></div>`;
  return resendSend({ from: FROM, to, subject: `Daily Digest — $${mrr || 0} MRR`, html });
}

async function sendFollowUp({ to, productName, productUrl, stripeLink, daysAgo = 14 }) {
  return resendSend({ from: FROM, to, subject: `Still interested in ${productName}?`, html: `<div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto"><p>You signed up for extra uses on ${productName} ${daysAgo} days ago. We've improved it since then.</p><a href="${productUrl}" style="display:inline-block;background:#6366f1;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">Check it out →</a><p style="color:#6b7280;font-size:13px;margin-top:16px">Unlimited access is $9/mo. <a href="${stripeLink}" style="color:#6366f1">Upgrade here</a>.</p></div>` });
}

// ─── Dunning: recover failed payments ────────────────────────────────────────
// attempt 1 = day 1, attempt 2 = ~day 3, attempt 3 = ~day 7 (Stripe retries)
async function sendDunning({ to, attempt, invoiceUrl, productSlug }) {
  const name = productSlug || 'your subscription';
  const templates = {
    1: {
      subject: `Action needed — payment failed for ${name}`,
      html: `<div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
<h2 style="color:#ef4444">Payment failed</h2>
<p>Your payment for <strong>${name}</strong> didn't go through. This usually happens due to an expired card or insufficient funds.</p>
<p>No action needed yet — we'll retry automatically. But if you want to fix it now:</p>
<a href="${invoiceUrl}" style="display:inline-block;background:#6366f1;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;margin:16px 0">Update Payment Method →</a>
<p style="color:#6b7280;font-size:13px">Your access continues while we retry. Reply if you need help.</p>
</div>`,
    },
    2: {
      subject: `2nd attempt failed — update your card for ${name}`,
      html: `<div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
<h2 style="color:#ef4444">Still having trouble</h2>
<p>We tried again and the payment for <strong>${name}</strong> failed a second time.</p>
<p>Please update your payment method to keep access:</p>
<a href="${invoiceUrl}" style="display:inline-block;background:#ef4444;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;margin:16px 0">Fix Payment Now →</a>
<p style="color:#6b7280;font-size:13px">One more retry in ~4 days, then access will pause.</p>
</div>`,
    },
    3: {
      subject: `Final notice — ${name} access pausing soon`,
      html: `<div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
<h2 style="color:#ef4444">Last chance</h2>
<p>This is our final retry for <strong>${name}</strong>. If we can't collect payment, your access will pause.</p>
<a href="${invoiceUrl}" style="display:inline-block;background:#ef4444;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;margin:16px 0">Update Card to Keep Access →</a>
<p style="color:#6b7280;font-size:13px">Takes 30 seconds. Your data is safe and ready when you return.</p>
</div>`,
    },
  };
  const t = templates[attempt] || templates[1];
  return resendSend({ from: FROM, to, subject: t.subject, html: t.html });
}

// ─── Win-back: re-engage canceled subscribers ─────────────────────────────────
// day 1 sent from webhook immediately; days 3/7/14 sent by analytics-agent cron
async function sendWinback({ to, day, productSlug, stripeLink }) {
  const name = productSlug || 'your subscription';
  const templates = {
    1: {
      subject: `We noticed you left — here's what you're missing`,
      html: `<div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
<p>Sorry to see you go. Your access to <strong>${name}</strong> has ended.</p>
<p>If it was a pricing issue, we'd love to keep you — reply and we'll figure something out.</p>
${stripeLink ? `<a href="${stripeLink}" style="display:inline-block;background:#6366f1;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;margin:16px 0">Come back →</a>` : ''}
<p style="color:#6b7280;font-size:13px">No hard feelings either way. <a href="{{unsubscribe_url}}" style="color:#6b7280">Unsubscribe</a></p>
</div>`,
    },
    3: {
      subject: `One thing you might not know about ${name}`,
      html: `<div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
<p>Quick check-in — did you know ${name} recently added [feature]? Might be worth another look.</p>
${stripeLink ? `<a href="${stripeLink}" style="display:inline-block;background:#6366f1;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;margin:16px 0">Try it again →</a>` : ''}
<p style="color:#6b7280;font-size:13px"><a href="{{unsubscribe_url}}" style="color:#6b7280">Unsubscribe</a></p>
</div>`,
    },
    7: {
      subject: `Special offer — come back at 50% off`,
      html: `<div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
<h2>We want you back</h2>
<p>One-time offer for ${name}: restart at <strong>50% off your first month</strong>.</p>
${stripeLink ? `<a href="${stripeLink}?prefilled_promo_code=COMEBACK50" style="display:inline-block;background:#6366f1;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;margin:16px 0">Claim 50% Off →</a>` : ''}
<p style="color:#6b7280;font-size:13px">Offer expires in 48 hours. <a href="{{unsubscribe_url}}" style="color:#6b7280">Unsubscribe</a></p>
</div>`,
    },
    14: {
      subject: `Last message from us about ${name}`,
      html: `<div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
<p>This is our last reach-out. If you ever want to return to ${name}, the door is open.</p>
<p>Before you go — one quick question: <a href="mailto:${process.env.OWNER_EMAIL || FROM}" style="color:#6366f1">what made you leave?</a> One reply helps us improve for everyone.</p>
<p style="color:#6b7280;font-size:13px"><a href="{{unsubscribe_url}}" style="color:#6b7280">Unsubscribe</a></p>
</div>`,
    },
  };
  const t = templates[day] || templates[1];
  return resendSend({ from: FROM, to, subject: t.subject, html: t.html });
}
