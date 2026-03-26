// lib/alert.js — Failure alert system (Slack webhook + optional email fallback)
// Never throws — designed to be called from catch() handlers without killing the process.
//
// Setup: set SLACK_WEBHOOK_URL in GitHub Secrets + .env
// Get webhook: https://api.slack.com/messaging/webhooks → Create App → Incoming Webhooks
//
// Usage:
//   import { sendAlert } from '../lib/alert.js';
//   run().catch(async (e) => { await sendAlert('market-agent crashed', { error: e.message }); process.exit(1); });

/**
 * Send a failure alert to Slack (and optionally email via Resend).
 * @param {string} agentName   — e.g. 'market-agent', 'launch-agent'
 * @param {string} message     — human-readable summary of what went wrong
 * @param {Object} context     — optional key-value pairs for extra context
 */
export async function sendAlert(agentName, message, context = {}) {
  const results = await Promise.allSettled([
    notifySlack(agentName, message, context),
    notifyEmail(agentName, message, context),
  ]);

  // Log any alert delivery failures (but never throw)
  for (const r of results) {
    if (r.status === 'rejected') {
      console.error(`[alert] delivery failed: ${r.reason?.message || r.reason}`);
    }
  }
}

// ─── Slack ─────────────────────────────────────────────────────────────────

async function notifySlack(agentName, message, context) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return; // not configured — skip silently

  const fields = Object.entries(context).map(([k, v]) => ({
    type: 'mrkdwn',
    text: `*${k}:*\n${String(v).slice(0, 300)}`,
  }));

  const payload = {
    text: `🚨 *Agent OS — ${agentName} failed*`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🚨 *Agent OS — \`${agentName}\` failed*\n${message}`,
        },
      },
      ...(fields.length ? [{
        type: 'section',
        fields: fields.slice(0, 10), // Slack max 10 fields per block
      }] : []),
      {
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: `⏰ ${new Date().toISOString()} | Repo: ${process.env.GITHUB_REPOSITORY || 'agent-os'}`,
        }],
      },
    ],
  };

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new Error(`Slack webhook returned ${res.status}`);
}

// ─── Email fallback via Resend ──────────────────────────────────────────────

async function notifyEmail(agentName, message, context) {
  const apiKey = process.env.RESEND_API_KEY;
  const ownerEmail = process.env.OWNER_EMAIL;
  // Only send email if Slack webhook is NOT set (avoid double-notification)
  if (!apiKey || !ownerEmail || process.env.SLACK_WEBHOOK_URL) return;

  const contextLines = Object.entries(context)
    .map(([k, v]) => `<tr><td style="padding:4px 8px;font-weight:bold">${k}</td><td style="padding:4px 8px">${String(v).slice(0, 500)}</td></tr>`)
    .join('');

  const html = `
    <h2 style="color:#e53e3e">🚨 Agent OS — <code>${agentName}</code> failed</h2>
    <p>${message}</p>
    ${contextLines ? `<table style="border-collapse:collapse;margin-top:16px">${contextLines}</table>` : ''}
    <p style="color:#718096;margin-top:24px;font-size:12px">
      ${new Date().toISOString()} | agent-os automated alert
    </p>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL || 'alerts@agent-os.app',
      to: [ownerEmail],
      subject: `🚨 Agent OS: ${agentName} failed — ${message.slice(0, 60)}`,
      html,
    }),
  });

  if (!res.ok) throw new Error(`Resend alert returned ${res.status}`);
}

/**
 * Send a success/milestone notification (green, non-urgent).
 * @param {string} agentName
 * @param {string} message
 * @param {Object} context
 */
export async function sendSuccess(agentName, message, context = {}) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    const fields = Object.entries(context).map(([k, v]) => ({
      type: 'mrkdwn',
      text: `*${k}:*\n${String(v).slice(0, 300)}`,
    }));

    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `✅ *Agent OS — ${agentName}*: ${message}`,
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `✅ *Agent OS — \`${agentName}\`*\n${message}` },
          },
          ...(fields.length ? [{ type: 'section', fields: fields.slice(0, 10) }] : []),
        ],
      }),
    });
  } catch (_) { /* never throw from alerts */ }
}
