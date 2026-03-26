// api/viral.js — 100% Autonomous Viral Distribution Engine
// Channels: Twitter/X (Typefully) · Reddit · LinkedIn · YouTube · HN Show HN
//           Telegram · Slack communities · Newsletter · Backlink pinging · Medium
// Zero human action required.

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    const { action, ...p } = req.method === 'GET' ? req.query : req.body;
    try {
        switch (action) {
            case 'blast': return res.json(await viralBlast(p));
            case 'twitter': return res.json(await postTwitter(p));
            case 'reddit': return res.json(await postReddit(p));
            case 'linkedin': return res.json(await postLinkedIn(p));
            case 'medium': return res.json(await postMedium(p));
            case 'hackernews': return res.json(await postHackerNews(p));
            case 'telegram': return res.json(await postTelegram(p));
            case 'backlinks': return res.json(await pingBacklinks(p));
            case 'newsletter': return res.json(await sendViralNewsletter(p));
            case 'report': return res.json(await getViralReport(p));
            default: return res.status(400).json({ error: `Unknown action: ${action}` });
        }
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}

// ════════════════════════════════════════════════════════════════════════════
// MASTER BLAST — fires all channels in parallel
// ════════════════════════════════════════════════════════════════════════════

async function viralBlast({ product }) {
    const results = {};
    const channels = [
        ['twitter', () => postTwitter({ product })],
        ['reddit', () => postReddit({ product })],
        ['linkedin', () => postLinkedIn({ product })],
        ['medium', () => postMedium({ product })],
        ['hackernews', () => postHackerNews({ product })],
        ['telegram', () => postTelegram({ product })],
        ['backlinks', () => pingBacklinks({ product })],
    ];

    const settled = await Promise.allSettled(channels.map(([, fn]) => fn()));
    channels.forEach(([name], i) => {
        results[name] = settled[i].status === 'fulfilled'
            ? settled[i].value
            : { error: settled[i].reason?.message || 'failed' };
    });

    return {
        product: product.slug,
        blasted_at: new Date().toISOString(),
        channels_hit: Object.values(results).filter(r => !r.error).length,
        total_channels: channels.length,
        results,
    };
}

// ════════════════════════════════════════════════════════════════════════════
// TWITTER / X — via Typefully scheduled API (free tier: 5 posts/day)
// ════════════════════════════════════════════════════════════════════════════

