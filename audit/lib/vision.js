// Vision pass — sends a homepage screenshot to Claude and asks for honest, specific,
// subjective findings limited to a fixed list of categories. Critiques the site, never the owner.

const ALLOWED_CATEGORIES = [
  'dated look / design era',
  'clutter or confusing layout',
  'inconsistent branding',
  'stock-photo-vs-real-work',
  'trust communicated above the fold',
  'primary call-to-action prominence'
];

const VISION_SYSTEM_PROMPT = `You audit small-business websites for a website-design company. You are shown a mobile screenshot of a contractor's homepage. Give 2-3 honest, specific findings limited strictly to these categories: ${ALLOWED_CATEGORIES.join(', ')}.

Rules:
- Describe the site, never the owner. Never speculate about the business's competence or character.
- Be specific (cite what you actually see: layout, colors, photos, button placement) rather than generic.
- No dollar-loss claims. No emojis. Sentence case only.
- Return findings as a JSON array of strings, nothing else.`;

export async function runVisionPass(screenshotBuffer, { anthropicClient, model = 'claude-sonnet-4-6' }) {
  if (!screenshotBuffer) {
    return { available: false, findings: [], reason: 'no screenshot available' };
  }

  try {
    const response = await anthropicClient.messages.create({
      model,
      max_tokens: 500,
      system: VISION_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: screenshotBuffer.toString('base64')
              }
            },
            { type: 'text', text: 'Audit this homepage screenshot and return the JSON array of findings.' }
          ]
        }
      ]
    });

    const text = response?.content?.find((block) => block.type === 'text')?.text || '[]';
    const findings = JSON.parse(text);
    return { available: true, findings: Array.isArray(findings) ? findings : [] };
  } catch (err) {
    return { available: false, findings: [], reason: `vision pass failed: ${err.message}` };
  }
}
