/**
 * APRS device identification (#1202) — which radio or software sent a packet.
 *
 * Two sources, per the aprs-deviceid project (Hessu, OH7LZB; CC BY-SA 2.0):
 *   - the *tocall* in the destination field of ordinary packets
 *     (APDW?? → Dire Wolf, APK0?? → Kenwood TH-D7, …), matched exact-first
 *     then by the most specific wildcard pattern (`?` and lower-case `n` are
 *     one character, `*` is the rest);
 *   - the Mic-E type bytes in the comment: a leading ` (messaging) or '
 *     (dumb tracker) with a two-character suffix at the end for current
 *     devices, or a leading > / ] with an optional one-character suffix for
 *     the legacy Kenwood radios. A Mic-E destination is encoded latitude, so
 *     it is never looked up as a tocall.
 *
 * The type bytes are stripped from the comment we return — they are codes,
 * not text, and they were showing up in the panel as stray punctuation.
 *
 * Table: server/utils/aprs-deviceid.json, refreshed with
 * `node scripts/vendor-aprs-deviceid.mjs`.
 */
const TABLE = require('./aprs-deviceid.json');

const CLASS_SHOWN = TABLE.classes || {};

// Upstream uses "unknown"/"Unknown" as a placeholder in a handful of entries
// (the generic APRS tocall, EchoLink, IRLP, D-STAR…); a label that says
// "Unknown Unknown" is worse than none.
const known = (v) => (v && !/^unknown$/i.test(String(v).trim()) ? String(v).trim() : '');

const withShown = (entry) => {
  if (!entry) return null;
  const out = {};
  const vendor = known(entry.vendor);
  const model = known(entry.model);
  if (!vendor && !model) return null;
  if (vendor) out.vendor = vendor;
  if (model) out.model = model;
  if (entry.class) {
    out.class = entry.class;
    if (CLASS_SHOWN[entry.class]) out.shown = CLASS_SHOWN[entry.class];
  }
  return out;
};

// ── tocalls ────────────────────────────────────────────────────────────

const hasWildcard = (p) => /[?n*]/.test(p);
const EXACT = new Map();
const PATTERNS = [];
for (const [pattern, entry] of Object.entries(TABLE.tocalls || {})) {
  if (!hasWildcard(pattern)) {
    EXACT.set(pattern.toUpperCase(), entry);
    continue;
  }
  const literal = pattern.replace(/[?n*]/g, '').length;
  const re = new RegExp(
    '^' +
      pattern
        .split('')
        .map((c) => (c === '?' || c === 'n' ? '.' : c === '*' ? '.*' : c.replace(/[.+^${}()|[\]\\]/g, '\\$&')))
        .join('') +
      '$',
  );
  PATTERNS.push({ re, literal, length: pattern.length, entry });
}
// Longest literal match first (APXYZ? before APXY??), then the longer pattern.
PATTERNS.sort((a, b) => b.literal - a.literal || b.length - a.length);

const TOCALL_CACHE = new Map();
const TOCALL_CACHE_MAX = 2000;

/**
 * @param {string} destination  packet destination, SSID allowed (APDW18-1)
 * @returns {{vendor?, model?, class?, shown?} | null}
 */
function identifyTocall(destination) {
  if (!destination || typeof destination !== 'string') return null;
  const key = destination.split('-')[0].trim().toUpperCase();
  if (!key) return null;
  if (TOCALL_CACHE.has(key)) return TOCALL_CACHE.get(key);
  let hit = EXACT.get(key) || null;
  if (!hit) {
    for (const p of PATTERNS) {
      if (p.re.test(key)) {
        hit = p.entry;
        break;
      }
    }
  }
  const out = withShown(hit);
  if (TOCALL_CACHE.size >= TOCALL_CACHE_MAX) TOCALL_CACHE.clear();
  TOCALL_CACHE.set(key, out);
  return out;
}

// ── Mic-E type bytes ───────────────────────────────────────────────────

/**
 * @param {string} comment  the Mic-E comment as decoded by the parser
 * @returns {{device: object|null, comment: string}} device + comment with the type bytes removed
 */
function identifyMice(comment) {
  if (typeof comment !== 'string' || !comment) return { device: null, comment: comment || '' };
  const prefix = comment.charAt(0);
  const rest = comment.slice(1);

  if (prefix === '`' || prefix === "'") {
    if (rest.length >= 2) {
      const hit = TABLE.mice?.[rest.slice(-2)];
      if (hit) return { device: withShown(hit), comment: rest.slice(0, -2).trim() };
    }
    return { device: null, comment: rest.trim() };
  }

  if (prefix === '>' || prefix === ']') {
    const legacy = TABLE.micelegacy || {};
    if (rest.length >= 1) {
      const withSuffix = legacy[prefix + rest.slice(-1)];
      if (withSuffix) return { device: withShown(withSuffix), comment: rest.slice(0, -1).trim() };
    }
    return { device: withShown(legacy[prefix]) || null, comment: rest.trim() };
  }

  return { device: null, comment };
}

/**
 * Identify the device behind a parsed packet and return the comment to show.
 * @param {{packetType?: string, destination?: string, comment?: string}} station
 */
function identifyDevice(station) {
  if (!station) return { device: null, comment: '' };
  const comment = typeof station.comment === 'string' ? station.comment : '';
  if (station.packetType === 'mic-e') return identifyMice(comment);
  return { device: identifyTocall(station.destination), comment };
}

module.exports = { identifyDevice, identifyTocall, identifyMice };