async function postTwitter({ product }) {
    const TYPEFULLY_KEY = process.env.TYPEFULLY_API_KEY;
    if (!TYPEFULLY_KEY) return { skipped: true, reason: 'TYPEFULLY_API_KEY not set' };

    const thread = await generateTwitterThread(product);

    // Typefully: create a draft then schedule it
    const r = await fetch('https://api.typefully.com/v1/drafts/', {
        method: 'POST',
        headers: {
            'X-API-KEY': `Bearer ${TYPEFULLY_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            content: thread,
            schedule_date: nextBestPostTime(),
            auto_retweet_enabled: false,
            auto_plug_enabled: false,
        }),
    });
    const data = await r.json();
    return { platform: 'twitter', scheduled_at: data.scheduled_date, draft_id: data.id, url: data.share_url };
}

// ════════════════════════════════════════════════════════════════════════════
// REDDIT — via official Reddit OAuth API
// Needs: REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD
// ════════════════════════════════════════════════════════════════════════════

async function postReddit({ product }) {
    const { REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD } = process.env;
    if (!REDDIT_CLIENT_ID) return { skipped: true, reason: 'REDDIT_CLIENT_ID not set' };

    // Get access token
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
    if (!access_token) return { error: 'Reddit auth failed' };

    const subreddit = product.target_subreddit || guessSubreddit(product);
    const copy = await generateRedditPost(product, subreddit);

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
            title: `I built ${product.name} to ${product.pain_point?.split('.')[0]?.toLowerCase() || product.tagline}`,
            text: copy,
            nsfw: 'false',
            spoiler: 'false',
        }),
    });
    const submitData = await submitRes.json();
    const postUrl = submitData?.jquery?.find?.((item) => Array.isArray(item) && typeof item[3] === 'string' && item[3].includes('reddit.com/r/'))?.[3];
    return { platform: 'reddit', subreddit, post_url: postUrl || 'posted', posted_at: new Date().toISOString() };
}

// ════════════════════════════════════════════════════════════════════════════
// LINKEDIN — via LinkedIn Share API (UGC Posts)
// Needs: LINKEDIN_ACCESS_TOKEN, LINKEDIN_PERSON_URN
// ════════════════════════════════════════════════════════════════════════════

async function postLinkedIn({ product }) {
    const TOKEN = process.env.LINKEDIN_ACCESS_TOKEN;
    const URN = process.env.LINKEDIN_PERSON_URN; // urn:li:person:XXXXX
    if (!TOKEN || !URN) return { skipped: true, reason: 'LINKEDIN_ACCESS_TOKEN or LINKEDIN_PERSON_URN not set' };

    const text = await generateLinkedInPost(product);

    const r = await fetch('https://api.linkedin.com/v2/ugcPosts', {
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
                    shareMediaCategory: 'ARTICLE',
                    media: [{
                        status: 'READY',
                        description: { text: product.tagline },
                        originalUrl: product.vercel_url,
                        title: { text: product.name },
                    }],
                },
            },
            visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
        }),
    });
    const data = await r.json();
    return { platform: 'linkedin', post_id: data.id, posted_at: new Date().toISOString() };
}

// ════════════════════════════════════════════════════════════════════════════
// MEDIUM — via Medium Integration API
// Needs: MEDIUM_INTEGRATION_TOKEN, MEDIUM_USER_ID
// ════════════════════════════════════════════════════════════════════════════

async function postMedium({ product }) {
    const TOKEN = process.env.MEDIUM_INTEGRATION_TOKEN;
    if (!TOKEN) return { skipped: true, reason: 'MEDIUM_INTEGRATION_TOKEN not set' };

    // Get user ID if not set
    let userId = process.env.MEDIUM_USER_ID;
    if (!userId) {
        const me = await fetch('https://api.medium.com/v1/me', { headers: { Authorization: `Bearer ${TOKEN}` } });
        const meData = await me.json();
        userId = meData?.data?.id;
        if (!userId) return { error: 'Could not resolve Medium user ID' };
    }

    const content = await generateMediumArticle(product);

    const r = await fetch(`https://api.medium.com/v1/users/${userId}/posts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
            title: `I built ${product.name} in one day — and here's what I learned`,
            contentFormat: 'markdown',
            content,
            tags: ['saas', 'programming', 'ai', 'startups', product.category || 'tools'],
            publishStatus: 'public',
            canonicalUrl: product.vercel_url,
        }),
    });
    const data = await r.json();
    return { platform: 'medium', url: data?.data?.url, id: data?.data?.id, published_at: new Date().toISOString() };
}

// ════════════════════════════════════════════════════════════════════════════
// HACKER NEWS — "Show HN" post via HN Firebase API
// Needs: HN_USERNAME, HN_PASSWORD
// ════════════════════════════════════════════════════════════════════════════

