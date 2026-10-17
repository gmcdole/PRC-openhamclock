'use strict';
/**
 * relay-sign.js — end-to-end authentication of Cloud Relay commands.
 *
 * The hosted OpenHamClock server only queues and forwards relay commands; it
 * must not be able to make the radio do anything by itself, and neither must
 * anyone who learns a relay session id. So the browser that paired the relay
 * and this Rig Bridge share a "command key" the server never sees: the
 * browser generates it when the user presses Connect Cloud Relay and hands it
 * to Rig Bridge in the same pasted settings as the session id. Every command
 * carries an HMAC-SHA256 over a canonical form of the command; Rig Bridge
 * checks it before doing anything.
 *
 *   signed text = "ohc-relay-cmd-v1\n" + session + "\n" + ts + "\n" + nonce
 *                 + "\n" + type + "\n" + canonicalJson(payload)
 *   auth        = { v: 1, ts, nonce, sig }   (sig = lowercase hex HMAC)
 *
 * Replays are refused: ts must be within ±MAX_SKEW_MS of this computer's
 * clock and each nonce is accepted once.
 *
 * Reading the relay (state, decodes, APRS, the live stream) is protected
 * with a read token derived from the same key:
 *
 *   readToken = HKDF-SHA256(ikm = key, salt = none, info = "ohc-relay-read-v1\n" + session, 32 bytes)
 *
 * The bridge registers sha256(readToken) with the server (in its
 * authenticated state pushes and command polls); the paired browser derives
 * the same token and presents it in an X-Relay-Read header, and the server
 * compares hashes. A separate HKDF label keeps the read token useless for
 * signing commands, and the server only ever holds its hash.
 *
 * The browser side is src/utils/relaySign.js; a test checks they agree.
 */

const crypto = require('crypto');

const PREFIX = 'ohc-relay-cmd-v1';
const MAX_SKEW_MS = 5 * 60 * 1000;
const KEY_RE = /^[0-9a-f]{64}$/;

/** JSON with object keys sorted at every level — same bytes on both ends. */
function canonicalJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(v)
    .filter((k) => v[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
}

function signedText(session, ts, nonce, type, payload) {
  return [PREFIX, String(session), String(ts), String(nonce), String(type), canonicalJson(payload ?? {})].join('\n');
}

function isValidKey(key) {
  return typeof key === 'string' && KEY_RE.test(key);
}

/** HMAC-SHA256(key, text) as lowercase hex. key = 64 hex chars. */
function hmacHex(key, text) {
  return crypto.createHmac('sha256', Buffer.from(key, 'hex')).update(text, 'utf8').digest('hex');
}

/** The relay read token for a key + session (64 hex). '' without a valid key. */
function deriveReadToken(key, session) {
  if (!isValidKey(key)) return '';
  const info = Buffer.from(`ohc-relay-read-v1\n${session}`, 'utf8');
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(key, 'hex'), Buffer.alloc(0), info, 32)).toString('hex');
}

/** What the server stores and compares: sha256 of the token's bytes (64 hex). */
function readTokenHash(token) {
  return crypto.createHash('sha256').update(Buffer.from(token, 'hex')).digest('hex');
}

/** Sign a command (used by tests and tools; browsers use src/utils/relaySign.js). */
function signCommand(key, session, type, payload, { ts = Date.now(), nonce } = {}) {
  const n = nonce || crypto.randomBytes(12).toString('hex');
  return { v: 1, ts, nonce: n, sig: hmacHex(key, signedText(session, ts, n, type, payload)) };
}

/**
 * A verifier with its own replay cache.
 * @param {object} opts
 * @param {function} opts.key      () => command key (64 hex) or '' when not paired
 * @param {function} opts.session  () => relay session id
 * @param {function} [opts.now]    () => ms (tests)
 */
function createCommandVerifier({ key, session, now = Date.now }) {
  const seen = new Map(); // nonce → ts

  function prune(t) {
    for (const [n, ts] of seen) if (Math.abs(t - ts) > MAX_SKEW_MS * 2) seen.delete(n);
    if (seen.size > 5000) seen.delete(seen.keys().next().value);
  }

  /**
   * @returns {{ ok: true } | { ok: false, reason: string }}
   *   reasons: 'not-paired' | 'unsigned' | 'malformed' | 'expired' | 'replayed' | 'bad-signature'
   */
  function verify(cmd) {
    const k = key();
    if (!isValidKey(k)) return { ok: false, reason: 'not-paired' };
    const a = cmd && cmd.auth;
    if (!a) return { ok: false, reason: 'unsigned' };
    if (
      a.v !== 1 ||
      !Number.isFinite(a.ts) ||
      typeof a.nonce !== 'string' ||
      !/^[0-9a-f]{16,64}$/.test(a.nonce) ||
      typeof a.sig !== 'string' ||
      !/^[0-9a-f]{64}$/.test(a.sig)
    ) {
      return { ok: false, reason: 'malformed' };
    }
    const t = now();
    if (Math.abs(t - a.ts) > MAX_SKEW_MS) return { ok: false, reason: 'expired' };
    const expected = Buffer.from(hmacHex(k, signedText(session(), a.ts, a.nonce, cmd.type, cmd.payload)), 'hex');
    const given = Buffer.from(a.sig, 'hex');
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
      return { ok: false, reason: 'bad-signature' };
    }
    if (seen.has(a.nonce)) return { ok: false, reason: 'replayed' };
    seen.set(a.nonce, a.ts);
    prune(t);
    return { ok: true };
  }

  return { verify };
}

module.exports = {
  PREFIX,
  MAX_SKEW_MS,
  canonicalJson,
  signedText,
  isValidKey,
  hmacHex,
  signCommand,
  createCommandVerifier,
  deriveReadToken,
  readTokenHash,
};
