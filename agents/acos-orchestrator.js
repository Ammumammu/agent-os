#!/usr/bin/env node
// agents/acos-orchestrator.js — AI Creator Operating System v4.0
// Multi-Agent Content Growth Engine · All 12 Agents · Hook Engineering First
// Target: $10,008/day via AI Tools content across ALL platforms

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ACOS_DIR = join(__dirname, '../acos');
const HOOK_LIBRARY = join(ACOS_DIR, 'hook-library.json');
const CYCLE_LOG = join(ACOS_DIR, 'cycle-log.json');
const KNOWLEDGE_REPO = join(ACOS_DIR, 'knowledge-repo.json');
const IDEAS_BANK = join(ACOS_DIR, 'ideas-bank.json');
const SCRIPTS_DIR = join(ACOS_DIR, 'scripts');
const CONTENT_QUEUE = join(ACOS_DIR, 'content-queue.json');
const ACOS_LOG = join(ACOS_DIR, 'acos.log');

// ─── Load .env ────────────────────────────────────────────────────────────────
const envFile = join(__dirname, '../.env');
if (existsSync(envFile)) {
  readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && !k.startsWith('#') && v.length) process.env[k.trim()] = v.join('=').trim();
  });
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { appendFileSync(ACOS_LOG, line + '\n'); } catch (_) { }
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function loadJSON(path, fallback = {}) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch (_) { return fallback; }
}
function saveJSON(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2));
}
function ensure(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ─── GROQ multi-model fallback ────────────────────────────────────────────────
const GROQ_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant'
];
async function groq(prompt, maxTokens = 2000, isJson = false) {
  let lastErr;
  let retries = 0;

  while (retries < 15) {
    for (const model of GROQ_MODELS) {
      try {
        const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.8,
            ...(isJson ? { response_format: { type: 'json_object' } } : {})
          }),
        });
        const d = await r.json();
        if (d.error) {
          lastErr = d.error.message;
          // Look for "try again in X.XXs"
          const retryMatch = lastErr.match(/try again in ([\d.]+)s/i);
          if (retryMatch) {
            const waitMs = parseFloat(retryMatch[1]) * 1000 + 1000;
            await sleep(waitMs);
          } else if (d.error.code === 'rate_limit_exceeded' || r.status === 429) {
            await sleep(12000);
          }
          continue;
        }
        const text = d.choices?.[0]?.message?.content || '';
        return text;
      } catch (e) {
        lastErr = e.message;
      }
    }
    retries++;
    await sleep(2000);
  }
  throw new Error(lastErr || 'All Groq models failed after retries');
}
async function groqJSON(prompt, maxTokens = 2000) {
  const raw = await groq(prompt + '\n\nRespond with ONLY valid JSON, no markdown, no explanation.', maxTokens, true);
  const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(clean);
}

// ══════════════════════════════════════════════════════════════════════════════
// AGENT 1 — TREND SCANNER
// Weekly scan of viral AI tools content across all platforms
// ══════════════════════════════════════════════════════════════════════════════
async function trendScannerAgent() {
  log('🔍 [TREND SCANNER] Scanning viral patterns in AI tools niche...');

  const trends = await groqJSON(`
You are the Trend Scanner Agent for an AI Tools content creator targeting $10K/day revenue.
Analyze the AI tools for business revenue niche. Identify what content is going viral RIGHT NOW (March 2026).

Return JSON with this exact structure:
{
  "scannedAt": "${new Date().toISOString()}",
  "topTrends": [
    {
      "trend": "trend name",
      "platform": "TikTok|LinkedIn|YouTube|X",
      "hookPattern": "the hook pattern driving it",
      "engagementDriver": "why it works — curiosity/utility/identity/emotional",
      "estimatedSearchVolume": "high/medium/low",
      "monetizationFit": "high/medium/low for AI tools products",
      "urgency": "trending now/emerging/evergreen"
    }
  ],
  "hookTypesWinning": ["list of hook archetypes currently dominating niche"],
  "contentFormatsWinning": ["formats getting most algorithmic push right now"],
  "avoidPatterns": ["patterns that are oversaturated or getting suppressed"],
  "weeklyIntel": "2-3 sentence summary of what is working in AI tools niche this week"
}

Top 10 trends. Focus on: cold email AI, outreach automation, AI writing tools, 
building AI products, indie hacker revenue reveals, AI productivity tools.
`);

  const repo = loadJSON(KNOWLEDGE_REPO, { archives: {} });
  if (!repo.archives.trends) repo.archives.trends = [];
  repo.archives.trends.unshift({ ...trends, week: new Date().toISOString().slice(0, 10) });
  repo.archives.trends = repo.archives.trends.slice(0, 12); // keep 12 weeks
  saveJSON(KNOWLEDGE_REPO, repo);

  log(`✅ [TREND SCANNER] Found ${trends.topTrends?.length || 0} trends. Top: "${trends.topTrends?.[0]?.trend}"`);
  log(`   Intel: ${trends.weeklyIntel}`);
  return trends;
}

