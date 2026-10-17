/**
 * MeshCom and WSJT-X session reads follow the Cloud Relay read rules: once a
 * relay session's bridge registers its read-token hash, ?session= alone no
 * longer returns that session's data; session-less (local) reads and
 * sessions that are not relay sessions are unaffected; unpaired relay
 * sessions read openly only until the grace date.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const sign = require('../../rig-bridge/lib/relay-sign.js');
let dir;

function loadServer(env = {}) {
  const routes = {};
  const app = {};
  for (const m of ['get', 'post', 'delete', 'put', 'use', 'options']) {
    app[m] = (p, ...h) => (routes[`${m.toUpperCase()} ${p}`] = h);
  }
  const saved = { ...process.env };
  Object.assign(process.env, { WSJTX_ENABLED: 'false', WSJTX_RELAY_KEY: 'relaykey', ...env });
  const noop = () => {};
  const ctx = {
    ROOT_DIR: dir,
    logInfo: noop,
    logWarn: noop,
    logDebug: noop,
    logErrorOnce: noop,
    CONFIG: {},
    writeLimiter: (q, r, n) => n(),
    requireWriteAuth: (q, r, n) => n(),
    extractBaseCallsign: (c) => c,
    estimateLocationFromPrefix: () => null,
    lookupCallsignLocation: async () => null,
    callsignLookupCache: new Map(),
    RIG_BRIDGE_RELAY_KEY: 'k',
    fetch: () => Promise.resolve({ ok: true }),
    PORT: 0,
  };
  // Same order as server.js: wsjtx and meshcom load before rig-bridge
  require('./wsjtx.js')(app, ctx);
  require('./meshcom.js')(app, ctx);
  require('./rig-bridge.js')(app, ctx);
  process.env = saved;
  const call = (method, url, req = {}) =>
    new Promise((resolve) => {
      const handlers = routes[`${method} ${url}`];
      const res = {
        code: 200,
        status(c) {
          this.code = c;
          return this;
        },
        set() {
          return this;
        },
        end() {
          resolve({ code: this.code, body: null });
        },
        json(body) {
          resolve({ code: this.code, body });
        },
      };
      const full = { headers: {}, query: {}, body: {}, protocol: 'http', get: () => 'localhost', on() {}, ...req };
      let i = 0;
      const next = () => handlers[++i](full, res, next);
      handlers[0](full, res, next);
    });
  return { call };
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'setTimeout'] });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ohc-relay-sess-'));
  process.env.RELAY_TOKENS_FILE = path.join(dir, 'relay-tokens.json');
});

afterAll(() => {
  vi.useRealTimers();
  delete process.env.RELAY_TOKENS_FILE;
  fs.rmSync(dir, { recursive: true, force: true });
});

const KEY = '5'.repeat(64);
const READS = [
  '/api/meshcom/nodes',
  '/api/meshcom/messages',
  '/api/meshcom/weather',
  '/api/meshcom/status',
  '/api/wsjtx',
  '/api/wsjtx/decodes',
];

async function pair(srv, id, key) {
  const cred = await srv.call('GET', '/api/rig-bridge/relay/credentials', { query: { session: id } });
  const headers = { authorization: `Bearer ${cred.body.relayKey}`, 'x-relay-session': id };
  const body = { session: id, freq: 1 };
  if (key) body.readTokenHash = sign.readTokenHash(sign.deriveReadToken(key, id));
  await srv.call('POST', '/api/rig-bridge/relay/state', { headers, body });
}

describe('MeshCom and WSJT-X reads of a paired relay session', () => {
  it('need the read token', async () => {
    const srv = loadServer();
    await pair(srv, 'sessmesh000000a1', KEY);
    const token = sign.deriveReadToken(KEY, 'sessmesh000000a1');
    for (const url of READS) {
      const q = { session: 'sessmesh000000a1' };
      expect((await srv.call('GET', url, { query: q })).code, url).toBe(401);
      const wrong = { 'x-relay-read': sign.deriveReadToken('6'.repeat(64), 'sessmesh000000a1') };
      expect((await srv.call('GET', url, { query: q, headers: wrong })).code, url).toBe(401);
      expect((await srv.call('GET', url, { query: q, headers: { 'x-relay-read': token } })).code, url).toBe(200);
    }
  });

  it('leave local (no session) and non-relay sessions alone', async () => {
    const srv = loadServer();
    for (const url of READS) {
      expect((await srv.call('GET', url, {})).code, url).toBe(200);
      expect((await srv.call('GET', url, { query: { session: 'browseronly01' } })).code, url).toBe(200);
    }
  });
});

describe('unpaired relay sessions', () => {
  it('read openly until the grace date, then are refused', async () => {
    const open = loadServer({ RELAY_UNSIGNED_GRACE_UNTIL: '2999-01-01' });
    await pair(open, 'sessmesh000000b1', '');
    for (const url of READS) {
      expect((await open.call('GET', url, { query: { session: 'sessmesh000000b1' } })).code, url).toBe(200);
    }
    const closed = loadServer({ RELAY_UNSIGNED_GRACE_UNTIL: '2020-01-01' });
    await pair(closed, 'sessmesh000000b2', '');
    for (const url of READS) {
      const r = await closed.call('GET', url, { query: { session: 'sessmesh000000b2' } });
      expect(r.code, url).toBe(401);
      expect(r.body.error).toMatch(/no command key/);
    }
  });
});
