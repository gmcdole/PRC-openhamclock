/**
 * APRS message / bulletin parser (shared by the APRS-IS feed and the
 * local-TNC path in server/routes/aprs.js).
 *
 *   SRC>DEST,PATH::ADDRESSEE:text{id
 *
 * Returns null for anything that is not a message, and for ack/rej frames.
 * EmComm net commands addressed to EMCOMM (`CQ NETNAME status`, `U NETNAME`)
 * come back as `netCommand` so the roster can act on them.
 */
const { parseResourceTokens } = require('./aprsParser');

function parseAprsMessage(line) {
  try {
    const headerEnd = line.indexOf(':');
    if (headerEnd < 0) return null;

    const header = line.substring(0, headerEnd);
    const payload = line.substring(headerEnd + 1);
    const from = header.split('>')[0].trim();

    // APRS message format: :ADDRESSEE:message{id
    if (payload.charAt(0) !== ':') return null;
    const addrEnd = payload.indexOf(':', 1);
    if (addrEnd < 0) return null;

    const to = payload.substring(1, addrEnd).trim();
    const body = payload.substring(addrEnd + 1);

    // Message ID: `{id` (1–5 alphanumerics), or the APRS 1.2 reply-ack form
    // `{MM}` / `{MM}AA`. Radios do not always end the frame right after it —
    // a Yaesu heard over a KISS TNC arrives with a trailing CR/space, which
    // used to leave "{02" glued to the text (#1212). Trim control characters
    // and whitespace first, then take the id off the end.
    let end = body.length;
    while (end > 0) {
      const c = body.charCodeAt(end - 1);
      if (c <= 0x20 || c === 0x7f) end--;
      else break;
    }
    const trimmedBody = body.slice(0, end);
    const idMatch = trimmedBody.match(/\{([A-Za-z0-9]{1,5})(?:\}([A-Za-z0-9]{0,2}))?$/);
    const msgId = idMatch ? idMatch[1] : null;
    const text = (idMatch ? trimmedBody.slice(0, idMatch.index) : trimmedBody).trim();

    // Skip acks/rejs
    if (text.startsWith('ack') || text.startsWith('rej')) return null;

    const isBulletin = to.startsWith('BLN');
    const { tokens, cleanComment } = parseResourceTokens(text);

    // Detect shelter-related content
    // A shelter report needs shelter context: the word itself (or evacuee /
    // refuge), or a structured shelter token. Bare "open" / "closed" /
    // "capacity" / "beds" used to qualify, so an ordinary net message such as
    // "How many open cots are available?" became a shelter named after its
    // sender (#1219).
    const isShelterReport =
      /\bshelter|\bevacuee|\bevacuation\s+(center|centre|site)|\brefuge\b/i.test(text) ||
      tokens.some((t) => ['Beds', 'Capacity', 'Shelter', 'Evacuees'].includes(t.key));

    // Detect net check-in/check-out commands (messages to EMCOMM)
    let netCommand = null;
    if (to.toUpperCase() === 'EMCOMM' || to.toUpperCase().startsWith('EMCOMM')) {
      const upper = text.toUpperCase().trim();
      const cqMatch = upper.match(/^CQ\s+(\S+)\s*(.*)/);
      const uMatch = upper.match(/^U\s+(\S+)/);
      if (cqMatch) {
        netCommand = { action: 'checkin', netName: cqMatch[1], status: cqMatch[2] || '' };
      } else if (uMatch) {
        netCommand = { action: 'checkout', netName: uMatch[1] };
      }
    }

    return {
      type: isBulletin ? 'bulletin' : 'message',
      from,
      to,
      text,
      cleanText: cleanComment,
      tokens,
      msgId,
      isShelterReport,
      netCommand,
      timestamp: Date.now(),
      raw: line,
    };
  } catch (e) {
    return null;
  }
}

/**
 * Messages exchanged with one station (#1216): anything from or to the exact
 * callsign-SSID, plus the base callsign's other SSIDs (KE8PLM-9 and KE8PLM-7
 * are the same operator from a net control's point of view). Newest first.
 */
function messagesForStation(messages, call, limit = 200) {
  const key = String(call || '')
    .trim()
    .toUpperCase();
  if (!key) return [];
  const base = key.split('-')[0];
  const baseOf = (c) =>
    String(c || '')
      .trim()
      .toUpperCase()
      .split('-')[0];
  const hit = (c) => {
    const u = String(c || '')
      .trim()
      .toUpperCase();
    return u === key || baseOf(u) === base;
  };
  return (messages || [])
    .filter((m) => m && (hit(m.from) || hit(m.to)))
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    .slice(0, limit)
    .map((m) => ({
      from: m.from,
      to: m.to,
      text: m.text,
      msgId: m.msgId ?? null,
      timestamp: m.timestamp,
      direction: m.direction || 'received',
      source: m.source || null,
      type: m.type || 'message',
    }));
}

/**
 * Is `msg` a retransmission of one already logged (#1230)? Senders retry an
 * un-acked message several times (aprs.fi ×6, Yaesu FTM-500 ×6), and a
 * message addressed to an alias such as EMCOMM is never acked — so without
 * this every message landed in the log, and re-ran its net command, up to six
 * times. The same packet heard over both RF and APRS-IS is caught too.
 * Same sender + addressee + message id within 30 min; messages with no id
 * fall back to identical text within 5 min.
 */
const DUP_WINDOW_ID_MS = 30 * 60 * 1000;
const DUP_WINDOW_TEXT_MS = 5 * 60 * 1000;
function isDuplicateMessage(messages, msg) {
  if (!msg || !Array.isArray(messages)) return false;
  const up = (c) =>
    String(c || '')
      .trim()
      .toUpperCase();
  const from = up(msg.from);
  const to = up(msg.to);
  const now = msg.timestamp || Date.now();
  const window = msg.msgId ? DUP_WINDOW_ID_MS : DUP_WINDOW_TEXT_MS;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m) continue;
    if (now - (m.timestamp || 0) > window) break; // log is append-only, so older entries are out of window too
    if (m.direction === 'sent' || up(m.from) !== from || up(m.to) !== to) continue;
    if (msg.msgId ? m.msgId === msg.msgId : !m.msgId && m.text === msg.text) return true;
  }
  return false;
}

module.exports = { parseAprsMessage, messagesForStation, isDuplicateMessage };
