// api/email.js — Email Operations via Resend (3,000/mo free)
// Actions: send, sequence, welcome, digest, followUp

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, ...p } = req.body;

  try {
    switch (action) {
      case 'send': return res.json(await sendEmail(p));
      case 'welcome': return res.json(await sendWelcome(p));
      case 'sequence': return res.json(await startSequence(p));
      case 'post_payment_sequence': return res.json(await postPaymentSequence(p));
      case 'digest': return res.json(await sendDigest(p));
      case 'followup': return res.json(await sendFollowUp(p));
      default: return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

const FROM = process.env.RESEND_FROM_EMAIL || 'noreply@yourdomain.com';

async function resendSend(payload) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });
  return r.json();
}

// ─── Generic send ─────────────────────────────────────────────────────────────
async function sendEmail({ to, subject, html, text }) {
  return resendSend({ from: FROM, to, subject, html, text });
}

// ─── Welcome email (sent after email capture on product) ─────────────────────
async function sendWelcome({ to, productName, productUrl, freeLimit }) {
  const html = `
<div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
  <h2 style="color:#6366f1">Welcome to ${productName}! 🎉</h2>
  <p>You just got <strong>${freeLimit || 3} extra free uses</strong> — they're ready to go.</p>
  <p>Here's what you can do with ${productName}:</p>
  <ul>
    <li>Save hours on tedious tasks</li>
    <li>Generate professional output in seconds</li>
    <li>Use it as many times as you need</li>
  </ul>
  <a href="${productUrl}" style="display:inline-block;background:#6366f1;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;margin:16px 0">
    Open ${productName} →
  </a>
  <p style="color:#6b7280;font-size:14px">When you hit the free limit, you can unlock unlimited access for $9/mo — no pressure though.</p>
  <p style="color:#6b7280;font-size:14px">Reply to this email anytime with feedback. I read every response.</p>
  <p>— The ${productName} team</p>
</div>`;

  return resendSend({
    from: FROM,
    to,
    subject: `Your extra uses are ready — ${productName}`,
    html,
  });
}

// ─── Sequence: 3-email drip for free → paid conversion ───────────────────────
async function startSequence({ to, productName, productUrl, stripeLink }) {
  // Email 1: send immediately (welcome handled separately)
  // Email 2: value reminder at day 3
  // Email 3: offer at day 7
  // Note: In production, use Resend's scheduled sends or a cron job
  // Here we send email 2 + 3 with Resend's scheduledAt parameter

  const day3 = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
  const day7 = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

  const [r2, r3] = await Promise.all([
    resendSend({
      from: FROM, to,
      subject: `Quick tip for ${productName}`,
      scheduledAt: day3,
      html: `<div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto">
        <p>Hey — just checking in.</p>
        <p>Here's one thing most people don't know about ${productName}: <strong>you can use it for [specific use case] too</strong>, not just the obvious one.</p>
        <p><a href="${productUrl}" style="color:#6366f1">Try it now →</a></p>
        <p style="color:#6b7280;font-size:13px">If ${productName} isn't working for you, just reply and let me know why. I'll fix it or refund you.</p>
      </div>`,
    }),
    resendSend({
      from: FROM, to,
      subject: `${productName} — one week in`,
      scheduledAt: day7,
      html: `<div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto">
        <p>It's been a week since you started using ${productName}.</p>
        <p>If you've been using your free uses, you already know the value.</p>
        <p>Unlock unlimited for <strong>$9/month</strong> — cancel anytime, no questions asked.</p>
        <a href="${stripeLink}" style="display:inline-block;background:#6366f1;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">
          Get Unlimited Access →
        </a>
        <p style="color:#6b7280;font-size:13px;margin-top:16px">Not ready? No worries. You keep your free uses forever.</p>
      </div>`,
    }),
  ]);

  return { email2: r2, email3: r3, sequence: 'started' };
}

// ─── Sequence: Post-Payment Nurture ─────────────────────────────────────────
async function postPaymentSequence({ to, productName, productUrl }) {
  const day3 = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
  const day14 = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();

  const [r2, r3] = await Promise.all([
    resendSend({
      from: FROM, to,
      subject: `How is ${productName} working for you?`,
      scheduledAt: day3,
      html: `<div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto">
        <p>Hey — noticed you upgraded to unlimited on ${productName} a few days ago.</p>
        <p>Just checking in to make sure everything is running smoothly. Reply if you have any feature requests!</p>
        <p><a href="${productUrl}" style="color:#6366f1">Go to ${productName} →</a></p>
      </div>`,
    }),
    resendSend({
      from: FROM, to,
      subject: `Leave a review for ${productName}?`,
      scheduledAt: day14,
      html: `<div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto">
        <p>It's been two weeks!</p>
        <p>If ${productName} has saved you time, I'd love a quick shoutout on Twitter or ProductHunt.</p>
        <p>If not, hit reply and tell me why so I can improve it.</p>
        <p>Thanks for your support.</p>
      </div>`,
    }),
  ]);

  return { email2: r2, email3: r3, sequence: 'post_payment_started' };
}

// ─── Daily digest (sent to owner: MRR, visitors, new leads) ──────────────────
async function sendDigest({ to, data }) {
  const { mrr, visitors, newLeads, topProduct, date } = data;
  const html = `
<div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto">
  <h2>Daily Digest — ${date || new Date().toLocaleDateString()}</h2>
  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <tr style="background:#f9fafb"><th style="padding:12px;text-align:left">Metric</th><th style="padding:12px;text-align:right">Value</th></tr>
    <tr><td style="padding:10px">MRR</td><td style="padding:10px;text-align:right;font-weight:700;color:#6366f1">$${mrr || 0}</td></tr>
    <tr style="background:#f9fafb"><td style="padding:10px">Visitors Today</td><td style="padding:10px;text-align:right">${visitors || 0}</td></tr>
    <tr><td style="padding:10px">New Leads</td><td style="padding:10px;text-align:right">${newLeads || 0}</td></tr>
    <tr style="background:#f9fafb"><td style="padding:10px">Top Product</td><td style="padding:10px;text-align:right">${topProduct || '—'}</td></tr>
  </table>
  <p style="color:#6b7280;font-size:13px">Agent OS Daily Report · Auto-generated</p>
</div>`;

  return resendSend({ from: FROM, to, subject: `Daily Digest — $${mrr || 0} MRR`, html });
}

// ─── Follow-up for leads who captured email but didn't convert ────────────────
async function sendFollowUp({ to, productName, productUrl, stripeLink, daysAgo = 14 }) {
  return resendSend({
    from: FROM, to,
    subject: `Still interested in ${productName}?`,
    html: `<div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto">
      <p>Hey — you signed up for extra uses on ${productName} ${daysAgo} days ago.</p>
      <p>We added some improvements since then. Worth another look?</p>
      <a href="${productUrl}" style="display:inline-block;background:#6366f1;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">
        Check it out →
      </a>
      <p style="color:#6b7280;font-size:13px;margin-top:16px">Unlimited access is $9/mo. <a href="${stripeLink}" style="color:#6366f1">Upgrade here</a> if you're ready.</p>
    </div>`,
  });
}
