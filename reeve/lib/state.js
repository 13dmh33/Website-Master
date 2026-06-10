require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs   = require('fs');
const path = require('path');

const CONVERSATIONS_DIR = path.join(__dirname, '..', 'output', 'conversations');

// Ensure the conversations directory exists on load
if (!fs.existsSync(CONVERSATIONS_DIR)) {
  fs.mkdirSync(CONVERSATIONS_DIR, { recursive: true });
}

/**
 * Returns the file path for a given sender ID.
 */
function conversationPath(senderId) {
  // Sanitize senderId so it's safe as a filename
  const safe = String(senderId).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(CONVERSATIONS_DIR, `${safe}.json`);
}

/**
 * getConversation(senderId)
 * Returns the conversation object for the given sender, or null if none exists.
 */
function getConversation(senderId) {
  const filePath = conversationPath(senderId);
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[state] Failed to read conversation for ${senderId}:`, err.message);
    return null;
  }
}

/**
 * saveConversation(senderId, data)
 * Saves or updates the conversation file for the given sender.
 * Always stamps lastActivity on save.
 */
function saveConversation(senderId, data) {
  const filePath = conversationPath(senderId);
  const toWrite = Object.assign({}, data, {
    senderId,
    lastActivity: new Date().toISOString()
  });

  try {
    fs.writeFileSync(filePath, JSON.stringify(toWrite, null, 2), 'utf8');
  } catch (err) {
    console.error(`[state] Failed to save conversation for ${senderId}:`, err.message);
    throw err;
  }
}

/**
 * clearConversation(senderId)
 * Removes the conversation file after the lead has been routed.
 */
function clearConversation(senderId) {
  const filePath = conversationPath(senderId);
  if (!fs.existsSync(filePath)) return;

  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    console.error(`[state] Failed to clear conversation for ${senderId}:`, err.message);
  }
}

/**
 * getAllActive()
 * Returns an array of all active conversation objects found in the directory.
 */
function getAllActive() {
  try {
    const files = fs.readdirSync(CONVERSATIONS_DIR).filter(f => f.endsWith('.json'));
    const conversations = [];

    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(CONVERSATIONS_DIR, file), 'utf8');
        conversations.push(JSON.parse(raw));
      } catch (err) {
        console.error(`[state] Failed to parse ${file}:`, err.message);
      }
    }

    return conversations;
  } catch (err) {
    console.error('[state] Failed to read conversations directory:', err.message);
    return [];
  }
}

/**
 * createFreshConversation(senderId, senderName)
 * Returns a new conversation object with default shape.
 * Callers should saveConversation() after calling this.
 */
function createFreshConversation(senderId, senderName) {
  return {
    senderId,
    senderName: senderName || null,
    startedAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
    stage: 'triggered',
    answers: {
      paid_talks_count: null,
      fee_range: null,
      topic: null
    },
    score: null,
    routed: false,
    routedAt: null
  };
}

module.exports = {
  getConversation,
  saveConversation,
  clearConversation,
  getAllActive,
  createFreshConversation
};
