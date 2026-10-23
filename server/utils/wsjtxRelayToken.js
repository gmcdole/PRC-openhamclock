'use strict';
/**
 * Per-session WSJT-X relay tokens.
 *
 * The relay agent (or Rig Bridge) posts decodes for one browser session. It
 * used to authenticate with the server-wide WSJTX_RELAY_KEY, which the server
 * also handed out to anyone (/api/wsjtx/relay-credentials) and embedded in
 * every downloaded relay script — so the "key" was public and let anyone post
 * into any session. Now the server gives out HMAC(WSJTX_RELAY_KEY, session):
 * a token that only works for its own session, while the key itself never
 * leaves the server. Rotating WSJTX_RELAY_KEY invalidates every token.
 */
const crypto = require('crypto');

function relayTokenFor(relayKey, sessionId) {
  return crypto
    .createHmac('sha256', String(relayKey))
    .update('wsjtx-relay:' + String(sessionId))
    .digest('hex');
}

function isValidRelayToken(relayKey, sessionId, token) {
  if (!relayKey || !sessionId || typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return false;
  const a = Buffer.from(relayTokenFor(relayKey, sessionId), 'hex');
  const b = Buffer.from(token, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Which session to evict to make room for a new one, or null when every
 * session is still active (then the new session is refused instead, so a
 * flood of made-up sessions can't push real users out).
 */
function pickEvictableSession(sessions, now, idleMs) {
  let oldestId = null;
  let oldestTime = Infinity;
  for (const [id, s] of Object.entries(sessions)) {
    if (s.lastAccess < oldestTime) {
      oldestTime = s.lastAccess;
      oldestId = id;
    }
  }
  return oldestId !== null && now - oldestTime >= idleMs ? oldestId : null;
}

module.exports = { relayTokenFor, isValidRelayToken, pickEvictableSession };
