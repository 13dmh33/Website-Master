require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL  = 'claude-sonnet-4-6';

/**
 * scoreConversation(answers)
 *
 * Sends the three qualification answers to Claude and gets back a fit score.
 * Returns: { score: 'high'|'mid'|'low', reasoning: string }
 *
 * Scoring rubric (Claude is given this explicitly):
 *   paid_talks_count : 0 = low, 1-4 = mid, 5+ = high
 *   fee_range        : under $2,500 = low, $2,500-$5k = mid, $5k+ = high
 *   topic            : vague/general = low, specific niche = higher
 * Combined score decides routing.
 */
async function scoreConversation(answers) {
  const { paid_talks_count, fee_range, topic } = answers;

  const prompt = `You are a qualification scorer for Reeve, a speaker booking agency. Your job is to evaluate whether a prospective speaker is a good fit for Reeve's services based on three data points.

Scoring rubric:
- Paid speaking engagements in last 12 months: 0 = low fit, 1–4 = mid fit, 5 or more = high fit
- Current keynote fee: under $2,500 = low fit, $2,500–$5,000 = mid fit, $5,000+ = high fit
- Speaking topic/niche: vague or "various topics" = low, general motivation without clear angle = mid, specific niche with clear expertise = high

Prospect answers:
1. Paid talks in last 12 months: ${paid_talks_count || '(not provided)'}
2. Current keynote fee: ${fee_range || '(not provided)'}
3. Primary speaking topic/niche: ${topic || '(not provided)'}

Evaluate all three signals together and return a single JSON object with no markdown formatting:
{
  "score": "high" | "mid" | "low",
  "reasoning": "1–2 sentence plain English explanation of the score"
}

Be strict. Reeve only takes clients who are already earning from speaking and have a clear niche. A vague answer on fee or topic should pull the score down. Do not be charitable — score what was actually said.`;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }]
    });

    const raw = response.content[0].text.trim();

    // Strip markdown code fences if Claude wraps the JSON anyway
    const cleaned = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('[qualifier] Could not parse scoring JSON:', cleaned);
      // Fall back to a safe mid score so we don't silently drop leads
      return { score: 'mid', reasoning: 'Score parsing failed — flagged for manual review.' };
    }

    const score = ['high', 'mid', 'low'].includes(parsed.score) ? parsed.score : 'mid';
    return { score, reasoning: parsed.reasoning || '' };

  } catch (err) {
    console.error('[qualifier] scoreConversation error:', err.message);
    return { score: 'mid', reasoning: 'Scoring API call failed — flagged for manual review.' };
  }
}

/**
 * generateResponse(conversation, incomingMessage)
 *
 * Given the full conversation context and the latest incoming message,
 * returns the next DM text Reeve should send.
 *
 * Voice: confident, direct, not salesy, sentence case.
 * Used when the standard question templates need to be adjusted based on context,
 * or when Claude needs to handle an off-script reply gracefully.
 */
async function generateResponse(conversation, incomingMessage) {
  const { stage, answers, senderName } = conversation;

  const answersBlock = Object.entries(answers)
    .map(([k, v]) => `  ${k}: ${v !== null ? v : '(not yet answered)'}`)
    .join('\n');

  const prompt = `You are Reeve, a speaker booking agency. You are in a qualification conversation over Instagram DM with a prospective speaker${senderName ? ` named ${senderName}` : ''}.

The conversation is in stage "${stage}". Here is what you know so far:
${answersBlock}

Their latest message: "${incomingMessage}"

Your job: write the next message Reeve should send. Guidelines:
- Voice: confident, direct, warm but not salesy. Sentence case (not title case).
- Keep it short — 1–3 sentences max.
- If their message is off-topic or confusing, gently redirect to the qualification question for this stage.
- Do NOT use hashtags, emojis, or marketing language.
- Do NOT reveal that you are an AI.
- Return only the message text — no quotes, no preamble, no explanation.

Stage context:
- "triggered": They just said "stages". Send the first qualification question about paid talks.
- "q1": Waiting for their answer on paid talks. They may have just answered or gone off-script.
- "q2": Waiting for their fee range. They may have just answered or gone off-script.
- "q3": Waiting for their topic/niche. They may have just answered or gone off-script.`;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }]
    });

    return response.content[0].text.trim();

  } catch (err) {
    console.error('[qualifier] generateResponse error:', err.message);
    // Return a safe fallback so the conversation doesn't go silent
    return "Thanks for your message. We'll follow up shortly.";
  }
}

module.exports = { scoreConversation, generateResponse };