// ══════════════════════════════════════════════════════════════════════════════
// AGENT 2 — AUDIENCE INTELLIGENCE
// Analyzes pain points, questions, emotional triggers for AI tools buyers
// ══════════════════════════════════════════════════════════════════════════════
async function audienceIntelligenceAgent() {
  log('🧠 [AUDIENCE INTEL] Analyzing AI tools buyer psychology...');

  const portfolio = loadJSON(join(__dirname, '../public/portfolio.json'), []);
  const products = Array.isArray(portfolio) ? portfolio : (portfolio.products || []);
  const productNames = products.map(p => p.name || p.title).filter(Boolean).join(', ');

  const intel = await groqJSON(`
You are the Audience Intelligence Agent analyzing buyers of AI tools for business productivity.
Products being sold: ${productNames || 'Cold Email Writer, FollowUp Writer, SubjectLine Pro, AI Copywriter'}

Analyze the target audience: sales professionals, entrepreneurs, small business owners, 
freelancers who send cold emails and do business outreach.

Return JSON:
{
  "analyzedAt": "${new Date().toISOString()}",
  "primaryPainPoints": [
    {
      "pain": "specific pain statement",
      "intensity": "burning/moderate/mild",
      "contentHook": "how to turn this into a hook",
      "productMatch": "which product solves this"
    }
  ],
  "topQuestions": [
    {
      "question": "exact question they ask",
      "emotionalTrigger": "fear/desire/identity/curiosity",
      "contentIdea": "video concept that answers this"
    }
  ],
  "identitySignals": ["what they aspire to be called", "how they see themselves"],
  "languagePhrases": ["exact words they use to describe their problem"],
  "buyingTriggers": ["what tips them from viewer to buyer"],
  "contentGaps": ["topics nobody in niche is covering well — opportunity for you"]
}

Give deep, specific insights. No vague platitudes.
`);

  const repo = loadJSON(KNOWLEDGE_REPO, { archives: {} });
  if (!repo.archives.audience) repo.archives.audience = [];
  repo.archives.audience.unshift(intel);
  repo.archives.audience = repo.archives.audience.slice(0, 5);
  saveJSON(KNOWLEDGE_REPO, repo);

  log(`✅ [AUDIENCE INTEL] ${intel.primaryPainPoints?.length || 0} pain points · ${intel.topQuestions?.length || 0} questions mapped`);
  return intel;
}

// ══════════════════════════════════════════════════════════════════════════════
// AGENT 3 — IDEA GENERATOR (20+ ideas per cycle)
// ══════════════════════════════════════════════════════════════════════════════
async function ideaGeneratorAgent(trendData, audienceData) {
  log('💡 [IDEA GENERATOR] Generating 20+ content ideas...');

  const hookLib = loadJSON(HOOK_LIBRARY, { hooks: [] });
  const topHooks = hookLib.hooks?.slice(0, 5).map(h => h.hookText).join('\n') || 'none yet';

  const ideas = await groqJSON(`
You are the Idea Generator Agent for an AI tools content creator.
Mission: Generate 12 content ideas optimized for maximum algorithmic distribution.

TREND DATA:
Top trends: ${JSON.stringify(trendData?.topTrends?.slice(0, 5) || [])}
Winning formats: ${JSON.stringify(trendData?.contentFormatsWinning || [])}

AUDIENCE INTEL:
Top pain points: ${JSON.stringify(audienceData?.primaryPainPoints?.slice(0, 5) || [])}
Top questions: ${JSON.stringify(audienceData?.topQuestions?.slice(0, 5) || [])}

TOP PERFORMING HOOKS SO FAR:
${topHooks}

Generate ideas covering these SOURCE SIGNALS:
1. Audience questions (at least 5 ideas)
2. Trending patterns (at least 4 ideas)  
3. Competitor outlier patterns (at least 4 ideas)
4. Personal/founder story (at least 3 ideas)
5. Data/research insight (at least 5 ideas)
6. Contrarian opinion (at least 4 ideas)

Return JSON:
{
  "generatedAt": "${new Date().toISOString()}",
  "ideas": [
    {
      "id": "IDEA-001",
      "topic": "specific topic",
      "sourceSignal": "audience_question|trending|competitor|founder_story|data|contrarian",
      "hookAngle": "the opening hook — first sentence exactly",
      "valueType": "insight|emotional|utility|identity",
      "platformFit": ["TikTok", "LinkedIn", "YouTube", "X"],
      "formatSuggestion": "screen_demo|talking_head|carousel|thread|tutorial",
      "cta": "what viewer should do after watching",
      "productTie": "which product it naturally drives to",
      "priority": "high|medium|low",
      "estimatedRetentionScore": "1-10 based on hook strength"
    }
  ],
  "top5Selected": ["IDEA-001", "IDEA-002", "IDEA-003", "IDEA-004", "IDEA-005"]
}

PRIORITY CRITERIA: utility value × hook strength × trend momentum.
Top 5 must include at least 1 contrarian, 1 revenue reveal, 1 product demo.
`);

  saveJSON(IDEAS_BANK, { ...loadJSON(IDEAS_BANK, {}), ...ideas, updatedAt: new Date().toISOString() });
  log(`✅ [IDEA GENERATOR] ${ideas.ideas?.length || 0} ideas. Top 5: ${ideas.top5Selected?.join(', ')}`);
  return ideas;
}

