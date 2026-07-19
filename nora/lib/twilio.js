/**
 * Shared Twilio helpers — signature validation and outbound SMS send.
 *
 * Patterns lifted from the existing single-tenant scripts (webhook.js's
 * validateTwilioSignature, pitcher.js's sendSms via raw HTTPS rather than
 * the twilio npm package) and generalized to take credentials as arguments
 * instead of reading a single global env var set, since Nora is multi-tenant
 * — each customer config can eventually carry its own fromPhone.
 */

'use strict';

const https = require('https');
const crypto = require('crypto');

function validateTwilioSignature(authToken, signature, url, params) {
  if (!authToken || !signature) return false;
  const sortedKeys = Object.keys(params).sort();
  const signing = url + sortedKeys.map(k => k + params[k]).join('');
  const expected = crypto.createHmac('sha1', authToken).update(signing).digest('base64');
  const eBuf = Buffer.from(expected);
  const sBuf = Buffer.from(signature);
  if (eBuf.length !== sBuf.length) return false;
  return crypto.timingSafeEqual(eBuf, sBuf);
}

/** Raw HTTPS POST to Twilio's Messages API. Returns { sid, body }. */
function sendSms({ accountSid, authToken, from, to, body }) {
  if (!accountSid || !authToken || !from) {
    return Promise.reject(new Error('sendSms requires accountSid, authToken, and from'));
  }
  const payload = new URLSearchParams({ From: from, To: to, Body: body }).toString();
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const options = {
    hostname: 'api.twilio.com',
    path: `/2010-04-01/Accounts/${accountSid}/Messages.json`,
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(payload),
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ sid: parsed.sid, body });
          } else {
            reject(new Error(`Twilio error ${res.statusCode}: ${data}`));
          }
        } catch (e) {
          reject(new Error(`Failed to parse Twilio response: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

module.exports = { validateTwilioSignature, sendSms };
