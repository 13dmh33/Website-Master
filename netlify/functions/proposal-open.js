// Netlify Function: proposal open-tracking pixel
// GET /.netlify/functions/proposal-open?leadId=xxx
// Embedded as a 1x1 image in the proposal email/HTML. Always returns a
// valid transparent GIF regardless of whether logging succeeds — a
// tracking pixel must never fail visibly or break email rendering.
//
// Deploy to Netlify with GOOGLE_SERVICE_ACCOUNT_JSON_CONTENT (the service
// account key's raw JSON, not a file path — see scripts/lib/google-sheets.js)
// and SHEET_ID set in Netlify environment variables.

const {
  loadServiceAccount, getAccessToken, ensureTab, sheetsAppend, DEFAULT_SHEET_ID,
} = require('../../scripts/lib/google-sheets');
const { TRANSPARENT_GIF_BASE64, extractLeadId, buildOpenRow, OPENS_TAB, OPENS_HEADER } = require('../../scripts/lib/proposal/open-pixel');

const PIXEL_RESPONSE = {
  statusCode: 200,
  headers: {
    'Content-Type': 'image/gif',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  },
  body: TRANSPARENT_GIF_BASE64,
  isBase64Encoded: true,
};

async function logOpen(leadId, userAgent) {
  const sa = loadServiceAccount(); // throws if not configured — caller catches
  const token = await getAccessToken(sa);
  const sheetId = process.env.SHEET_ID || DEFAULT_SHEET_ID;
  const justCreated = await ensureTab(token, sheetId, OPENS_TAB);
  if (justCreated) {
    await sheetsAppend(token, sheetId, OPENS_TAB, [OPENS_HEADER]);
  }
  await sheetsAppend(token, sheetId, OPENS_TAB, [buildOpenRow(leadId, userAgent)]);
}

exports.handler = async (event) => {
  const leadId = extractLeadId(event.queryStringParameters || {});
  if (leadId) {
    try {
      await logOpen(leadId, event.headers ? event.headers['user-agent'] : undefined);
    } catch (err) {
      // Never let a logging failure surface to the pixel response.
      console.error(`proposal-open: failed to log open for lead "${leadId}": ${err.message}`);
    }
  }
  return PIXEL_RESPONSE;
};
