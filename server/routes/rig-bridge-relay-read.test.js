/**
 * Cloud relay reads (server side): once the bridge registers its read-token
 * hash, state / decodes / APRS need the read token and the stream needs a
 * one-time ticket bought with it; unpaired sessions read openly only until
 * the grace date; credentials for an existing session cannot be re-issued;
 * the hash survives a server restart.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { EventEmitter } from 'events';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const sign = require('../../rig-bridge/lib/relay-sign.js');
let dir;

/** Load the routes onto a stub app (each call = a fresh server process). */
function loadServer(env = {}) {
  const routes = {};
  const app = {};
  for (const m of ['get', 'post', 'delete', 'put', 'use'])
    app[m] = (p, ...h) => (routes[`${m.toUpperCase()} ${p}`] = h);
  const saved = { ...process.env };
  Object.assign(process.env, env);
  const noop = () => {};
  const warns = [];
  require('./rig-bridge.js')(app, {
    ROOT_DIR: dir,
    logInfo: noop,
    logWarn: (m) => warns.push(m),
    requireWriteAuth: (q, r, n) => n(),
    RIG_BRIDGE_RELAY_KEY: 'k',
    fetch: () => Promise.resolve({ ok: true }),
    PORT: 0,
  });
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
        json(body) {
          resolve({ code: this.code, body });
        },
      };
      const full = { headers: {}, query: {}, body: {}, protocol: 'http', get: () => 'localhost', on() {}, ...req };
      let i = 0;
      const next = () => handlers[++i](full, res, next);
      handlers[0](full, res, next);
    });
  const stream = (query) => {
    const writes = [];
    let refused = null;
    const req = new EventEmitter();
    req.query = query;
    const res = {
      setHeader() {},
      flushHeaders() {},
      write: (s) => writes.push(s),
      status(c) {
        this.code = c;
        return this;
      },
      json(b) {
        refused = { code: this.code || 200, body: b };
      },
    };
    routes['GET /api/rig-bridge/relay/stream'][0](req, res);
    req.emit('close');
    return { opened: writes.length > 0, refused };
  };
  return { call, stream, warns };
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'setTimeout'] });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ohc-relay-read-'));
  process.env.RELAY_TOKENS_FILE = path.join(dir, 'relay-tokens.json');
});

afterAll(() => {
  vi.useRealTimers();
  delete process.env.RELAY_TOKENS_FILE;
  fs.rmSync(dir, { recursive: true, force: true });
});

const KEY = '7'.repeat(64);

async function pair(srv, id, { key = KEY, via = 'body' } = {}) {
  const cred = await srv.call('GET', '/api/rig-bridge/relay/credentials', { query: { session: id } });
  const headers = { authorization: `Bearer ${cred.body.relayKey}`, 'x-relay-session': id };
  const hash = key ? sign.readTokenHash(sign.deriveReadToken(key, id)) : undefined;
  if (via === 'header' && hash) headers['x-relay-read-hash'] = hash;
  await srv.call('POST', '/api/rig-bridge/relay/state', {
    headers,
    body: { session: id, freq: 7074000, ...(via === 'body' && hash ? { readTokenHash: hash } : {}) },
  });
  return { token: key ? sign.deriveReadToken(key, id) : '', headers };
}

