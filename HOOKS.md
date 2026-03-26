# HOOKS.md — Agent OS v7 Claude Code Hooks Configuration
# Hooks run shell commands automatically before/after Claude tool use.
# Add these to your Claude Code settings to enforce validation on every file write.
# Last updated: 2026-03-26

---

## What Hooks Do Here

Claude Code hooks execute shell commands at specific events. For Agent OS:
- **Before writing HTML**: validate no secrets are being embedded
- **After writing any JS file**: check for raw `fetch()` in agents (should use fetchWithRetry)
- **After writing product HTML**: auto-check for required CONFIG fields
- **Before any Bash tool use**: log the command for audit trail

---

## How to Configure

Open Claude Code settings (`~/.claude/settings.json` or the project `.claude/settings.json`) and add hook entries.

**Project-level hooks** (`.claude/settings.json` in `agent-os/` — affects this project only):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "command",
            "command": "node D:/claude-code/agent-os/.claude/hooks/validate-write.js"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "echo \"[HOOK] Bash: $CLAUDE_TOOL_INPUT\" >> D:/claude-code/agent-os/.claude/hooks/bash-audit.log"
          }
        ]
      }
    ]
  }
}
```

---

## Hook Scripts

### `.claude/hooks/validate-write.js`
Runs after every Write tool call. Checks the file that was just written.

```js
// .claude/hooks/validate-write.js
// Called by Claude Code after any Write tool use.
// Exits 0 = OK. Exits 1 = block the write (Claude sees error and must fix).

const fs = require('fs');
const path = require('path');

const filePath = process.env.CLAUDE_TOOL_OUTPUT_PATH || process.argv[2];
if (!filePath) process.exit(0);

const ext = path.extname(filePath);
const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';

// --- HTML validation (product files) ---
if (ext === '.html' && filePath.includes('index.html')) {
  const errors = [];

  // Security: no server-side secrets in browser HTML
  if (content.includes('sk_live_')) errors.push('CRITICAL: Stripe live key found in HTML');
  if (content.includes('ghp_')) errors.push('CRITICAL: GitHub token found in HTML');
  if (/SUPABASE_SERVICE_KEY/.test(content)) errors.push('CRITICAL: Supabase service key in HTML');
  if (/process\.env/.test(content)) errors.push('WARN: process.env reference in browser HTML');

  // Completeness
  if (!content.includes('</html>')) errors.push('FAIL: HTML file is incomplete (no </html>)');
  if (!content.includes('posthog.capture')) errors.push('WARN: No PostHog events found');
  if (!content.includes('CONFIG.STRIPE_LINK_PRO')) errors.push('WARN: No Stripe payment link in HTML');

  // No Node.js server APIs in browser code
  if (/require\(/.test(content)) errors.push('FAIL: require() found in browser HTML');
  if (/\bfs\b\./.test(content)) errors.push('FAIL: Node.js fs module in browser HTML');

  if (errors.length > 0) {
    console.error('[validate-write] HTML issues found:');
    errors.forEach(e => console.error(' ', e));
    // Only exit 1 on CRITICAL or FAIL (not WARN)
    if (errors.some(e => e.startsWith('CRITICAL') || e.startsWith('FAIL'))) {
      process.exit(1);
    }
  }
}

// --- Agent JS validation ---
if (ext === '.js' && filePath.includes('/agents/')) {
  const errors = [];
  if (!content.includes('fetchWithRetry') && content.includes('fetch(')) {
    errors.push('FAIL: Agent uses raw fetch() — must import fetchWithRetry from lib/fetch-retry.js');
  }
  if (!content.includes('sendAlert')) {
    errors.push('WARN: Agent has no sendAlert import — failure alerts will be silent');
  }
  if (content.includes('process.exit') && !content.includes('process.exit(0)') && !content.includes('process.exit(1)')) {
    errors.push('WARN: Agent uses non-standard exit code');
  }
  if (errors.some(e => e.startsWith('FAIL'))) {
    console.error('[validate-write] Agent issues:');
    errors.filter(e => e.startsWith('FAIL')).forEach(e => console.error(' ', e));
    process.exit(1);
  }
}

// --- API function validation ---
if (ext === '.js' && filePath.includes('/api/')) {
  const hardcodedSecrets = [
    /sk_live_[a-zA-Z0-9]+/,   // Stripe live key
    /ghp_[a-zA-Z0-9]+/,       // GitHub PAT
    /gsk_[a-zA-Z0-9]+/,       // Groq key
    /re_[a-zA-Z0-9]{30,}/,    // Resend key
  ];
  for (const pattern of hardcodedSecrets) {
    if (pattern.test(content)) {
      console.error(`[validate-write] CRITICAL: Hardcoded secret found in ${filePath}`);
      process.exit(1);
    }
  }
}

process.exit(0);
```

---

## Hook Event Reference

| Event | When it fires | Use for |
|-------|--------------|---------|
| `PreToolUse` | Before Claude calls a tool | Block dangerous operations, log commands |
| `PostToolUse` | After Claude calls a tool | Validate output, auto-format, trigger side effects |
| `Stop` | After Claude finishes responding | Auto-update HANDOFF.md, run final validation |
| `SubagentStop` | After a sub-agent finishes | Collect sub-agent output for orchestration |

---

## Recommended Hook: Auto-update HANDOFF.md on Stop

Add this to capture what was done at the end of each session:

```json
{
  "hooks": {
    "Stop": [
      {
        "type": "command",
        "command": "echo \"Session ended: $(date -u +%Y-%m-%d\\ %H:%M\\ UTC)\" >> D:/claude-code/agent-os/.claude/hooks/session-log.txt"
      }
    ]
  }
}
```

---

## Installing Hooks

1. Create `.claude/` directory in `agent-os/` (already exists)
2. Create `.claude/settings.json` with the hook config above
3. Create `.claude/hooks/validate-write.js` with the validation script
4. Test: have Claude write a test HTML file → hook should run automatically

**Check if hooks are running:**
```bash
cat D:/claude-code/agent-os/.claude/hooks/bash-audit.log
```
If the audit log has entries, hooks are active.

---

## Disabling Hooks Temporarily

If a hook is blocking legitimate work, disable it by renaming the script:
```bash
mv .claude/hooks/validate-write.js .claude/hooks/validate-write.js.disabled
```
Re-enable when done.

**Do not delete hook scripts** — they prevent security regressions.