// ══════════════════════════════════════════════════════════════════════════════
// AGENT 4 — CONTENT VALUE GATE
// Rejects any idea that fails the 4-value filter
// ══════════════════════════════════════════════════════════════════════════════
async function contentValueGate(ideas) {
  log('🔒 [VALUE GATE] Filtering ideas through 4-value quality gate...');

  const top5Ids = ideas.top5Selected || [];
  const top5 = (ideas.ideas || []).filter(i => top5Ids.includes(i.id));

  const gated = await groqJSON(`
You are the Content Value Gate enforcing quality standards for AI creator content.

FILTER RULE: Every idea must pass AT LEAST ONE of:
- INSIGHT: teaches something the audience didn't know
- EMOTIONAL: creates surprise, humor, inspiration, or catharsis  
- UTILITY: solves a concrete real problem for the viewer
- IDENTITY: reinforces/elevates the viewer's self-image as a smart, successful operator

IDEAS TO EVALUATE:
${JSON.stringify(top5)}

Return JSON:
{
  "gateCheckedAt": "${new Date().toISOString()}",
  "results": [
    {
      "id": "IDEA-001",
      "insightPass": true,
      "emotionalPass": false,
      "utilityPass": true,
      "identityPass": false,
      "overallPass": true,
      "primaryValue": "utility",
      "gateComment": "why it passed or failed",
      "improvedHook": "rewritten hook if needed, or null if hook is strong"
    }
  ],
  "approvedIdeas": ["list of IDs that passed"],
  "rejectedIdeas": ["list of IDs that failed all 4 — MUST be rewritten"],
  "gatePassRate": 0.8
}
`);

  log(`✅ [VALUE GATE] ${gated.approvedIdeas?.length || 0}/${top5.length} ideas passed. Rate: ${((gated.gatePassRate || 0) * 100).toFixed(0)}%`);
  if (gated.rejectedIdeas?.length > 0) {
    log(`⚠️  [VALUE GATE] REJECTED: ${gated.rejectedIdeas.join(', ')} — will be rewritten`);
  }
  return gated;
}

// ══════════════════════════════════════════════════════════════════════════════
// AGENT 5 — HOOK ENGINEER (8-10 hook variations per approved idea)
// ══════════════════════════════════════════════════════════════════════════════
async function hookEngineerAgent(approvedIdeas, allIdeas) {
  log('🪝 [HOOK ENGINEER] Engineering 8-10 hooks per approved idea...');

  const hookLib = loadJSON(HOOK_LIBRARY, { hooks: [], templates: [] });
  const approved = (allIdeas.ideas || []).filter(i => (approvedIdeas.approvedIdeas || []).includes(i.id));

  const engineered = [];

  for (const idea of approved.slice(0, 3)) { // Top 3 approved
    const hooks = await groqJSON(`
You are the Hook Engineer Agent. Your ONLY job is creating scroll-stopping hooks.
Hooks are the #1 determinant of algorithmic distribution. Master this or fail.

IDEA:
Topic: ${idea.topic}
Value Type: ${idea.valueType}
Hook Angle: ${idea.hookAngle}
Platform Fit: ${idea.platformFit?.join(', ')}

HOOK TYPES TO USE (generate at least one of each applicable):
- H1 INCOME REVEAL: Start with a specific dollar amount or metric result
- H2 BEFORE/AFTER: Contrast old state vs new state with specific numbers
- H3 CONTRARIAN: Challenge what "everyone" believes — with data to back it
- H4 COUNTDOWN/LIST: Promise a specific number of items ("5 AI tools that...")  
- H5 REAL-TIME DEMO: Start mid-action ("Watch me write this cold email in 90 seconds")
- H6 PAIN AGITATION: Call out the exact problem they're suffering right now
- H7 URGENCY/FOMO: Something happening now that they'll miss if they don't watch

RULES:
- First 3 words of every hook must be magnetic — no "Hey guys", no "So today"
- Every hook must be deliverable in under 3 seconds when spoken
- Hook must create an open loop — viewer MUST watch to get the payoff
- The hook MUST be true — no fabricated claims

Return JSON:
{
  "ideaId": "${idea.id}",
  "topic": "${idea.topic}",
  "hooks": [
    {
      "hookId": "H01",
      "type": "INCOME_REVEAL|BEFORE_AFTER|CONTRARIAN|COUNTDOWN|DEMO|PAIN|URGENCY",
      "text": "exact hook text — what will be said/shown in first 3 seconds",
      "platform": "TikTok|LinkedIn|YouTube|X",
      "openLoop": "what question is left open that forces the viewer to continue",
      "expectedRetentionScore": "1-10",
      "payoffRequired": "exactly what the video MUST deliver to fulfill this hook"
    }
  ],
  "recommendedHook": "H01",
  "recommendationReason": "why this hook wins over the others"
}

Generate 8 hooks. Strong variety across all 7 types.
`);
    engineered.push(hooks);
    await sleep(1000);
  }

  // Update hook library with new hooks
  const newHooks = engineered.flatMap(e =>
    (e.hooks || []).map(h => ({
      hookId: `${Date.now()}-${h.hookId}`,
      ideaId: e.ideaId,
      hookText: h.text,
      type: h.type,
      platform: h.platform,
      expectedScore: h.expectedRetentionScore,
      createdAt: new Date().toISOString(),
      status: 'pending_test', // becomes 'tested' after posting
    }))
  );

  hookLib.hooks = [...newHooks, ...(hookLib.hooks || [])].slice(0, 200);
  hookLib.lastUpdated = new Date().toISOString();
  saveJSON(HOOK_LIBRARY, hookLib);

  log(`✅ [HOOK ENGINEER] ${engineered.length} idea sets · ${newHooks.length} hooks generated · Library now: ${hookLib.hooks.length}`);
  return engineered;
}