describe('protected sessions', () => {
  it('state, decodes and APRS need the read token', async () => {
    const srv = loadServer();
    const { token } = await pair(srv, 'read0000000000a1');
    for (const ep of ['state', 'decodes', 'aprs']) {
      const url = `/api/rig-bridge/relay/${ep}`;
      expect((await srv.call('GET', url, { query: { session: 'read0000000000a1' } })).code, ep).toBe(401);
      const wrong = { 'x-relay-read': sign.deriveReadToken('8'.repeat(64), 'read0000000000a1') };
      expect((await srv.call('GET', url, { query: { session: 'read0000000000a1' }, headers: wrong })).code).toBe(401);
      const ok = await srv.call('GET', url, {
        query: { session: 'read0000000000a1' },
        headers: { 'x-relay-read': token },
      });
      expect(ok.code, ep).toBe(200);
    }
  });

  it('the stream needs a one-time ticket bought with the read token', async () => {
    const srv = loadServer();
    const { token } = await pair(srv, 'read0000000000a2', { via: 'header' });
    expect(srv.stream({ session: 'read0000000000a2' }).refused.code).toBe(401);
    const noTok = await srv.call('POST', '/api/rig-bridge/relay/stream-ticket', {
      query: { session: 'read0000000000a2' },
    });
    expect(noTok.code).toBe(401);
    const t = await srv.call('POST', '/api/rig-bridge/relay/stream-ticket', {
      query: { session: 'read0000000000a2' },
      headers: { 'x-relay-read': token },
    });
    expect(t.body.ticket).toMatch(/^[0-9a-f]{32}$/);
    expect(srv.stream({ session: 'read0000000000a2', ticket: t.body.ticket }).opened).toBe(true);
    expect(srv.stream({ session: 'read0000000000a2', ticket: t.body.ticket }).refused.code).toBe(401); // single use
  });

  it('a ticket is bound to its session', async () => {
    const srv = loadServer();
    const a = await pair(srv, 'read0000000000a3');
    await pair(srv, 'read0000000000a4');
    const t = await srv.call('POST', '/api/rig-bridge/relay/stream-ticket', {
      query: { session: 'read0000000000a3' },
      headers: { 'x-relay-read': a.token },
    });
    expect(srv.stream({ session: 'read0000000000a4', ticket: t.body.ticket }).refused.code).toBe(401);
  });

  it('the registered hash survives a server restart', async () => {
    const srv = loadServer();
    const { token } = await pair(srv, 'read0000000000a5');
    const restarted = loadServer();
    expect(
      (await restarted.call('GET', '/api/rig-bridge/relay/state', { query: { session: 'read0000000000a5' } })).code,
    ).toBe(401);
    const ok = await restarted.call('GET', '/api/rig-bridge/relay/state', {
      query: { session: 'read0000000000a5' },
      headers: { 'x-relay-read': token },
    });
    expect(ok.code).toBe(200);
  });

  it('credentials cannot be re-issued for an existing session', async () => {
    const srv = loadServer();
    await pair(srv, 'read0000000000a6');
    const again = await srv.call('GET', '/api/rig-bridge/relay/credentials', {
      query: { session: 'read0000000000a6' },
    });
    expect(again.code).toBe(409);
    expect((await srv.call('GET', '/api/rig-bridge/relay/credentials', { query: { session: 'BAD!' } })).code).toBe(400);
  });
});

describe('unpaired sessions (bridge without a command key)', () => {
  it('read openly until the grace date, with a warning', async () => {
    const srv = loadServer({ RELAY_UNSIGNED_GRACE_UNTIL: '2999-01-01' });
    await pair(srv, 'read0000000000b1', { key: '' });
    expect(
      (await srv.call('GET', '/api/rig-bridge/relay/state', { query: { session: 'read0000000000b1' } })).code,
    ).toBe(200);
    expect(srv.stream({ session: 'read0000000000b1' }).opened).toBe(true);
    expect(srv.warns.some((w) => /without a read token/.test(w))).toBe(true);
  });

  it('are refused after the grace date', async () => {
    const srv = loadServer({ RELAY_UNSIGNED_GRACE_UNTIL: '2020-01-01' });
    await pair(srv, 'read0000000000b2', { key: '' });
    const r = await srv.call('GET', '/api/rig-bridge/relay/state', { query: { session: 'read0000000000b2' } });
    expect(r.code).toBe(401);
    expect(r.body.error).toMatch(/no command key/);
    expect(srv.stream({ session: 'read0000000000b2' }).refused.code).toBe(401);
  });
});
