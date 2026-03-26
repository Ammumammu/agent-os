// api/publish.js — Multi-Channel Content Publisher
// Handles auto-publishing to Dev.to, Hashnode, and content queuing for Reddit/Twitter/IH/PH

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, ...p } = req.body;

  try {
    switch (action) {
      case 'auto_publish':   return res.json(await autoPublish(p));
      case 'queue_semi':     return res.json(await queueSemiAuto(p));
      case 'get_queue':      return res.json(await getQueue());
      case 'batch_publish':  return res.json(await batchPublish(p));
      case 'ph_submission':  return res.json(await generatePHSubmission(p));
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
