require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express  = require('express');
const crypto   = require('crypto');
const https    = require('https');

const state     = require('../lib/state');
const qualifier = require('../lib/qualifier');
const templates = require('../templates/qualification.json');

const app = express();

// Parse raw body BEFORE json middleware so we can verify HMAC signatures
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; }
}));

// ─── Config ───────────────────────────────────────────────────────────────────

const PORT                  = process.env.PORT || 3000;
const META_VERIFY_TOKEN     = process.env.META_VERIFY_TOKEN;
const META_APP_SECRET       = process.env.META_APP_SECRET;
const META_PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN;
const INSTAGRAM_PAGE_ID     = process.env.INSTAGRAM_PAGE_ID;
const CALL_BOOKING_LINK     = process.env.CALL_BOOKING_LINK || '(booking link not configured)';

// ─── Startup checks ───────────────────────────────────────────────────────────

const REQUIRED_VARS = [
  'META_VERIFY_TOKEN',
  'META_APP_SECRET',
  'META_PAGE_ACCESS_TOKEN',
  'INSTAGRAM_PAGE_ID',
  'ANTHROPIC_API_KEY'
];

const OPTIONAL_VARS = [
  'DAVE_NOTIFY_EMAIL',
  'CALL_BOOKING_LINK',
  'PORT'
];

function logStartup() {
  console.log('\n=== Reeve DM Agent ===');
  console.log(`Port: ${PORT}`);
  console.log('\nRequired env vars:');
  for (const v of REQUIRED_VARS) {
    const present = !!process.env[v];
    console.log(`  ${present ? '✓' : '✗ MISSING'} ${v}`);
  }
  console.log('\nOptional env vars:');
  for (const v of OPTIONAL_VARS) {
    const present = !!process.env[v];
    console.log(`  ${present ? '✓' : '—'} ${v}${present ? '' : ' (not set)'}`);
  }
  console.log('\nListening for Meta webhook events...\n');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Verify X-Hub-Signature-256 from Meta using HMAC-SHA256.
 * Returns true if valid, false otherwise.
 */
function verifySignature(req) {
  if (!META_APP_SECRET) {
    console.warn('[webhook] META_APP_SECRET not set — skipping signature check');
    return true;
  }

  const sigHeader = req.headers['x-hub-signature-256'];
  if (!sigHeader) {
    console.warn('[webhook] Missing X-Hub-Signature-256 header');
    return false;
  }

  const expected = 'sha256=' + crypto
    .createHmac('sha256', META_APP_SECRET)
    .update(req.rawBody)
    .digest('hex');

  const actual = sigHeader;

  // Guard against length mismatch before timing-safe compare
  if (Buffer.byteLength(expected) !== Buffer.byteLength(actual)) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
  } catch (err) {
    console.error('[webhook] timingSafeEqual error:', err.message);
    return false;
  }
}

/**
 * Send a DM to a recipient via the Meta Graph API.
 */