// ══════════════════════════════════════════════════════════════════════════════
// AGENT 6 — SCRIPT ARCHITECT
// Full script: Hook → Setup → Value → Example → Insight → CTA
// ══════════════════════════════════════════════════════════════════════════════
async function scriptArchitectAgent(hookedIdeas, allIdeas) {
  log('📝 [SCRIPT ARCHITECT] Writing full scripts with retention mechanics...');

  ensure(SCRIPTS_DIR);
  const scripts = [];

  for (const hookSet of hookedIdeas.slice(0, 2)) { // Top 2 ideas get full scripts
    const idea = (allIdeas.ideas || []).find(i => i.id === hookSet.ideaId);
    if (!idea) continue;

    const selectedHook = hookSet.hooks?.find(h => h.hookId === hookSet.recommendedHook) || hookSet.hooks?.[0];
    if (!selectedHook) continue;

    const script = await groqJSON(`
You are the Script Architect Agent. Build complete video scripts with embedded retention mechanics.

IDEA: ${idea.topic}
SELECTED HOOK: "${selectedHook.text}"
HOOK TYPE: ${selectedHook.type}
PAYOFF REQUIRED: ${selectedHook.payoffRequired}
VALUE TYPE: ${idea.valueType}
PLATFORM: ${idea.platformFit?.[0] || 'TikTok'}
TARGET LENGTH: 60-90 seconds for TikTok/Reels, 5-15 min for YouTube

RETENTION MECHANICS TO EMBED:
- At second 8: curiosity injector #1 — new question or partial reveal
- At second 20: curiosity injector #2 — setup the "here's the catch/secret"
- At second 45: curiosity injector #3 — "and there's one more thing..."
- Final 10s: CTA that drives DM sends (strongest Instagram signal) 

STRUCTURE REQUIRED:
1. HOOK (0-3s): Exact hook text from above
2. PATTERN INTERRUPT (3-8s): Visual or verbal shift that holds attention
3. SETUP (8-15s): Context + curiosity injector #1
4. VALUE DELIVERY (15-40s): Main content — the actual insight/demo/story
5. CURIOSITY INJECTOR #2 (20s mark): Embedded naturally
6. EXAMPLE/PROOF (40-60s): Real example, real numbers, real result
7. CURIOSITY INJECTOR #3 (45s mark): Teases one more thing
8. INSIGHT (60-75s): The non-obvious takeaway they didn't expect
9. CTA (75-90s): Comment "X" to get Y / DM trigger / Save prompt

Return JSON:
{
  "scriptId": "SCRIPT-${Date.now()}",
  "ideaId": "${idea.id}",
  "hookUsed": "${selectedHook.text}",
  "targetPlatform": "${idea.platformFit?.[0] || 'TikTok'}",
  "estimatedLength": "60-90 seconds",
  "script": [
    {
      "timestamp": "0-3s",
      "section": "HOOK",
      "words": "exact words to say",
      "visual": "what to show on screen",
      "retentionMechanic": "none|curiosity_injector|pattern_interrupt|payoff_delivery"
    }
  ],
  "ctaStrategy": {
    "type": "dm_trigger|comment_hook|save_prompt|link_in_bio",
    "exactWords": "exact CTA text",
    "expectedSignal": "DM sends|saves|comments"
  },
  "contentValueGateCheck": {
    "insightDelivered": true,
    "utilityDelivered": true,
    "hookPayoffAligned": true,
    "noFiveSlip": true
  },
  "recordingNotes": "what the creator needs to do/show while recording"
}
`);

    // Save script to file
    const scriptFile = join(SCRIPTS_DIR, `${script.scriptId}.json`);
    saveJSON(scriptFile, script);
    scripts.push(script);
    await sleep(1000);
  }

  log(`✅ [SCRIPT ARCHITECT] ${scripts.length} full scripts written to ${SCRIPTS_DIR}`);
  return scripts;
}

// ══════════════════════════════════════════════════════════════════════════════
// AGENT 7 — RETENTION OPTIMIZER
// Reviews scripts and injects retention mechanics
// ══════════════════════════════════════════════════════════════════════════════
async function retentionOptimizerAgent(scripts) {
  log('🔁 [RETENTION OPTIMIZER] Auditing scripts for watch-time leaks...');

  const optimized = [];
  for (const script of scripts) {
    const audit = await groqJSON(`
You are the Retention Optimizer Agent. Find every moment a viewer might swipe away and fix it.

SCRIPT TO AUDIT:
${JSON.stringify(script.script || [])}

RETENTION RULES:
- No 10-second stretch without new visual, new information, or new question
- Every section must leave an open question or promise for the next section
- The hook's payoff must be clearly visible at the END — don't bury it
- Mid-video hook (20-30s mark) catches re-openers scrolling back through
- Use "but wait..." / "here's what's surprising..." / "now here's the part nobody talks about" as natural injectors

Return JSON:
{
  "scriptId": "${script.scriptId}",
  "retentionLeaks": [
    {
      "timestamp": "20-25s",
      "issue": "what makes viewers swipe here",
      "fix": "exact fix to implement"
    }
  ],
  "optimizedSections": [
    {
      "originalTimestamp": "20-25s",
      "issue": "retention leak",
      "originalWords": "original text",
      "improvedWords": "optimized text with retention mechanic added"
    }
  ],
  "retentionScore": 7,
  "predictedWatchTime": "65%",
  "hookPayoffAligned": true,
  "approvedForProduction": true
}
`);
    optimized.push({ ...script, retentionAudit: audit });
    await sleep(800);
  }

  log(`✅ [RETENTION OPTIMIZER] ${optimized.length} scripts optimized. Avg predicted watch time: ${optimized.map(o => parseInt(o.retentionAudit?.predictedWatchTime || '60')).reduce((a, b) => a + b, 0) / optimized.length
    }%`);
  return optimized;
}

