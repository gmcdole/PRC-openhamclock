'use strict';
/**
 * aprs-tnc.js — Local APRS TNC plugin (KISS over TCP or Serial)
 *
 * Connects to a Direwolf, hardware TNC, or any KISS-compatible device.
 * Receives APRS packets over RF and forwards them to OHC's /api/aprs/local endpoint.
 * Sends APRS position beacons and messages via the TNC.
 *
 * Config section: config.aprs
 *   enabled:      boolean  (default: false)
 *   protocol:     'kiss-tcp' | 'kiss-serial'  (default: 'kiss-tcp')
 *   host:         string   TCP host for Direwolf (default: '127.0.0.1')
 *   port:         number   TCP port for Direwolf KISS (default: 8001)
 *   serialPort:   string   Serial port for hardware TNC (e.g. '/dev/ttyUSB0')
 *   baudRate:     number   Serial baud rate (default: 9600)
 *   callsign:     string   Your callsign for TX (e.g. 'N0CALL')
 *   ssid:         number   SSID (default: 0)
 *   path:         string[] Digipeater path (default: ['WIDE1-1', 'WIDE2-1'])
 *   destination:  string   APRS destination (default: 'APOHC1' — AP=APRS, OHC=OpenHamClock, 1=version)
 *   beaconInterval: number Beacon interval in seconds (default: 600, 0 = disabled)
 *   symbol:       string   APRS symbol (default: '/-' = house)
 *   verbose:      boolean  Log all packets (default: false)
 *   serverForward: boolean POST received frames to the OpenHamClock server (default: true)
 *   ohcUrl:       string   OpenHamClock server URL for that (default: 'http://localhost:3000')
 *
 * Supported TNC interfaces:
 *   - Direwolf (KISS over TCP, default port 8001)
 *   - Hardware TNC via serial (Mobilinkd, TNC-X, KPC-3+, etc.)
 */

const net = require('net');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const { parseAprsPacket } = require('../lib/aprs-parser');
const {
  decodeKissFrame,
  encodeKissFrame,
  extractKissFrames,
  parseAx25Frame,
  buildAx25Frame,
} = require('../lib/kiss-protocol');

let _currentInstance = null;