function sendDM(recipientId, text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      recipient: { id: recipientId },
      message:   { text }
    });

    const options = {
      hostname: 'graph.facebook.com',
      path:     `/v19.0/${INSTAGRAM_PAGE_ID}/messages?access_token=${META_PAGE_ACCESS_TOKEN}`,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data));
        } else {
          console.error(`[sendDM] Meta API error ${res.statusCode}:`, data);
          reject(new Error(`Meta API ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Build the routing message text for the given score.
 */
function buildRoutingMessage(score) {
  if (score === 'high') {
    return templates.messages.high_fit.replace('{CALL_BOOKING_LINK}', CALL_BOOKING_LINK);
  }
  if (score === 'mid') {
    return templates.messages.mid_fit;
  }
  return templates.messages.low_fit;
}

/**
 * Check whether the incoming message text matches a trigger keyword.
 */
function isTrigger(text) {
  if (!text) return false;
  const normalized = text.trim();
  return templates.trigger_keywords.some(kw => normalized === kw);
}

// ─── Conversation flow ────────────────────────────────────────────────────────

/**
 * Handle an incoming DM from a sender.
 */
async function handleMessage(senderId, senderName, messageText) {
  console.log(`[flow] Message from ${senderId} (${senderName || 'unknown'}): "${messageText}"`);

  // Fetch or check for existing conversation
  let convo = state.getConversation(senderId);

  // ── Trigger: start a new qualification ───────────────────────────────────
  if (isTrigger(messageText)) {
    if (convo && convo.routed) {
      // Already routed — silently ignore re-trigger to avoid duplicate routing
      console.log(`[flow] ${senderId} already routed — ignoring re-trigger`);
      return;
    }

    convo = state.createFreshConversation(senderId, senderName);
    convo.stage = 'q1';
    state.saveConversation(senderId, convo);

    const reply = templates.messages.trigger_reply;
    console.log(`[flow] Sending trigger reply to ${senderId}`);
    await sendDM(senderId, reply);
    return;
  }

  // ── No active conversation: ignore ───────────────────────────────────────
  if (!convo) {
    console.log(`[flow] No active conversation for ${senderId} — ignoring`);
    return;
  }

  // ── Already routed: ignore ────────────────────────────────────────────────
  if (convo.routed) {
    console.log(`[flow] ${senderId} already routed (${convo.score}) — ignoring`);
    return;
  }

  // ── Advance through questions ─────────────────────────────────────────────
  const { stage } = convo;

  if (stage === 'q1') {
    convo.answers.paid_talks_count = messageText;
    convo.stage = 'q2';
    state.saveConversation(senderId, convo);

    const reply = templates.questions[1].text; // q2_fee
    console.log(`[flow] Advancing ${senderId} to q2`);
    await sendDM(senderId, reply);
    return;
  }

  if (stage === 'q2') {
    convo.answers.fee_range = messageText;
    convo.stage = 'q3';
    state.saveConversation(senderId, convo);

    const reply = templates.questions[2].text; // q3_topic
    console.log(`[flow] Advancing ${senderId} to q3`);
    await sendDM(senderId, reply);
    return;
  }

  if (stage === 'q3') {
    convo.answers.topic = messageText;
    convo.stage = 'routed';
    state.saveConversation(senderId, convo);

    console.log(`[flow] All answers collected for ${senderId} — scoring...`);

    // Score the conversation
    let scoreResult;
    try {
      scoreResult = await qualifier.scoreConversation(convo.answers);
    } catch (err) {
      console.error('[flow] Scoring failed:', err.message);
      scoreResult = { score: 'mid', reasoning: 'Scoring error — flagged for manual review.' };
    }

    convo.score    = scoreResult.score;
    convo.routed   = true;
    convo.routedAt = new Date().toISOString();
    state.saveConversation(senderId, convo);

    console.log(`[flow] Score for ${senderId}: ${scoreResult.score} — ${scoreResult.reasoning}`);

    const routingMessage = buildRoutingMessage(scoreResult.score);
    await sendDM(senderId, routingMessage);

    console.log(`[flow] Routed ${senderId} → ${scoreResult.score} (${templates.scoring[`${scoreResult.score}_fit`].action})`);
    return;
  }

  // ── Unknown stage: log and ignore ────────────────────────────────────────
  console.warn(`[flow] Unknown stage "${stage}" for ${senderId} — ignoring`);
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /webhook — Meta webhook verification handshake.
 * Meta sends hub.mode, hub.verify_token, hub.challenge.
 * We confirm the token matches and echo back the challenge.
 */
app.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === META_VERIFY_TOKEN) {
    console.log('[webhook] Verification handshake successful');
    return res.status(200).send(challenge);
  }

  console.warn('[webhook] Verification failed — token mismatch or wrong mode');
  res.status(403).send('Forbidden');
});

/**
 * POST /webhook — Receives Meta webhook events (DMs).
 */
app.post('/webhook', async (req, res) => {
  // Verify signature first
  if (!verifySignature(req)) {
    console.warn('[webhook] Signature verification failed — rejecting request');
    return res.status(401).send('Unauthorized');
  }

  // Acknowledge immediately — Meta requires a 200 within 20 seconds
  res.status(200).send('EVENT_RECEIVED');

  const body = req.body;

  // Safety check — only handle Instagram messaging events
  if (body.object !== 'instagram') {
    console.log(`[webhook] Ignoring non-instagram object: ${body.object}`);
    return;
  }

  const entries = body.entry || [];

  for (const entry of entries) {
    const messagingEvents = entry.messaging || [];

    for (const event of messagingEvents) {
      // Skip events without a message (e.g. delivery receipts, reads)
      if (!event.message) continue;

      // Skip echo events (messages sent by the page itself)
      if (event.message.is_echo) continue;

      const senderId   = event.sender && event.sender.id;
      const recipientId = event.recipient && event.recipient.id;

      if (!senderId) {
        console.warn('[webhook] Event missing sender.id — skipping');
        continue;
      }

      // Skip messages sent by the page itself
      if (senderId === INSTAGRAM_PAGE_ID) {
        console.log('[webhook] Skipping page-sent message');
        continue;
      }

      const messageText = event.message.text || '';
      const senderName  = (event.sender && event.sender.name) || null;

      // Process asynchronously — don't block the response loop
      handleMessage(senderId, senderName, messageText).catch(err => {
        console.error(`[webhook] handleMessage error for ${senderId}:`, err.message);
      });
    }
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  logStartup();
});

module.exports = app; // export for testing