// ══════════════════════════════════════════════════════════════════════════════
// AGENT 8 — PLATFORM ADAPTER
// Generates platform-specific versions of each script
// ══════════════════════════════════════════════════════════════════════════════
async function platformAdapterAgent(scripts) {
  log('📡 [PLATFORM ADAPTER] Adapting content for all 7 platforms...');

  const adaptations = [];
  for (const script of scripts) {
    const adapted = await groqJSON(`
You are the Platform Adapter Agent. Take one script and adapt it for every platform.

CORE SCRIPT:
Hook: ${script.hookUsed}
Topic: Find from scriptId ${script.scriptId}
CTA: ${JSON.stringify(script.ctaStrategy)}

PLATFORM RULES:
- TikTok: Raw/authentic. First frame = motion. Hashtags at end (2-4). Hook text overlay in first 2s.
- Instagram Reels: Same as TikTok but caption goes deeper with 3-5 relevant hashtags. Cover frame matters.
- YouTube Shorts: Add title (keyword-optimized). Thumbnail concept. No hashtag stuffing.
- YouTube Long (if tutorial-worthy): Full 8-15 min expansion. SEO title. 5 chapters.
- LinkedIn: Native text post. NO external link in body (kills reach). Hook = first 1.5 lines. Quote the stat/number first.
- X/Twitter: Thread format. Tweet 1 = hook. Thread = value. Last tweet = CTA/product link. Max 280 chars each.
- Threads: Conversational. Shorter than X. Single post or 2-3 part.

Return JSON:
{
  "scriptId": "${script.scriptId}",
  "adaptations": {
    "tiktok": {
      "caption": "caption text",
      "hashtags": ["#ai", "#coldemail"],
      "firstFrame": "what to show in frame 1",
      "textOverlay": "3-word hook text",
      "postTime": "6pm-9pm local or 7am-9am",
      "estimatedReach": "discovery feed"
    },
    "instagram_reels": {
      "caption": "caption",
      "hashtags": ["#ai"],
      "coverFrame": "cover description",
      "audioNote": "trending sound recommendation"
    },
    "youtube_shorts": {
      "title": "SEO keyword title",
      "thumbnailConcept": "thumbnail description",
      "description": "first 2 lines visible before fold"
    },
    "linkedin": {
      "post": "full LinkedIn post text — hook in first 1.5 lines before 'see more' truncation",
      "hashtags": ["#ai"],
      "note": "no external link in post body"
    },
    "twitter_x": {
      "thread": [
        {"tweet": 1, "text": "hook tweet — ≤280 chars"},
        {"tweet": 2, "text": "value tweet"},
        {"tweet": 3, "text": "example/proof"},
        {"tweet": 4, "text": "CTA with product link"}
      ]
    },
    "threads": {
      "post": "conversational version"
    }
  },
  "publishingSchedule": {
    "tiktok": "post first — discovery platform",
    "instagram_reels": "within 2 hours of TikTok",
    "youtube_shorts": "same day",
    "linkedin": "next morning 8am",
    "twitter_x": "same day after TikTok hits",
    "threads": "evening"
  }
}
`);
    adaptations.push(adapted);
    await sleep(1000);
  }

  log(`✅ [PLATFORM ADAPTER] ${adaptations.length} scripts adapted for 6 platforms each`);
  return adaptations;
}

