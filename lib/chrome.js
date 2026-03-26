// api/chrome.js — Chrome Web Store Upload + Publish
// First submission: manual (one-time $5 dev fee + dashboard.chromewebstore.google.com)
// Subsequent updates: fully automated via API

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, ...p } = req.body;

  try {
    switch (action) {
      case 'upload':   return res.json(await uploadExtension(p));
      case 'publish':  return res.json(await publishExtension(p));
      case 'getToken': return res.json(await refreshToken());
      case 'getStatus': return res.json(await getStatus(p.extensionId));
      default: return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// Get fresh OAuth access token using refresh token
async function refreshToken() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.CHROME_CLIENT_ID,
      client_secret: process.env.CHROME_CLIENT_SECRET,
      refresh_token: process.env.CHROME_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await r.json();
  return { access_token: data.access_token, expires_in: data.expires_in };
}

// Upload a new version of an extension (ZIP file as base64)
async function uploadExtension({ extensionId, zipBase64 }) {
  const { access_token } = await refreshToken();
  const BASE = 'https://chromewebstore.googleapis.com/v2/publishers';
  const publisherId = process.env.CHROME_PUBLISHER_ID;

  const zipBuffer = Buffer.from(zipBase64, 'base64');

  const r = await fetch(`${BASE}/${publisherId}/items/${extensionId}:uploadZip`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${access_token}`,
      'Content-Type': 'application/zip',
      'Content-Length': String(zipBuffer.length),
    },
    body: zipBuffer,
  });
  return r.json();
}

// Publish a previously uploaded extension to the store
async function publishExtension({ extensionId, target = 'default' }) {
  const { access_token } = await refreshToken();
  const publisherId = process.env.CHROME_PUBLISHER_ID;

  const r = await fetch(
    `https://chromewebstore.googleapis.com/v2/publishers/${publisherId}/items/${extensionId}:publish?publishTarget=${target}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${access_token}`, 'Content-Length': '0' },
    }
  );
  return r.json();
}

// Get extension status
async function getStatus(extensionId) {
  const { access_token } = await refreshToken();
  const publisherId = process.env.CHROME_PUBLISHER_ID;

  const r = await fetch(
    `https://chromewebstore.googleapis.com/v2/publishers/${publisherId}/items/${extensionId}`,
    { headers: { Authorization: `Bearer ${access_token}` } }
  );
  return r.json();
}