const descriptor = {
  id: 'aprs-tnc',
  name: 'APRS TNC (KISS)',
  category: 'integration',
  configKey: 'aprs',

  registerRoutes(app) {
    app.get('/api/aprs-tnc/status', (req, res) => {
      if (!_currentInstance) return res.json({ enabled: false, running: false });
      res.json(_currentInstance.getStatus());
    });

    // Send a position beacon
    app.post('/aprs/beacon', (req, res) => {
      if (!_currentInstance) return res.status(503).json({ error: 'APRS TNC not running' });
      const { lat, lon, comment } = req.body;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return res.status(400).json({ error: 'Missing or invalid lat/lon' });
      }
      if (!_currentInstance.sendBeacon(lat, lon, comment || '')) {
        return res.status(503).json({ error: 'TNC not connected' });
      }
      res.json({ success: true });
    });

    // Send an APRS message
    app.post('/aprs/message', (req, res) => {
      if (!_currentInstance) return res.status(503).json({ error: 'APRS TNC not running' });
      const { to, message, msgId } = req.body;
      if (!to || !message) return res.status(400).json({ error: 'Missing to or message' });
      if (message.length > 67) return res.status(400).json({ error: 'Message exceeds 67 character APRS limit' });
      if (!_currentInstance.sendMessage(to, message, msgId)) {
        return res.status(503).json({ error: 'TNC not connected' });
      }
      res.json({ success: true });
    });

    // Send a message acknowledgment
    app.post('/aprs/ack', (req, res) => {
      if (!_currentInstance) return res.status(503).json({ error: 'APRS TNC not running' });
      const { to, msgId } = req.body;
      if (!to || !msgId) return res.status(400).json({ error: 'Missing to or msgId' });
      if (!_currentInstance.sendAck(to, msgId)) {
        return res.status(503).json({ error: 'TNC not connected' });
      }
      res.json({ success: true });
    });

    // SSE stream of raw APRS packets
    app.get('/aprs/stream', (req, res) => {
      if (!_currentInstance) return res.status(503).json({ error: 'APRS TNC not running' });
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      const listener = (packet) => {
        res.write(`data: ${JSON.stringify(packet)}\n\n`);
      };
      _currentInstance.addPacketListener(listener);
      req.on('close', () => {
        _currentInstance?.removePacketListener(listener);
      });
    });
  },

  create(config, services) {
    const cfg = config.aprs || {};
    const bus = services?.pluginBus;
    const protocol = cfg.protocol || 'kiss-tcp';
    const beaconIntervalSec = cfg.beaconInterval != null ? cfg.beaconInterval : 600;

    // Station identity is read from the live config on every frame, not
    // captured once at start-up: the settings page saves without restarting
    // the plugin, and a captured value meant a changed SSID kept going out
    // under the old one until rig-bridge was restarted (#1213). Protocol,
    // host/port and the beacon timer are connection-level and still need a
    // restart.
    const live = () => config.aprs || cfg;
    const stationCall = () => (live().callsign || 'N0CALL').toUpperCase();
    const stationSsid = () => {
      const n = parseInt(live().ssid, 10);
      return Number.isFinite(n) && n > 0 && n <= 15 ? n : 0;
    };
    const myCallNow = () => (stationSsid() > 0 ? `${stationCall()}-${stationSsid()}` : stationCall());
    const destNow = () => live().destination || 'APOHC1';
    const pathNow = () => live().path || ['WIDE1-1', 'WIDE2-1'];
    const symbolNow = () => live().symbol || '/-';

    let connection = null; // TCP socket or serial port
    let kissBuffer = Buffer.alloc(0);
    let beaconTimer = null;
    let reconnectTimer = null;
    let connected = false;
    let packetsRx = 0;
    let packetsTx = 0;
    let lastBeaconTime = null;
    const packetListeners = new Set();

    // Server forwarding (#1221): every received frame is also POSTed to the
    // OpenHamClock server's /api/aprs/local, batched once a second, so the
    // server's station cache — and every browser that reads it — sees RF
    // stations whether or not a browser is connected to this stream. Read
    // from the live config so the settings page applies without a restart.
    const forwardQueue = [];
    let forwardTimer = null;
    const forwardEnabled = () => live().serverForward !== false;
    const forwardUrl = () => {
      const base = String(live().ohcUrl || 'http://localhost:3000').replace(/\/$/, '');
      try {
        return new URL(`${base}/api/aprs/local`);
      } catch (e) {
        return null;
      }
    };
    function flushForwardQueue() {
      forwardTimer = null;
      const packets = forwardQueue.splice(0, 200);
      if (!packets.length) return;
      const target = forwardUrl();
      if (!target) return;
      const body = JSON.stringify({ packets });
      const mod = target.protocol === 'https:' ? https : http;
      const req = mod.request(
        {
          hostname: target.hostname,
          port: target.port || (target.protocol === 'https:' ? 443 : 80),
          path: target.pathname,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        },
        (res) => res.resume(),
      );
      req.on('error', () => {}); // fire-and-forget — a down server never stalls the receive loop
      req.setTimeout(3000, () => req.destroy());
      req.write(body);
      req.end();
    }
    function enqueueForward(packet) {
      if (!forwardEnabled()) return;
      forwardQueue.push(packet);
      if (forwardQueue.length > 1000) forwardQueue.splice(0, forwardQueue.length - 1000);
      if (!forwardTimer) forwardTimer = setTimeout(flushForwardQueue, 1000);
    }

    function addPacketListener(fn) {
      packetListeners.add(fn);
    }
    function removePacketListener(fn) {
      packetListeners.delete(fn);
    }
    function notifyListeners(packet) {
      for (const fn of packetListeners) {
        try {
          fn(packet);
        } catch (e) {}
      }
    }

    // Format latitude for APRS: DDMM.MMN
    function formatAprsLat(lat) {
      const hemi = lat >= 0 ? 'N' : 'S';
      lat = Math.abs(lat);
      const deg = Math.floor(lat);
      const min = (lat - deg) * 60;
      return `${String(deg).padStart(2, '0')}${min.toFixed(2).padStart(5, '0')}${hemi}`;
    }

    // Format longitude for APRS: DDDMM.MMW
    function formatAprsLon(lon) {
      const hemi = lon >= 0 ? 'E' : 'W';
      lon = Math.abs(lon);
      const deg = Math.floor(lon);
      const min = (lon - deg) * 60;
      return `${String(deg).padStart(3, '0')}${min.toFixed(2).padStart(5, '0')}${hemi}`;
    }

    function handleKissData(data) {
      kissBuffer = Buffer.concat([kissBuffer, data]);
      const { frames, remainder } = extractKissFrames(kissBuffer);
      kissBuffer = remainder;

      for (const frame of frames) {
        const ax25Data = decodeKissFrame(frame);
        if (!ax25Data) continue;

        const packet = parseAx25Frame(ax25Data);
        if (!packet) continue;

        packetsRx++;
        if (cfg.verbose) {
          console.log(`[APRS-TNC] RX: ${packet.source}>${packet.destination}: ${packet.info}`);
        }

        // Parse position fields here so the SSE path delivers a fully-formed
        // station object and the browser needs no server round-trip.
        // Raw source/destination/info are kept so the cloud-relay path can
        // still forward them to /api/aprs/local for server-side processing.
        const rawLine = `${packet.source}>${packet.destination}:${packet.info}`;
        const parsed = parseAprsPacket(rawLine);
        const aprsPacket = {
          // Raw fields — required by cloud relay to re-parse on the server
          source: packet.source, // full callsign incl. SSID
          destination: packet.destination,
          digipeaters: packet.digipeaters,
          info: packet.info,
          timestamp: Date.now(),
          // Parsed position fields (call, ssid, lat, lon, symbol, comment, …)
          // Spread last so raw 'source' above is not overwritten (parsed has
          // 'call'/'ssid', not 'source').
          ...(parsed ?? {}),
          // Explicit tag so the frontend can identify RF packets without
          // a server round-trip ('source' is the callsign, not origin type).
          stationSource: 'local-tnc',
        };

        // Emit on shared bus — picked up by cloud-relay plugin and by the
        // bus-to-SSE bridge in rig-bridge.js for direct/local connections.
        if (bus) {
          bus.emit('aprs', aprsPacket);
        }

        // Notify SSE listeners
        const rawFrame = {
          source: packet.source,
          destination: packet.destination,
          digipeaters: packet.digipeaters,
          info: packet.info,
          timestamp: Date.now(),
        };
        notifyListeners(rawFrame);
        enqueueForward(rawFrame);
      }
    }

    function sendRaw(ax25Frame) {
      if (!connection || !connected) return false;
      const kissFrame = encodeKissFrame(ax25Frame);
      try {
        connection.write(kissFrame);
        packetsTx++;
        return true;
      } catch (e) {
        console.error(`[APRS-TNC] TX error: ${e.message}`);
        return false;
      }
    }

    function sendBeacon(lat, lon, comment) {
      const symbol = symbolNow();
      const symbolTable = symbol.charAt(0);
      const symbolCode = symbol.charAt(1);
      const info = `!${formatAprsLat(lat)}${symbolTable}${formatAprsLon(lon)}${symbolCode}${comment || ''}`;
      const frame = buildAx25Frame(myCallNow(), destNow(), pathNow(), info);
      const ok = sendRaw(frame);
      if (ok) {
        lastBeaconTime = Date.now();
        console.log(`[APRS-TNC] TX beacon: ${myCallNow()} @ ${lat.toFixed(4)},${lon.toFixed(4)}`);
      }
      return ok;
    }

    function sendMessage(to, message, msgId) {
      const padTo = to.padEnd(9, ' ');
      const idSuffix = msgId ? `{${msgId}` : '';
      const info = `:${padTo}:${message}${idSuffix}`;
      const frame = buildAx25Frame(myCallNow(), destNow(), pathNow(), info);
      const ok = sendRaw(frame);
      if (ok) {
        console.log(`[APRS-TNC] TX msg to ${to}: ${message}`);
      }
      return ok;
    }

    function sendAck(to, msgId) {
      const padTo = to.padEnd(9, ' ');
      const info = `:${padTo}:ack${msgId}`;
      const frame = buildAx25Frame(myCallNow(), destNow(), pathNow(), info);
      const ok = sendRaw(frame);
      if (ok) {
        console.log(`[APRS-TNC] TX ack to ${to} for msg ${msgId}`);
      }
      return ok;
    }

    function connectTcp() {
      const host = cfg.host || '127.0.0.1';
      const port = cfg.port || 8001;

      console.log(`[APRS-TNC] Connecting to KISS TNC at ${host}:${port}...`);
      const socket = net.createConnection({ host, port }, () => {
        console.log(`[APRS-TNC] Connected to ${host}:${port}`);
        connected = true;
        connection = socket;
      });

      socket.on('data', handleKissData);

      socket.on('error', (err) => {
        if (connected) {
          console.error(`[APRS-TNC] Connection error: ${err.message}`);
        }
        connected = false;
        connection = null;
      });

      socket.on('close', () => {
        if (connected) {
          console.log('[APRS-TNC] Connection closed, reconnecting in 10s...');
        }
        connected = false;
        connection = null;
        reconnectTimer = setTimeout(() => connectTcp(), 10000);
      });

      connection = socket;
    }

    function connect() {
      if (stationCall() === 'N0CALL') {
        console.warn('[APRS-TNC] Cannot start: configure your callsign in aprs.callsign');
        return;
      }

      if (protocol === 'kiss-tcp') {
        connectTcp();
      } else if (protocol === 'kiss-serial') {
        // Serial support requires the serialport package — available via rig-bridge's USB plugins
        try {
          const { getSerialPort } = require('../core/serial-utils');
          const SerialPort = getSerialPort();
          const port = new SerialPort({
            path: cfg.serialPort,
            baudRate: cfg.baudRate || 9600,
            dataBits: 8,
            stopBits: 1,
            parity: 'none',
          });
          port.on('open', () => {
            console.log(`[APRS-TNC] Serial port ${cfg.serialPort} opened`);
            connected = true;
            connection = port;
          });
          port.on('data', handleKissData);
          port.on('error', (err) => {
            console.error(`[APRS-TNC] Serial error: ${err.message}`);
            connected = false;
          });
          port.on('close', () => {
            console.log('[APRS-TNC] Serial port closed');
            connected = false;
            connection = null;
          });
          connection = port;
        } catch (e) {
          console.error(`[APRS-TNC] Serial not available: ${e.message}`);
        }
      }

      // Start periodic beacons
      if (beaconIntervalSec > 0 && config.latitude && config.longitude) {
        beaconTimer = setInterval(() => {
          if (connected) {
            sendBeacon(config.latitude, config.longitude, `OpenHamClock ${config.callsign || ''}`);
          }
        }, beaconIntervalSec * 1000);
      }
    }

    function disconnect() {
      if (forwardTimer) {
        clearTimeout(forwardTimer);
        forwardTimer = null;
      }
      forwardQueue.length = 0;
      if (beaconTimer) {
        clearInterval(beaconTimer);
        beaconTimer = null;
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (connection) {
        try {
          connection.destroy ? connection.destroy() : connection.close();
        } catch (e) {}
        connection = null;
      }
      connected = false;
      _currentInstance = null;
      console.log(`[APRS-TNC] Stopped (RX: ${packetsRx}, TX: ${packetsTx})`);
    }

    function getStatus() {
      return {
        enabled: !!cfg.enabled,
        running: connection !== null,
        connected,
        protocol,
        callsign: myCallNow(),
        packetsRx,
        packetsTx,
        lastBeaconTime,
        host: protocol === 'kiss-tcp' ? cfg.host || '127.0.0.1' : undefined,
        port: protocol === 'kiss-tcp' ? cfg.port || 8001 : undefined,
        serialPort: protocol === 'kiss-serial' ? cfg.serialPort : undefined,
        serverForward: forwardEnabled(),
        ohcUrl: forwardEnabled() ? String(forwardUrl()?.origin || '') : undefined,
      };
    }

    const instance = {
      connect,
      disconnect,
      getStatus,
      sendBeacon,
      sendMessage,
      sendAck,
      addPacketListener,
      removePacketListener,
    };
    _currentInstance = instance;
    return instance;
  },
};

module.exports = descriptor;