// ══════════════════════════════════════════════════════════════════════════════
// AGENT 9 — CONTENT QUEUE PUBLISHER
// Formats everything for distribution and creates action brief for creator
// ══════════════════════════════════════════════════════════════════════════════
async function publishingAgent(scripts, adaptations) {
  log('🚀 [PUBLISHING AGENT] Building content queue and creator brief...');

  const queue = loadJSON(CONTENT_QUEUE, { queue: [], history: [] });
  const newItems = [];

  for (let i = 0; i < scripts.length; i++) {
    const script = scripts[i];
    const adaptation = adaptations[i];

    const item = {
      queueId: `Q-${Date.now()}-${i}`,
      status: 'ready_to_record',
      createdAt: new Date().toISOString(),
      scriptId: script.scriptId,
      hookUsed: script.hookUsed,
      primaryPlatform: script.targetPlatform,
      recordingInstructions: script.recordingNotes,
      script: script.script,
      retentionAudit: script.retentionAudit,
      platformAdaptations: adaptation?.adaptations,
      publishingSchedule: adaptation?.publishingSchedule,
      ctaStrategy: script.ctaStrategy,
      engagementActions: {
        first60min: 'Respond to EVERY comment. DM every person who comments.',
        velocityPrime: 'Ask 3 people you know to engage within first 10 minutes of posting.',
        dmTemplate: 'Hey [name] — saw you commented on my post. Here\'s the full resource: [link]'
      },
      metrics: {
        target3secRetention: '≥60%',
        targetWatchTime: '≥50%',
        targetNonFollowerReach: '≥30%',
        signalWindow: '1hr + 24hr',
        cycleLogRequired: true
      }
    };
    newItems.push(item);
  }

  queue.queue = [...newItems, ...queue.queue].slice(0, 50);
  queue.lastUpdated = new Date().toISOString();
  saveJSON(CONTENT_QUEUE, queue);

  // Print actionable brief
  console.log('\n' + '═'.repeat(70));
  console.log('🎬 CREATOR ACTION BRIEF — CONTENT READY TO RECORD');
  console.log('═'.repeat(70));

  for (const item of newItems) {
    console.log(`\n📹 CONTENT #${item.queueId}`);
    console.log(`🪝 HOOK: "${item.hookUsed}"`);
    console.log(`🎯 PRIMARY PLATFORM: ${item.primaryPlatform}`);
    console.log(`📋 SCRIPT SECTIONS: ${item.script?.length || 0} sections`);
    console.log(`⚡ RECORDING NOTES: ${item.recordingInstructions || 'Screen record + voiceover'}`);
    console.log(`📊 TARGET METRICS: 3-sec ≥60% · Watch time ≥50% · Non-follower reach ≥30%`);
    console.log(`💬 CTA: ${item.ctaStrategy?.exactWords || 'Comment "AI" for the free tool'}`);
    console.log(`\n🗓️ PUBLISH SCHEDULE:`);
    if (item.publishingSchedule) {
      Object.entries(item.publishingSchedule).forEach(([platform, timing]) => {
        console.log(`   ${platform}: ${timing}`);
      });
    }
    console.log('-'.repeat(70));
  }

  log(`✅ [PUBLISHING AGENT] ${newItems.length} items in content queue. Queue file: ${CONTENT_QUEUE}`);
  return newItems;
}

// ══════════════════════════════════════════════════════════════════════════════
// AGENT 10 — ANALYTICS READER
// Reads performance data (or seeds first cycle with benchmarks)
// ══════════════════════════════════════════════════════════════════════════════
async function analyticsAgent() {
  log('📊 [ANALYTICS] Reading cycle performance data...');

  const cycleLog = loadJSON(CYCLE_LOG, { cycles: [], lastUpdated: null });
  const recentCycles = (cycleLog.cycles || []).slice(0, 10);

  if (recentCycles.length === 0) {
    log('   📊 No cycles yet. Seeding baseline targets...');
    const baseline = {
      cycleId: 'BASELINE',
      date: new Date().toISOString(),
      status: 'baseline',
      targets: {
        '3secRetention': '≥60%',
        'watchTime': '≥50%',
        'saveRate': '≥4%',
        'dmRate': '≥3%',
        'nonFollowerReach': '≥30%',
        'commentRate': '≥1.5%'
      },
      note: 'First cycle — no data yet. Track first post metrics within 1hr of publishing.'
    };
    cycleLog.cycles = [baseline];
    cycleLog.lastUpdated = new Date().toISOString();
    saveJSON(CYCLE_LOG, cycleLog);
    return { status: 'baseline_set', message: 'Ready for first post. Log metrics after publishing.' };
  }

  // Analyze recent cycle trends
  const analysis = await groqJSON(`
You are the Analytics Agent analyzing content performance data.

RECENT CYCLES (last ${recentCycles.length}):
${JSON.stringify(recentCycles)}

Analyze performance trends and flag:
1. Any cycles above outlier benchmark (3-sec ≥60%, watch time ≥50%)
2. Plateau detection (3+ consecutive cycles below target)
3. Best performing hook type
4. Platform sending most non-follower reach
5. Recommended adjustment for next cycle

Return JSON:
{
  "analyzedAt": "${new Date().toISOString()}",
  "totalCycles": ${recentCycles.length},
  "avgRetention3sec": "calculated average",
  "avgWatchTime": "calculated average",
  "bestHookType": "which hook type performed best",
  "bestPlatform": "which platform drove most non-follower reach",
  "plateauDetected": false,
  "plateauCause": null,
  "viralPosts": ["any post that hit 3x above average"],
  "keyInsights": ["top 3-5 actionable insights from data"],
  "nextCycleRecommendation": "exactly what to change for next post",
  "masteryProgress": "0-100% towards Hook Engineering mastery gate"
}`);

  log(`✅ [ANALYTICS] ${recentCycles.length} cycles analyzed. Mastery progress: ${analysis.masteryProgress || '0%'}`);
  return analysis;
}