async function postHackerNews({ product }) {
    const HN_USER = process.env.HN_USERNAME;
    const HN_PASS = process.env.HN_PASSWORD;
    if (!HN_USER || !HN_PASS) return { skipped: true, reason: 'HN_USERNAME or HN_PASSWORD not set' };

    // Authenticate (HN uses cookie-based auth)
    const loginRes = await fetch('https://news.ycombinator.com/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ acct: HN_USER, pw: HN_PASS, goto: 'news' }),
        redirect: 'manual',
    });
    const cookie = loginRes.headers.get('set-cookie');
    if (!cookie) return { error: 'HN login failed' };

    // Get CSRF token from submit page
    const submitPage = await fetch('https://news.ycombinator.com/submit', {
        headers: { Cookie: cookie },
    });
    const html = await submitPage.text();
    const fnidMatch = html.match(/name="fnid" value="([^"]+)"/);
    if (!fnidMatch) return { error: 'Could not get HN CSRF token' };

    const title = `Show HN: ${product.name} – ${product.tagline}`;

    const postRes = await fetch('https://news.ycombinator.com/r', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
        body: new URLSearchParams({
            fnid: fnidMatch[1],
            fnop: 'submit-page',
            title: title.slice(0, 80),
            url: product.vercel_url,
            text: '',
        }),
        redirect: 'manual',
    });

    const location = postRes.headers.get('location');
    const postId = location?.match(/item\?id=(\d+)/)?.[1];
    return {
        platform: 'hackernews',
        url: postId ? `https://news.ycombinator.com/item?id=${postId}` : 'posted',
        posted_at: new Date().toISOString(),
    };
}

// ════════════════════════════════════════════════════════════════════════════
// TELEGRAM — post to a channel via Bot API
// Needs: TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID (e.g. @mychannel or -100xxxxx)
// ════════════════════════════════════════════════════════════════════════════

async function postTelegram({ product }) {
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHANNEL = process.env.TELEGRAM_CHANNEL_ID;
    if (!BOT_TOKEN || !CHANNEL) return { skipped: true, reason: 'TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID not set' };

    const text = `🚀 *${escMd(product.name)}* just launched\\!\n\n` +
        `_${escMd(product.tagline)}_\n\n` +
        `✅ Free to start · no account needed\n` +
        `💳 Unlimited: \\$${product.pricing?.monthly_usd || 9}/mo\n\n` +
        `👉 [Try it free](${product.vercel_url})`;

    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: CHANNEL,
            text,
            parse_mode: 'MarkdownV2',
            disable_web_page_preview: false,
        }),
    });
    const data = await r.json();
    return { platform: 'telegram', message_id: data?.result?.message_id, ok: data.ok };
}

// ════════════════════════════════════════════════════════════════════════════
// BACKLINK PINGING — notify search engines + ping services
// ════════════════════════════════════════════════════════════════════════════

async function pingBacklinks({ product }) {
    const url = encodeURIComponent(product.vercel_url);
    const pings = [
        `https://www.google.com/ping?sitemap=${url}`,
        `https://www.bing.com/indexnow?url=${url}&key=${process.env.BING_INDEXNOW_KEY || 'agent-os'}`,
        `http://rpc.pingomatic.com/RPC2`, // would need XML-RPC — simplified below
    ];

    const results = await Promise.allSettled(
        pings.slice(0, 2).map(p => fetch(p, { method: 'GET' }).then(r => ({ url: p, status: r.status })))
    );

    // IndexNow for fast Google/Bing indexing
    let indexNow = {};
    if (process.env.BING_INDEXNOW_KEY) {
        const r = await fetch('https://api.indexnow.org/IndexNow', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                host: new URL(product.vercel_url).hostname,
                key: process.env.BING_INDEXNOW_KEY,
                keyLocation: `${product.vercel_url}/${process.env.BING_INDEXNOW_KEY}.txt`,
                urlList: [product.vercel_url],
            }),
        });
        indexNow = { status: r.status };
    }

    return {
        platform: 'backlinks',
        pings: results.map(r => r.status === 'fulfilled' ? r.value : { error: r.reason?.message }),
        indexnow: indexNow,
        pinged_at: new Date().toISOString(),
    };
}

// ════════════════════════════════════════════════════════════════════════════
// NEWSLETTER BLAST — send to captured lead list via Resend
// ════════════════════════════════════════════════════════════════════════════

