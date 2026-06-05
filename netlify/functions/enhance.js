// Netlify Function: AI-enhance configurator copy
// POST /netlify/functions/enhance
// Body: { trade, city, biz, phone, notes, services, years, reviews }
// Returns: { headline, tagline, about, cta, services: [{name, desc}] }
//
// Deploy to Netlify with ANTHROPIC_API_KEY set in environment variables.
// Usage: Dave adds his key in Netlify → Site settings → Environment variables.

const https = require('https');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'AI enhancement not configured. Add ANTHROPIC_API_KEY to Netlify environment variables.' })
    };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const { trade = 'Home Services', city = 'Your City', biz = 'Your Business',
          notes = '', years = '', reviews = '' } = body;

  const prompt = `You are writing website copy for a local ${trade} contractor. Be direct, punchy, and local. No fluff.

Business: ${biz}
Trade: ${trade}
City: ${city}
${years ? `Years in business: ${years}` : ''}
${reviews ? `Google reviews: ${reviews}` : ''}
${notes ? `Owner notes: ${notes}` : ''}

Generate website copy in JSON format with these exact fields:
{
  "headline": "short punchy hero headline (max 8 words, all caps style for ${trade})",
  "tagline": "one-line value proposition (max 12 words, no exclamation marks)",
  "about": "2-sentence about paragraph, first-person, mentions ${city}, specific to ${trade} (max 45 words)",
  "cta": "call to action button text (max 5 words, action-forward)",
  "trust_line": "single trust line under hero (e.g. 'Licensed · Insured · Same-day available')",
  "services": [
    {"name": "Service Name", "desc": "10-word max description"},
    {"name": "Service Name", "desc": "10-word max description"},
    {"name": "Service Name", "desc": "10-word max description"},
    {"name": "Service Name", "desc": "10-word max description"},
    {"name": "Service Name", "desc": "10-word max description"},
    {"name": "Service Name", "desc": "10-word max description"}
  ]
}

Return ONLY the JSON object. No markdown, no explanation.`;

  const requestBody = JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }]
  });

  try {
    const result = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(requestBody)
        }
      }, (res) => {
        let data = '';
        res.on('data', c => { data += c; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { reject(new Error('Failed to parse API response')); }
        });
      });
      req.on('error', reject);
      req.write(requestBody);
      req.end();
    });

    if (result.error) {
      return { statusCode: 502, body: JSON.stringify({ error: result.error.message }) };
    }

    const text = result.content?.[0]?.text || '';
    const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
    const enhanced = JSON.parse(cleaned);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(enhanced)
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Enhancement failed. Try again or fill details manually.' })
    };
  }
};
