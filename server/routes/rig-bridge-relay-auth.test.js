/**
 * Cloud relay command auth (server side): signatures are passed through
 * untouched to the bridge, malformed ones rejected, and once the bridge says
 * it signs commands, unsigned ones are refused here with a clear message.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { signCommand } = require('../../rig-bridge/lib/relay-sign.js');
let dir;
const routes = {};

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

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'setTimeout'] });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ohc-relay-auth-'));
  process.env.RELAY_TOKENS_FILE = path.join(dir, 'relay-tokens.json');
  const app = {};
  for (const m of ['get', 'post', 'delete', 'put', 'use'])
    app[m] = (p, ...h) => (routes[`${m.toUpperCase()} ${p}`] = h);
  const noop = () => {};
  require('./rig-bridge.js')(app, {
    ROOT_DIR: dir,
    logInfo: noop,
    logWarn: noop,
    requireWriteAuth: (q, r, n) => n(),
    RIG_BRIDGE_RELAY_KEY: 'k',
    fetch: () => Promise.resolve({ ok: true }),
    PORT: 0,
  });
});

afterAll(() => {
  vi.useRealTimers();
  delete process.env.RELAY_TOKENS_FILE;
  fs.rmSync(dir, { recursive: true, force: true });
});

async function pairedSession(id, commandAuth) {
  const cred = await call('GET', '/api/rig-bridge/relay/credentials', { query: { session: id } });
  const headers = { authorization: `Bearer ${cred.body.relayKey}`, 'x-relay-session': id };
  await call('POST', '/api/rig-bridge/relay/state', { headers, body: { session: id, freq: 7074000, commandAuth } });
  const send = (body) => call('POST', '/api/rig-bridge/relay/command', { query: { session: id }, body });
  const take = () => call('GET', '/api/rig-bridge/relay/commands', { headers, query: { session: id } });
  return { send, take, headers };
}

describe('relay/command authentication', () => {
  it('a signing bridge: unsigned commands are refused, signed ones delivered with their signature', async () => {
    const { send, take } = await pairedSession('sess1000000000aa', 'hmac-sha256');
    const unsigned = await send({ type: 'setPTT', payload: { ptt: true } });
    expect(unsigned.code).toBe(401);
    expect(unsigned.body.error).toMatch(/signed commands/);
    const auth = signCommand('d'.repeat(64), 'sess1000000000aa', 'setPTT', { ptt: true });
    expect((await send({ type: 'setPTT', payload: { ptt: true }, auth })).code).toBe(200);
    const got = await take();
    expect(got.body.commands).toHaveLength(1);
    expect(got.body.commands[0]).toMatchObject({ type: 'setPTT', payload: { ptt: true }, auth });
  });

  it('rejects malformed signatures and oversized commands', async () => {
    const { send } = await pairedSession('sess2000000000bb', 'hmac-sha256');
    const bad = await send({ type: 'setPTT', payload: {}, auth: { v: 1, ts: 1, nonce: 'zz', sig: 'nope' } });
    expect(bad.code).toBe(400);
    const big = await send({ type: 'fldigi', payload: { body: { text: 'x'.repeat(20000) } } });
    expect(big.code).toBe(413);
  });

  it('a bridge that has not been re-paired still gets unsigned commands (it applies its own policy)', async () => {
    const { send, take } = await pairedSession('sess3000000000cc', 'none');
    expect((await send({ type: 'setFreq', payload: { freq: 1 } })).code).toBe(200);
    expect((await take()).body.commands[0]).toMatchObject({ type: 'setFreq' });
  });

  it('unknown sessions get 404', async () => {
    const r = await call('POST', '/api/rig-bridge/relay/command', {
      query: { session: 'nope00000000' },
      body: { type: 'setPTT' },
    });
    expect(r.code).toBe(404);
  });
});

describe('relay/commands session binding', () => {
  it("one bridge's credentials can't take another session's queued commands", async () => {
    const a = await pairedSession('sessa00000000001');
    const b = await pairedSession('sessb00000000002');
    expect((await b.send({ type: 'setFreq', payload: { freq: 14074000 } })).code).toBe(200);

    // A's own valid header, B's session in the URL — the reported attack
    const stolen = await call('GET', '/api/rig-bridge/relay/commands', {
      headers: a.headers,
      query: { session: 'sessb00000000002' },
    });
    expect(stolen.code).toBe(400);

    // B still gets its command
    const got = await b.take();
    expect(got.body.commands).toHaveLength(1);
    expect(got.body.commands[0]).toMatchObject({ type: 'setFreq' });
  });
});