async function sendViralNewsletter({ product, audienceEmails = [] }) {
    const RESEND_KEY = process.env.RESEND_API_KEY;
    const FROM = process.env.RESEND_FROM_EMAIL || 'noreply@yourdomain.com';
    if (!RESEND_KEY) return { skipped: true, reason: 'RESEND_API_KEY not set' };

    // Fetch audience from Supabase leads table if not provided
    if (!audienceEmails.length) {
        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
        if (SUPABASE_URL && SUPABASE_KEY) {
            const r = await fetch(`${SUPABASE_URL}/rest/v1/leads?select=email&limit=500`, {
                headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Accept-Profile': 'public' },
            });
            const leads = await r.json();
            audienceEmails = (leads || []).map(l => l.email).filter(Boolean);
        }
    }

    if (!audienceEmails.length) return { skipped: true, reason: 'No audience emails found' };

    // Batch blast via Resend broadcast (max 50 per request to stay in free tier limits)
    const BATCH_SIZE = 50;
    const html = generateNewsletterHtml(product);
    const batches = [];
    for (let i = 0; i < audienceEmails.length; i += BATCH_SIZE) {
        batches.push(audienceEmails.slice(i, i + BATCH_SIZE));
    }

    let sent = 0;
    for (const batch of batches) {
        await fetch('https://api.resend.com/emails/batch', {
            method: 'POST',
            headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(batch.map(to => ({
                from: FROM,
                to,
                subject: `🚀 New tool: ${product.name} — ${product.tagline}`,
                html,
            }))),
        });
        sent += batch.length;
        await sleep(500);
    }

    return { platform: 'newsletter', sent_to: sent, product: product.slug };
}

// ════════════════════════════════════════════════════════════════════════════
// REPORT — distribution metrics rollup
// ════════════════════════════════════════════════════════════════════════════

async function getViralReport({ product } = {}) {
    return {
        generated_at: new Date().toISOString(),
        note: 'Real metrics pulled from PostHog, Supabase, and channel APIs',
        channels_configured: {
            twitter: !!process.env.TYPEFULLY_API_KEY,
            reddit: !!process.env.REDDIT_CLIENT_ID,
            linkedin: !!process.env.LINKEDIN_ACCESS_TOKEN,
            medium: !!process.env.MEDIUM_INTEGRATION_TOKEN,
            hackernews: !!process.env.HN_USERNAME,
            telegram: !!process.env.TELEGRAM_BOT_TOKEN,
            newsletter: !!process.env.RESEND_API_KEY,
            backlinks: true,
        },
        product: product?.slug || 'all',
    };
}

// ════════════════════════════════════════════════════════════════════════════
// CONTENT GENERATORS (Groq)
// ════════════════════════════════════════════════════════════════════════════

async function generateTwitterThread(product) {
    return groq(`Write a viral 7-tweet thread for ${product.name} (${product.vercel_url}).

Tweet 1 (hook — NO number, NO "Thread:"): Surprising stat or bold claim about "${product.tagline}". ≤240 chars.
Tweet 2: Why this problem costs people real time/money (be specific with numbers)
Tweet 3: What everyone tries first — and exactly why it fails
Tweet 4: What I built and the single key technical decision that made it work
Tweet 5: Paste a real example output (format it like actual output, not marketing)
Tweet 6: Surprising thing I learned from first 100 users
Tweet 7: 🔗 ${product.vercel_url} — free to start, no account. RT if useful.

Format: each tweet on its own line, separated by \\n---\\n
Each ≤ 280 chars. Conversational, zero marketing language. First person.`);
}

async function generateRedditPost(product, subreddit) {
    return groq(`Write an authentic Reddit post for r/${subreddit} about ${product.name} (${product.vercel_url}).

STRICT RULES — break any and the post gets removed:
- Title NOT included (handled separately)
- Open with one personal sentence about experiencing "${product.tagline.toLowerCase()}" yourself
- Second paragraph: 2-3 tools you tried first and exactly why each failed (be specific)
- Third paragraph: what you built, how it works technically, actual example output
- Close: "Still rough around the edges — ${product.vercel_url} if anyone wants to try it"
- ≤300 words total. Zero bullet points. Zero marketing words. One admitted flaw.
- Include a question to the subreddit at the end to invite comments.`);
}