// ══════════════════════════════════════════════════════════════════════════════
// AGENT 11 — OPTIMIZATION AGENT
// Determines exact adjustments for next cycle
// ══════════════════════════════════════════════════════════════════════════════
async function optimizationAgent(analyticsData, ideas, hookLib) {
  log('⚡ [OPTIMIZATION] Computing next-cycle improvements...');

  const optimization = await groqJSON(`
You are the Optimization Agent. Your job: ensure EVERY cycle improves on the last.
"Every post improves the next" is the north star.

ANALYTICS INPUT:
${JSON.stringify(analyticsData)}

IDEAS BANK (pending test):
Top ideas: ${(ideas?.top5Selected || []).join(', ')}

HOOK LIBRARY STATUS:
Total hooks: ${hookLib?.hooks?.length || 0}
Best performing type: ${analyticsData?.bestHookType || 'not yet determined'}

Determine:
1. What specifically to change in next cycle
2. Any plateau intervention needed  
3. Which hook archetype to test next
4. Which platform to prioritize for maximum algorithmic lift
5. Anti-burnout gate status

Return JSON:
{
  "optimizationId": "OPT-${Date.now()}",
  "createdAt": "${new Date().toISOString()}",
  "currentSkill": "Hook Engineering",
  "currentPhase": "baseline|early|mid|advanced|mastery",
  "nextCycleHookType": "which hook archetype to use next",
  "nextCyclePlatformPriority": "TikTok|LinkedIn|YouTube",
  "nextCycleFormat": "screen_demo|talking_head|carousel|thread",
  "plateauIntervention": null,
  "antiBurnoutGate": {
    "sustainable": true,
    "currentPostingVelocity": "0/day",
    "recommendedVelocity": "1/day",
    "formatSimplificationNeeded": false
  },
  "masteryGateStatus": {
    "3secRetentionMet": false,
    "watchTimeMet": false,
    "nonFollowerReachMet": false,
    "postsNeeded": 10,
    "postsCompleted": 0,
    "estimatedDaysToMastery": 14
  },
  "actionItems": [
    "Action 1 — do this before next post",
    "Action 2",
    "Action 3"
  ]
}
`);

  log(`✅ [OPTIMIZATION] Phase: ${optimization.currentPhase} · Days to mastery: ${optimization.masteryGateStatus?.estimatedDaysToMastery || 14}`);
  return optimization;
}

// ══════════════════════════════════════════════════════════════════════════════
// AGENT 12 — KNOWLEDGE REPOSITORY AGENT
// Updates all 7 archives after every cycle
// ══════════════════════════════════════════════════════════════════════════════
async function knowledgeRepositoryAgent(trendData, audienceData, ideas, hookData, scripts, analytics, optimization) {
  log('🗄️  [KNOWLEDGE REPO] Updating all 7 archives...');

  const repo = loadJSON(KNOWLEDGE_REPO, { archives: {}, lastFullUpdate: null, cycleCount: 0 });

  // Archive 1: Hook Library — top 20% flagged as reusable templates
  const hookLib = loadJSON(HOOK_LIBRARY, { hooks: [] });
  const reusableTemplates = (hookLib.hooks || [])
    .filter(h => h.actual3secRetention && parseFloat(h.actual3secRetention) >= 60)
    .slice(0, 30);

  // Archive 2: Winning Formats
  if (!repo.archives.winningFormats) repo.archives.winningFormats = [];
  if (analytics?.bestPlatform) {
    repo.archives.winningFormats.push({
      format: analytics?.bestHookType || 'demo',
      platform: analytics?.bestPlatform,
      avgWatchTime: analytics?.avgWatchTime,
      addedAt: new Date().toISOString()
    });
  }

  // Archive 3: Retention Structures from scripts
  if (!repo.archives.retentionStructures) repo.archives.retentionStructures = [];
  for (const s of scripts || []) {
    if (s.retentionAudit?.predictedWatchTime && parseFloat(s.retentionAudit.predictedWatchTime) >= 55) {
      repo.archives.retentionStructures.push({
        scriptId: s.scriptId,
        hook: s.hookUsed,
        structure: s.script?.map(sec => sec.section).join(' → '),
        predictedWatch: s.retentionAudit.predictedWatchTime,
        addedAt: new Date().toISOString()
      });
    }
  }

  // Archive 4: Audience Intelligence
  if (!repo.archives.audience) repo.archives.audience = [];
  // Already populated by audienceIntelligenceAgent

  // Archive 5: Outlier Patterns from trend scan
  if (!repo.archives.outlierPatterns) repo.archives.outlierPatterns = [];
  (trendData?.topTrends || []).slice(0, 5).forEach(t => {
    if (t.monetizationFit === 'high') {
      repo.archives.outlierPatterns.push({ ...t, addedAt: new Date().toISOString() });
    }
  });

  // Archive 6: Experiment log
  if (!repo.archives.experimentLog) repo.archives.experimentLog = [];
  // Populated when cycles complete with actual metrics

  // Archive 7: Series ideas
  if (!repo.archives.seriesIdeas) repo.archives.seriesIdeas = [];
  const series = await groqJSON(`
You are the Knowledge Repository Agent. Based on the content created this cycle, generate 3 content series ideas.

CONTEXT:
Niche: AI Tools for Business Revenue
Products: Cold Email Writer, FollowUp Writer, SubjectLine Pro
Winning trends: ${JSON.stringify(trendData?.topTrends?.slice(0, 3))}
Audience questions: ${JSON.stringify(audienceData?.topQuestions?.slice(0, 3))}

Generate 3 series that would build return viewership. Each series = 8-12 episodes minimum.
Examples: "Building a $10K/day AI business in public", "Replace your entire sales team with AI tools"

Return JSON:
{
  "series": [
    {
      "title": "series title",
      "concept": "1 sentence concept",
      "episodeCount": 10,
      "episodeTitles": ["Ep 1 title", "Ep 2 title"],
      "returnViewerAppeal": "high|medium",
      "monetizationPath": "which product/offer it naturally drives to",
      "validationSignal": "how to know if audience wants this series"
    }
  ]
}
`);
  repo.archives.seriesIdeas = [...(series.series || []), ...repo.archives.seriesIdeas].slice(0, 20);

  repo.hookLibraryReusableTemplates = reusableTemplates;
  repo.cycleCount = (repo.cycleCount || 0) + 1;
  repo.lastFullUpdate = new Date().toISOString();
  repo.currentSkillMastery = optimization?.masteryGateStatus;
  saveJSON(KNOWLEDGE_REPO, repo);

  log(`✅ [KNOWLEDGE REPO] All 7 archives updated. Cycle ${repo.cycleCount}. Reusable templates: ${reusableTemplates.length}`);
  return repo;
}

