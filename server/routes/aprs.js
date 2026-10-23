/**
 * APRS-IS integration routes.
 * Lines ~10922-11161 of original server.js
 */

const net = require('net');

const { parseAprsPacket: parseAprsPosition, parseResourceTokens } = require('../utils/aprsParser');
const { identifyDevice } = require('../utils/aprsDeviceId');
const { parseAprsMessage, messagesForStation, isDuplicateMessage } = require('../utils/aprsMessage');

module.exports = function (app, ctx) {
  const { CONFIG, APP_VERSION, logDebug, logInfo, logWarn, logErrorOnce } = ctx;
  // Per-IP limits on the open ingest routes below (see middleware ingestLimiter)
  const ingest = ctx.ingestLimiter || (() => (req, res, next) => next());

  // Connects to APRS-IS network for real-time position tracking.
  // Read-only connection (passcode -1). Positions cached in memory.
  // Enable via APRS_ENABLED=true in .env

  const APRS_ENABLED = process.env.APRS_ENABLED === 'true';
  const APRS_HOST = process.env.APRS_HOST || 'rotate.aprs2.net';
  const APRS_PORT = parseInt(process.env.APRS_PORT || '14580');
  const APRS_FILTER = process.env.APRS_FILTER || ''; // e.g. 'r/40/-75/500' for 500km around lat/lon
  const APRS_MAX_AGE_MINUTES = parseInt(process.env.APRS_MAX_AGE_MINUTES || '60');
  const APRS_MAX_STATIONS = 500;

  // In-memory station cache: callsign → { call, lat, lon, symbol, comment, speed, course, altitude, timestamp, raw }
  const aprsStations = new Map();
  // APRS message store for EmComm (messages, bulletins, shelter reports)
  const aprsMessages = [];
  const APRS_MAX_MESSAGES = 200;
  // Net operations: operator roster keyed by callsign
  const netRoster = new Map(); // callsign → { call, status, netName, checkinTime, lastHeard, location, resources }
  // The roster is shared by everyone viewing this server: bound its size and
  // the text that can be put into it.
  const NET_ROSTER_MAX = 500;
  const CALLSIGN_RE = /^[A-Z0-9/-]{1,12}$/i;
  const clip = (v, n) => String(v).slice(0, n);
  // Over NET_ROSTER_MAX, drop the longest-unheard entry
  function trimRoster() {
    if (netRoster.size <= NET_ROSTER_MAX) return;
    let oldestKey = null;
    let oldest = Infinity;
    for (const [k, v] of netRoster) {
      if ((v.lastHeard || 0) < oldest) {
        oldest = v.lastHeard || 0;
        oldestKey = k;
      }
    }
    if (oldestKey) netRoster.delete(oldestKey);
  }
  let aprsSocket = null;
  let aprsReconnectTimer = null;
  let aprsConnected = false;
  let aprsBuffer = '';

  // Telemetry stores (EmComm Phase 6). The declarations were lost in the
  // shared-position-parser refactor (#1194) while every use survived, so each
  // T# frame threw a ReferenceError inside parseAprsTelemetry's try/catch and
  // GET /api/aprs/telemetry 500'd.
  const telemetryDefs = new Map(); // callsign → { params, units, eqns }
  const telemetryData = new Map(); // callsign → { call, seq, values[], bits, timestamp, source, history[] }
  const TELEMETRY_HISTORY_MAX = 60; // samples kept per station for trend charts
  const TELEMETRY_MAX_STATIONS = 100;

  // T# telemetry frames and PARM/UNIT/EQNS definitions (positions: see parseAprsPacket)
  function parseAprsTelemetry(line) {
    try {
      const headerEnd = line.indexOf(':');
      if (headerEnd < 0) return null;

      const header = line.substring(0, headerEnd);
      const payload = line.substring(headerEnd + 1);
      const callsign = header.split('>')[0].split('-')[0].trim();

      // T# telemetry data frame
      if (payload.startsWith('T#')) {
        const parts = payload.substring(2).split(',');
        if (parts.length < 6) return null;
        const seq = parts[0];
        const values = parts.slice(1, 6).map((v) => parseFloat(v) || 0);
        // Digital bits are the 7th field (T#seq,a1,a2,a3,a4,a5,bits);
        // tolerate abbreviated frames that omit it.
        const bits = parts.length > 6 && parts[6] ? parts[6].replace(/[^01]/g, '') : '';

        const prev = telemetryData.get(callsign);
        const entry = {
          call: callsign,
          seq,
          values,
          bits,
          timestamp: Date.now(),
          history: prev?.history || [],
        };
        entry.history.push({ seq, values, bits, timestamp: entry.timestamp });
        if (entry.history.length > TELEMETRY_HISTORY_MAX) entry.history.shift();

        // Bound the number of tracked stations (evict oldest)
        if (!prev && telemetryData.size >= TELEMETRY_MAX_STATIONS) {
          let oldestKey = null;
          let oldestTime = Infinity;
          for (const [k, v] of telemetryData) {
            if (v.timestamp < oldestTime) {
              oldestTime = v.timestamp;
              oldestKey = k;
            }
          }
          if (oldestKey) telemetryData.delete(oldestKey);
        }

        telemetryData.set(callsign, entry);
        return { type: 'data', ...entry };
      }

      // PARM — parameter names
      if (payload.startsWith(':') && payload.includes(':PARM.')) {
        const parms = payload.split(':PARM.')[1];
        if (parms) {
          const def = telemetryDefs.get(callsign) || {};
          def.params = parms.split(',').map((s) => s.trim());
          telemetryDefs.set(callsign, def);
          return { type: 'parm', call: callsign, params: def.params };
        }
      }

      // UNIT — parameter units
      if (payload.startsWith(':') && payload.includes(':UNIT.')) {
        const units = payload.split(':UNIT.')[1];
        if (units) {
          const def = telemetryDefs.get(callsign) || {};
          def.units = units.split(',').map((s) => s.trim());
          telemetryDefs.set(callsign, def);
          return { type: 'unit', call: callsign, units: def.units };
        }
      }

      // EQNS — coefficient equations (a,b,c for each of 5 channels)
      if (payload.startsWith(':') && payload.includes(':EQNS.')) {
        const eqns = payload.split(':EQNS.')[1];
        if (eqns) {
          const coeffs = eqns.split(',').map((s) => parseFloat(s) || 0);
          const def = telemetryDefs.get(callsign) || {};
          def.eqns = [];
          for (let i = 0; i < 5; i++) {
            def.eqns.push([coeffs[i * 3] || 0, coeffs[i * 3 + 1] || 1, coeffs[i * 3 + 2] || 0]);
          }
          telemetryDefs.set(callsign, def);
          return { type: 'eqns', call: callsign, eqns: def.eqns };
        }
      }

      return null;
    } catch (e) {
      return null;
    }
  }

  // Parse APRS message packets (addressed messages + bulletins)
  // Format: :ADDRESSEE:message text{msgid
  // Bulletins: :BLN1     :bulletin text
  // Parse a raw APRS packet into a position object (or null if not a position packet)
  /**
   * Position packets go through the shared parser (server/utils/aprsParser.js —
   * uncompressed, compressed, objects, items, Mic-E, third-party). The station
   * cache additionally stamps the time it was heard.
   */
  function parseAprsPacket(line) {
    const station = parseAprsPosition(line);
    if (!station) return null;
    // Radio/software identification (#1202): tocall for ordinary packets,
    // Mic-E type bytes for Mic-E — which are also stripped from the comment
    // so the panel no longer shows them as stray punctuation.
    const { device, comment } = identifyDevice(station);
    if (comment !== station.comment) {
      const { tokens, cleanComment } = parseResourceTokens(comment);
      Object.assign(station, { comment, tokens, cleanComment });
    }
    return { ...station, device, timestamp: Date.now() };
  }

  // Net check-in / check-out from a parsed message. Shared by the APRS-IS
  // feed and the local-TNC path: until #1212 only the internet path applied
  // the command, so a `CQ NETNAME` heard over RF never reached the roster.
  function applyNetCommand(msg) {
    if (!msg?.netCommand) return;
    const { action, netName, status } = msg.netCommand;
    if (action === 'checkin') {
      const station = aprsStations.get(msg.from) || aprsStations.get(msg.from.split('-')[0]) || {};
      netRoster.set(msg.from, {
        call: msg.from,
        netName,
        status: status || 'Checked in',
        checkinTime: Date.now(),
        lastHeard: Date.now(),
        lat: station.lat ?? null,
        lon: station.lon ?? null,
        tokens: station.tokens || [],
        source: msg.source || station.source || null,
      });
      trimRoster();
      logInfo(`[APRS Net] ${msg.from} checked into ${netName}: ${status || '(no status)'}`);
    } else if (action === 'checkout') {
      netRoster.delete(msg.from);
      logInfo(`[APRS Net] ${msg.from} checked out of ${netName}`);
    }
  }

  function connectAprsIS() {
    if (!APRS_ENABLED || aprsSocket) return;

    const loginCallsign = CONFIG.callsign || 'N0CALL';
    logInfo(`[APRS-IS] Connecting to ${APRS_HOST}:${APRS_PORT} as ${loginCallsign} (read-only)...`);

    aprsSocket = new net.Socket();
    aprsSocket.setTimeout(120000); // 2 min timeout

    aprsSocket.connect(APRS_PORT, APRS_HOST, () => {
      aprsConnected = true;
      aprsBuffer = '';
      logInfo('[APRS-IS] Connected, sending login...');

      // Read-only login (passcode -1)
      aprsSocket.write(`user ${loginCallsign} pass -1 vers OpenHamClock ${APP_VERSION}`);
      if (APRS_FILTER) {
        aprsSocket.write(` filter ${APRS_FILTER}`);
      }
      aprsSocket.write('\r\n');
    });

    aprsSocket.on('data', (data) => {
      aprsBuffer += data.toString();
      const lines = aprsBuffer.split('\n');
      aprsBuffer = lines.pop(); // Keep incomplete last line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue; // Server comment

        const station = parseAprsPacket(trimmed);
        if (station) {
          // RF-wins: if this station was already heard locally over RF, preserve
          // the local-tnc tag even when an internet update arrives for the same station.
          const existingStation = aprsStations.get(station.ssid);
          if (existingStation?.source === 'local-tnc') {
            station.source = 'local-tnc';
          }
          aprsStations.set(station.ssid, station);

          // Prune if over limit
          if (aprsStations.size > APRS_MAX_STATIONS * 1.2) {
            const cutoff = Date.now() - APRS_MAX_AGE_MINUTES * 60000;
            for (const [key, val] of aprsStations) {
              if (val.timestamp < cutoff) aprsStations.delete(key);
            }
            // Hard cap if still too many
            if (aprsStations.size > APRS_MAX_STATIONS) {
              const sorted = [...aprsStations.entries()].sort((a, b) => b[1].timestamp - a[1].timestamp);
              aprsStations.clear();
              for (const [k, v] of sorted.slice(0, APRS_MAX_STATIONS)) {
                aprsStations.set(k, v);
              }
            }
          }
        } else {
          // Try parsing as telemetry
          const telem = parseAprsTelemetry(trimmed);
          if (telem && telem.type === 'data') {
            logDebug(`[APRS] Telemetry from ${telem.call}: seq ${telem.seq} [${telem.values.join(', ')}]`);
          }

          // Try parsing as a message (addressed message or bulletin)
          const msg = parseAprsMessage(trimmed);
          if (msg && !isDuplicateMessage(aprsMessages, msg)) {
            aprsMessages.push(msg);
            if (aprsMessages.length > APRS_MAX_MESSAGES) aprsMessages.shift();
            if (msg.isShelterReport) {
              logDebug(`[APRS] Shelter report from ${msg.from}: ${msg.text}`);
            }
            applyNetCommand(msg);
          }
        }
      }
    });

    aprsSocket.on('error', (err) => {
      logErrorOnce('APRS-IS', err.message);
    });

    aprsSocket.on('close', () => {
      aprsConnected = false;
      aprsSocket = null;
      logInfo('[APRS-IS] Disconnected, reconnecting in 30s...');
      clearTimeout(aprsReconnectTimer);
      aprsReconnectTimer = setTimeout(connectAprsIS, 30000);
    });

    aprsSocket.on('timeout', () => {
      logWarn('[APRS-IS] Socket timeout, reconnecting...');
      try {
        aprsSocket.destroy();
      } catch (e) {}
    });
  }

  // Periodic cleanup of old stations (runs regardless of APRS_ENABLED so that
  // RF-only stations injected via /api/aprs/local are also aged out correctly).
  setInterval(() => {
    const cutoff = Date.now() - APRS_MAX_AGE_MINUTES * 60000;
    for (const [key, val] of aprsStations) {
      if (val.timestamp < cutoff) aprsStations.delete(key);
    }
  }, 60000);

  // Start APRS-IS connection if enabled
  if (APRS_ENABLED) {
    connectAprsIS();
  }

  // REST endpoint: GET /api/aprs/stations
  app.get('/api/aprs/stations', (req, res) => {
    const cutoff = Date.now() - APRS_MAX_AGE_MINUTES * 60000;
    const stations = [];
    for (const [, station] of aprsStations) {
      if (station.timestamp >= cutoff) {
        stations.push({
          call: station.call,
          ssid: station.ssid,
          lat: station.lat,
          lon: station.lon,
          symbol: station.symbol,
          comment: station.comment,
          tokens: station.tokens || [],
          cleanComment: station.cleanComment || station.comment,
          speed: station.speed,
          course: station.course,
          altitude: station.altitude,
          device: station.device ?? null,
          age: Math.floor((Date.now() - station.timestamp) / 60000),
          timestamp: station.timestamp,
          source: station.source ?? null,
        });
      }
    }
    // tncActive: true whenever at least one station from the local TNC is present in the
    // cache. This lets the UI display RF data even when APRS_ENABLED (APRS-IS) is off.
    const tncActive = stations.some((s) => s.source === 'local-tnc');
    res.json({
      connected: aprsConnected,
      enabled: APRS_ENABLED,
      tncActive,
      count: stations.length,
      stations: stations.sort((a, b) => b.timestamp - a.timestamp),
    });
  });

  // REST endpoint: GET /api/aprs/messages — APRS messages and bulletins
  app.get('/api/aprs/messages', (req, res) => {
    const since = parseInt(req.query.since) || 0;
    const shelterOnly = req.query.shelter === 'true';
    let msgs = aprsMessages.filter((m) => m.timestamp > since);
    if (shelterOnly) msgs = msgs.filter((m) => m.isShelterReport);
    res.json({
      count: msgs.length,
      messages: msgs,
    });
  });

  // REST endpoint: GET /api/aprs/messages/history?call=KE8PLM-9 — both directions, newest first (#1216)
  app.get('/api/aprs/messages/history', (req, res) => {
    const call = String(req.query.call || '').trim();
    if (!call) return res.status(400).json({ error: 'call parameter required' });
    const messages = messagesForStation(aprsMessages, call);
    res.json({ call: call.toUpperCase(), count: messages.length, messages });
  });

  // Find a heard position for a reporting station (exact SSID first, then base call)
  function findStationPosition(from) {
    const exact = aprsStations.get(from);
    if (exact && exact.lat != null && exact.lon != null) return exact;
    const base = from.split('-')[0];
    for (const [, st] of aprsStations) {
      if (st.call === base && st.lat != null && st.lon != null) return st;
    }
    return null;
  }

  // REST endpoint: GET /api/aprs/shelters — shelter reports extracted from APRS.
  // Each report is enriched with the sender's last-heard position (when known)
  // so the EmComm UI can plot RF-sourced shelters alongside FEMA data.
  app.get('/api/aprs/shelters', (req, res) => {
    const shelterReports = aprsMessages
      .filter((m) => m.isShelterReport)
      .map((m) => {
        const pos = findStationPosition(m.from);
        return {
          from: m.from,
          text: m.cleanText || m.text,
          tokens: m.tokens,
          timestamp: m.timestamp,
          type: m.type,
          lat: pos ? pos.lat : null,
          lon: pos ? pos.lon : null,
          source: m.source === 'local-tnc' ? 'rf' : 'aprs-is',
        };
      });
    res.json({
      count: shelterReports.length,
      shelters: shelterReports,
    });
  });

  // REST endpoint: GET /api/aprs/net — net operations roster
  app.get('/api/aprs/net', (req, res) => {
    // Update lastHeard from station cache for each roster entry
    const roster = [];
    for (const [call, entry] of netRoster) {
      const station = aprsStations.get(call.split('-')[0]);
      if (station) {
        entry.lastHeard = station.timestamp;
        entry.lat = station.lat;
        entry.lon = station.lon;
        entry.tokens = station.tokens || [];
      }
      const age = Math.floor((Date.now() - entry.lastHeard) / 60000);
      roster.push({
        ...entry,
        age,
        stale: age > 10,
      });
    }
    roster.sort((a, b) => a.age - b.age);
    res.json({ count: roster.length, roster });
  });

  // REST endpoint: POST /api/aprs/net/checkin — manual check-in (for operators without APRS TX)
  app.post('/api/aprs/net/checkin', ingest(20), (req, res) => {
    const { callsign, netName, status } = req.body;
    if (!callsign || !netName) return res.status(400).json({ error: 'Missing callsign or netName' });
    if (typeof callsign !== 'string' || !CALLSIGN_RE.test(callsign)) {
      return res.status(400).json({ error: 'Invalid callsign' });
    }

    const station = aprsStations.get(callsign.split('-')[0].toUpperCase());
    netRoster.set(callsign.toUpperCase(), {
      call: callsign.toUpperCase(),
      netName: clip(netName, 32),
      status: status ? clip(status, 64) : 'Checked in',
      checkinTime: Date.now(),
      lastHeard: Date.now(),
      lat: station?.lat ?? null,
      lon: station?.lon ?? null,
      tokens: station?.tokens || [],
      source: 'manual',
    });
    trimRoster();
    res.json({ ok: true });
  });

  // REST endpoint: POST /api/aprs/net/checkout — manual check-out
  app.post('/api/aprs/net/checkout', ingest(20), (req, res) => {
    const { callsign } = req.body;
    if (!callsign) return res.status(400).json({ error: 'Missing callsign' });
    if (typeof callsign !== 'string' || !CALLSIGN_RE.test(callsign)) {
      return res.status(400).json({ error: 'Invalid callsign' });
    }
    netRoster.delete(callsign.toUpperCase());
    res.json({ ok: true });
  });

  // Apply channel equations (val = a*x^2 + b*x + c) to a raw sample
  function applyTelemetryEqns(values, eqns) {
    if (!eqns) return null;
    return values.map((v, i) => {
      const e = eqns[i];
      if (!e) return v;
      return e[0] * v * v + e[1] * v + e[2];
    });
  }

  // Build the API view of a telemetry entry, resolving PARM/UNIT/EQNS at read
  // time so definitions that arrive after data frames still label old samples.
  function telemetryView(entry) {
    const def = telemetryDefs.get(entry.call) || {};
    const computed = applyTelemetryEqns(entry.values, def.eqns);
    return {
      call: entry.call,
      seq: entry.seq,
      values: entry.values,
      bits: entry.bits,
      timestamp: entry.timestamp,
      source: entry.source || 'aprs-is',
      params: def.params || ['A1', 'A2', 'A3', 'A4', 'A5'],
      units: def.units || ['', '', '', '', ''],
      ...(computed ? { computed } : {}),
      history: (entry.history || []).map((h) => {
        const hc = applyTelemetryEqns(h.values, def.eqns);
        return { seq: h.seq, values: h.values, bits: h.bits, timestamp: h.timestamp, ...(hc ? { computed: hc } : {}) };
      }),
    };
  }

  // REST endpoint: GET /api/aprs/telemetry — telemetry data from all stations
  app.get('/api/aprs/telemetry', (req, res) => {
    const callsign = req.query.callsign;
    if (callsign) {
      const data = telemetryData.get(callsign.toUpperCase());
      return res.json(data ? telemetryView(data) : { error: 'No telemetry for this callsign' });
    }
    const all = [];
    for (const [, entry] of telemetryData) {
      all.push(telemetryView(entry));
    }
    all.sort((a, b) => b.timestamp - a.timestamp);
    res.json({ count: all.length, telemetry: all });
  });

  // REST endpoint: POST /api/aprs/message — send APRS message via rig-bridge
  app.post('/api/aprs/message', ingest(10), async (req, res) => {
    const { to, message } = req.body;
    if (!to || !message) return res.status(400).json({ error: 'Missing to or message' });
    if (typeof to !== 'string' || typeof message !== 'string' || !CALLSIGN_RE.test(to.trim())) {
      return res.status(400).json({ error: 'Invalid addressee or message' });
    }
    if (message.length > 67) return res.status(400).json({ error: 'Message exceeds 67 char APRS limit' });

    const recordSent = () => {
      aprsMessages.push({
        type: 'message',
        from: (CONFIG.callsign || 'N0CALL').toUpperCase(),
        to: String(to).trim().toUpperCase(),
        text: message,
        cleanText: message,
        tokens: [],
        msgId: null,
        isShelterReport: false,
        netCommand: null,
        direction: 'sent',
        source: 'local-tnc',
        timestamp: Date.now(),
        raw: null,
      });
      if (aprsMessages.length > APRS_MAX_MESSAGES) aprsMessages.shift();
    };

    // The browser already transmitted through its own Rig Bridge (#1243) —
    // record our side of the conversation for the message history only.
    // Not on a hosted server: there the history is shared by every visitor and
    // this endpoint has no auth, so a record-only write would let anyone add
    // "sent" lines (hosted browsers send through Cloud Relay, not directly).
    if (req.body.recordOnly === true) {
      if (TNC_STATUS_HOSTED) return res.status(403).json({ error: 'Not available on a hosted server' });
      recordSent();
      return res.json({ ok: true, recorded: true });
    }

    // Try to send via rig-bridge APRS TNC plugin
    try {
      const rigHost = CONFIG.rigControl?.host || 'http://localhost';
      const rigPort = CONFIG.rigControl?.port || 5555;
      const response = await ctx.fetch(`${rigHost}:${rigPort}/aprs/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, message }),
      });
      if (response.ok) {
        // Keep our own side of the conversation so a station's message
        // history shows both directions (#1216). Rig-bridge only transmits.
        recordSent();
        return res.json({ ok: true, via: 'rig-bridge' });
      }
      const err = await response.text();
      return res.status(response.status).json({ error: `Rig Bridge: ${err}` });
    } catch (e) {
      return res.status(503).json({ error: 'APRS TNC not available — enable APRS TNC plugin in rig-bridge' });
    }
  });

  // REST endpoint: GET /api/aprs/tnc-status — proxy to rig-bridge APRS TNC status
  // Lets the browser query TNC connection state without needing to know the rig-bridge port.
  // The probe result is cached so N polling clients share one upstream check per TTL
  // instead of each request spawning its own rig-bridge fetch. Hosted instances never
  // have a rig-bridge on the server's localhost, so they answer without probing at all.
  const TNC_STATUS_HOSTED = process.env.OHC_HOSTED === '1' || process.env.OHC_HOSTED === 'true';
  const TNC_STATUS_TTL_MS = 10000;
  const TNC_STATUS_TIMEOUT_MS = 2000;
  const TNC_STATUS_OFFLINE = { enabled: false, running: false, connected: false };
  let tncStatusCache = { data: TNC_STATUS_OFFLINE, fetchedAt: 0 };
  let tncStatusInflight = null;

  async function probeTncStatus() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TNC_STATUS_TIMEOUT_MS);
    try {
      const rigHost = CONFIG.rigControl?.host || 'http://localhost';
      const rigPort = CONFIG.rigControl?.port || 5555;
      const response = await ctx.fetch(`${rigHost}:${rigPort}/api/aprs-tnc/status`, {
        signal: controller.signal,
      });
      const data = response.ok ? await response.json() : TNC_STATUS_OFFLINE;
      tncStatusCache = { data, fetchedAt: Date.now() };
    } catch (e) {
      tncStatusCache = { data: TNC_STATUS_OFFLINE, fetchedAt: Date.now() };
    } finally {
      clearTimeout(timer);
      tncStatusInflight = null;
    }
  }

  app.get('/api/aprs/tnc-status', async (req, res) => {
    if (TNC_STATUS_HOSTED) {
      return res.json(TNC_STATUS_OFFLINE);
    }
    if (Date.now() - tncStatusCache.fetchedAt >= TNC_STATUS_TTL_MS) {
      if (!tncStatusInflight) {
        tncStatusInflight = probeTncStatus();
      }
      await tncStatusInflight;
    }
    return res.json(tncStatusCache.data);
  });

  // REST endpoint: POST /api/aprs/local — inject local TNC packets (from cloud relay)
  // Accepts raw APRS info strings and parses them into station objects.
  // The same RF frame can reach us twice — from rig-bridge directly (#1221)
  // and from a browser's forwarding (#1212). Identical frames inside this
  // window are counted once; a real re-beacon is minutes apart.
  const recentLocalFrames = new Map();
  const LOCAL_FRAME_DEDUPE_MS = 15000;
  function isDuplicateLocalFrame(pkt) {
    const key = `${pkt.source}|${pkt.destination || ''}|${pkt.info}`;
    const now = Date.now();
    const seen = recentLocalFrames.get(key);
    if (seen && now - seen < LOCAL_FRAME_DEDUPE_MS) return true;
    recentLocalFrames.set(key, now);
    if (recentLocalFrames.size > 2000) {
      for (const [k, t] of recentLocalFrames) {
        if (now - t >= LOCAL_FRAME_DEDUPE_MS) recentLocalFrames.delete(k);
      }
    }
    return false;
  }

  // Frames per request, and the field sizes a real AX.25 frame can have
  const LOCAL_MAX_PACKETS = 200;
  const LOCAL_MAX_INFO = 512;
  const LOCAL_MAX_CALL = 16;
  // A frame's own timestamp is trusted only if it is recent: a future date
  // would keep a station on the map forever and win over real updates.
  function frameTime(ts) {
    const now = Date.now();
    return typeof ts === 'number' && ts <= now + 60000 && ts >= now - 60 * 60000 ? Math.min(ts, now) : now;
  }

  app.post('/api/aprs/local', ingest(120), (req, res) => {
    const packets = req.body.packets;
    if (!Array.isArray(packets)) {
      return res.status(400).json({ error: 'Missing packets array' });
    }

    let added = 0;
    let duplicates = 0;
    for (const pkt of packets.slice(0, LOCAL_MAX_PACKETS)) {
      if (!pkt || typeof pkt.source !== 'string' || typeof pkt.info !== 'string') continue;
      if (!pkt.source || !pkt.info || pkt.source.length > LOCAL_MAX_CALL || pkt.info.length > LOCAL_MAX_INFO) continue;
      if (pkt.destination != null && (typeof pkt.destination !== 'string' || pkt.destination.length > LOCAL_MAX_CALL)) {
        continue;
      }
      pkt.timestamp = frameTime(pkt.timestamp);
      if (isDuplicateLocalFrame(pkt)) {
        duplicates++;
        continue;
      }

      // Reconstruct a raw APRS line so parseAprsPacket can handle it
      const rawLine = `${pkt.source}>${pkt.destination || 'APRS'}:${pkt.info}`;
      const station = parseAprsPacket(rawLine);
      if (!station) {
        // Try as telemetry (data frames + PARM/UNIT/EQNS definitions)
        const telem = parseAprsTelemetry(rawLine);
        if (telem) {
          if (telem.type === 'data') {
            const entry = telemetryData.get(telem.call);
            if (entry) entry.source = 'local-tnc';
          }
          continue;
        }
        // Try as message
        const msg = parseAprsMessage(rawLine);
        if (msg && !isDuplicateMessage(aprsMessages, msg)) {
          msg.source = 'local-tnc';
          aprsMessages.push(msg);
          if (aprsMessages.length > APRS_MAX_MESSAGES) aprsMessages.shift();
          applyNetCommand(msg);
        }
        continue;
      }

      station.source = 'local-tnc'; // Tag so UI can distinguish RF from internet
      station.timestamp = pkt.timestamp || Date.now();

      const key = station.ssid;
      const existing = aprsStations.get(key);
      // RF source wins: if an internet update arrives for a station we already
      // heard over the air, preserve the local-tnc tag so the UI keeps it in
      // the RF view even after the internet feed also reports the same station.
      if (existing?.source === 'local-tnc') {
        station.source = 'local-tnc';
      }
      if (!existing || station.timestamp > existing.timestamp) {
        if (!existing && aprsStations.size >= APRS_MAX_STATIONS) {
          // Evict oldest
          let oldestKey = null;
          let oldestTime = Infinity;
          for (const [k, v] of aprsStations) {
            if (v.timestamp < oldestTime) {
              oldestTime = v.timestamp;
              oldestKey = k;
            }
          }
          if (oldestKey) aprsStations.delete(oldestKey);
        }
        aprsStations.set(key, station);
        added++;
      }
    }

    logDebug(`[APRS] Ingested ${added} local TNC packets (${packets.length} received)`);
    res.json({ ok: true, added, duplicates });
  });
};