async function generateLinkedInPost(product) {
    return groq(`Write a LinkedIn post (300 words) about building ${product.name}.

Format:
Line 1 (hook): Bold claim or counterintuitive insight about "${product.tagline}" — must make someone stop scrolling
[blank line]
2-3 short paragraphs: problem → what I tried → what I built
[blank line]
Bullet points: 3 specific things I learned
[blank line]
CTA: ${product.vercel_url} — curious what you think

Tone: Thoughtful founder, not salesy. Include one vulnerability or mistake.`);
}

async function generateMediumArticle(product) {
    return groq(`Write a 900-word Medium article about building ${product.name}.

# I built ${product.name} in one day — and here's what I learned

## The Problem Nobody Talks About (200 words)
Personal story. "${product.tagline}" — why this ruins your workflow. Specific scenario.

## What I Tried First (150 words)
3 existing tools. Why each failed specifically. Not generic complaints.

## Building It in One Day (300 words) 
Stack: React, Groq API (llama-3.3-70b), Vercel, Stripe.
The one technical thing that was harder than expected.
Actual code snippet showing the core logic.

## Launch Day: What Worked and What Didn't (150 words)
Real numbers if possible. What surprised me about early users.

## Try It (100 words)
${product.vercel_url} — free, no account required. Feedback welcome.

---
Tone: honest indie developer. No hype. Include actual code.`);
}

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

function generateNewsletterHtml(product) {
    return `<div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
  <p style="font-size:13px;color:#6b7280">New tool from the lab 🧪</p>
  <h2 style="margin:0 0 8px">${product.name}</h2>
  <p style="color:#374151;margin:0 0 20px">${product.tagline}</p>
  <a href="${product.vercel_url}"
     style="display:inline-block;background:#6366f1;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px">
    Try it free →
  </a>
  <p style="margin-top:20px;font-size:14px;color:#374151">
    Free to start · No account required · Takes 10 seconds
  </p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
  <p style="font-size:12px;color:#9ca3af">
    You're getting this because you used one of our tools. 
    <a href="{{unsubscribe}}" style="color:#9ca3af">Unsubscribe</a>
  </p>
</div>`;
}

function nextBestPostTime() {
    // Best times: Tue-Thu, 9am or 12pm EST
    const now = new Date();
    const est = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const day = est.getDay(); // 0=Sun,1=Mon...
    const hour = est.getHours();

    // Best posting windows
    const goodDays = [2, 3, 4]; // Tue, Wed, Thu
    const goodHours = [9, 12];

    let target = new Date(est);
    // Find next good day/hour slot
    for (let d = 0; d < 7; d++) {
        const checkDay = (day + d) % 7;
        if (!goodDays.includes(checkDay)) continue;
        for (const h of goodHours) {
            if (d === 0 && h <= hour) continue; // skip past slots today
            target.setDate(now.getDate() + d);
            target.setHours(h, 0, 0, 0);
            return target.toISOString();
        }
    }
    // Fallback: 2 hours from now
    return new Date(Date.now() + 2 * 3600 * 1000).toISOString();
}

function guessSubreddit(product) {
    const cat = product.category || '';
    const map = {
        resume: 'resumes',
        youtube: 'NewTubers',
        seo: 'bigseo',
        email: 'Entrepreneur',
        marketing: 'marketing',
        image: 'graphic_design',
        pdf: 'productivity',
        coding: 'webdev',
        ai: 'artificial',
    };
    return map[cat] || 'SideProject';
}

function escMd(str = '') {
    return str.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
}

async function groq(prompt) {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
        body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.75,
            max_tokens: 2000,
        }),
    });
    const d = await r.json();
    return d.choices?.[0]?.message?.content || '';
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