// ══════════════════════════════════════════════════════════════════════════════
// ORCHESTRATOR — Runs full ACOS cycle
// ══════════════════════════════════════════════════════════════════════════════
async function runACOS() {
  console.log('\n' + '═'.repeat(70));
  console.log('🤖 AI CREATOR OPERATING SYSTEM v4.0');
  console.log('   Multi-Agent Content Growth Engine');
  console.log('   Target: $10,008/day · Skill 1: Hook Engineering');
  console.log('   Domain: AI Tools for Business Revenue');
  console.log('═'.repeat(70) + '\n');

  ensure(ACOS_DIR);
  ensure(SCRIPTS_DIR);

  const startTime = Date.now();
  const results = {};

  try {
    // Phase 1: Intelligence gathering
    console.log('\n📡 PHASE 1 — INTELLIGENCE GATHERING');
    console.log('─'.repeat(50));
    results.trends = await trendScannerAgent();
    await sleep(1000);
    results.audience = await audienceIntelligenceAgent();
    await sleep(1000);

    // Phase 2: Ideation + Gate
    console.log('\n💡 PHASE 2 — IDEATION + VALUE GATE');
    console.log('─'.repeat(50));
    results.ideas = await ideaGeneratorAgent(results.trends, results.audience);
    await sleep(1000);
    results.gated = await contentValueGate(results.ideas);
    await sleep(1000);

    // Phase 3: Content Engineering
    console.log('\n🏗️  PHASE 3 — CONTENT ENGINEERING');
    console.log('─'.repeat(50));
    results.hooks = await hookEngineerAgent(results.gated, results.ideas);
    await sleep(1000);
    results.scripts = await scriptArchitectAgent(results.hooks, results.ideas);
    await sleep(1000);
    results.optimizedScripts = await retentionOptimizerAgent(results.scripts);
    await sleep(1000);

    // Phase 4: Distribution prep
    console.log('\n📡 PHASE 4 — PLATFORM ADAPTATION & QUEUE');
    console.log('─'.repeat(50));
    results.adaptations = await platformAdapterAgent(results.optimizedScripts);
    await sleep(1000);
    results.queue = await publishingAgent(results.optimizedScripts, results.adaptations);
    await sleep(1000);

    // Phase 5: Analytics + Optimization
    console.log('\n📊 PHASE 5 — ANALYTICS & OPTIMIZATION');
    console.log('─'.repeat(50));
    results.analytics = await analyticsAgent();
    await sleep(1000);
    results.optimization = await optimizationAgent(
      results.analytics, results.ideas,
      loadJSON(HOOK_LIBRARY, { hooks: [] })
    );
    await sleep(1000);

    // Phase 6: Knowledge Repository update
    console.log('\n🗄️  PHASE 6 — KNOWLEDGE REPOSITORY UPDATE');
    console.log('─'.repeat(50));
    results.repo = await knowledgeRepositoryAgent(
      results.trends, results.audience, results.ideas,
      results.hooks, results.optimizedScripts,
      results.analytics, results.optimization
    );

    // Final summary
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log('\n' + '═'.repeat(70));
    console.log('✅ ACOS CYCLE COMPLETE');
    console.log('═'.repeat(70));
    console.log(`⏱️  Total time: ${elapsed}s`);
    console.log(`💡 Ideas generated: ${results.ideas?.ideas?.length || 0}`);
    console.log(`✅ Ideas approved: ${results.gated?.approvedIdeas?.length || 0}`);
    console.log(`🪝 Hooks engineered: ${results.hooks?.flatMap(h => h.hooks)?.length || 0}`);
    console.log(`📝 Scripts written: ${results.scripts?.length || 0}`);
    console.log(`📡 Platform adaptations: ${results.adaptations?.length || 0} × 6 platforms`);
    console.log(`🎬 Content queue: ${results.queue?.length || 0} items ready to record`);
    console.log(`📊 Mastery progress: ${results.optimization?.masteryGateStatus?.masteryProgress || '0%'}`);
    console.log(`🗄️  Knowledge repo: ${results.repo?.cycleCount || 1} cycles`);
    console.log('');
    console.log('📁 OUTPUT FILES:');
    console.log(`   Hook Library:    ${HOOK_LIBRARY}`);
    console.log(`   Content Queue:   ${CONTENT_QUEUE}`);
    console.log(`   Scripts:         ${SCRIPTS_DIR}/`);
    console.log(`   Knowledge Repo:  ${KNOWLEDGE_REPO}`);
    console.log(`   Cycle Log:       ${CYCLE_LOG}`);
    console.log('');
    console.log('🎯 NEXT ACTION:');
    console.log('   1. Open the content queue');
    console.log('   2. Record the top script using your phone or screen recorder');
    console.log('   3. Post to TikTok first — read 3-sec retention at 1hr');
    console.log('   4. Log results in cycle-log.json');
    console.log('   5. Run this agent again after 10 posts for next cycle');
    console.log('═'.repeat(70));

    return results;

  } catch (err) {
    console.error('\n❌ ACOS CYCLE ERROR:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

runACOS().catch(e => { console.error(e); process.exit(1); });
