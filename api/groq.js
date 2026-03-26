// api/groq.js — Server-side Groq proxy
// Products call this instead of Groq directly — keeps key off GitHub

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { messages, model = 'llama-3.3-70b-versatile', max_tokens = 2000, temperature = 0.7, system } = req.body;

  const KEY = process.env.GROQ_API_KEY;
  if (!KEY) return res.status(500).json({ error: 'GROQ_API_KEY not configured' });

  try {
    const msgs = system
      ? [{ role: 'system', content: system }, ...(messages || [])]
      : (messages || []);

    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ model, messages: msgs, temperature, max_tokens }),
    });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    return res.status(200).json(data);
  } catch (e) {
    console.error('[api/groq] Error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
