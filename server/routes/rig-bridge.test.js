/**
 * Tests for server/routes/rig-bridge.js — cloud relay command long-poll.
 *
 * Regression: relay sessions live only in memory, while the relay tokens that
 * authenticate them are persisted. After a server restart — or after an idle
 * rig's session passed the 1 h TTL, since a long-poll that delivered nothing
 * never counted as activity — GET /relay/commands for that session answered
 * `{ commands: [] }` immediately instead of holding. Rig Bridge treats a 200
 * as healthy and re-polls at once, so it spun at ~30 req/s, exhausted the
 * per-IP /api rate limit, and starved every other client behind the same IP
 * (including its own state pushes, which are what re-create the session).
 *
 * The route module is mounted on a minimal fake Express app; handlers are
 * invoked directly with stub req/res objects (auth middleware is skipped).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

const mountRigBridge = require('./rig-bridge.js');

const LONG_POLL_WAIT = 28000;
const TTL = 60 * 60 * 1000;
const CLEANUP_INTERVAL = 15000;

function makeApp() {
  const routes = {};
  const register =
    (method) =>
    (p, ...handlers) => {
      routes[`${method} ${p}`] = handlers[handlers.length - 1];
    };
  return {
    routes,
    get: register('GET'),
    post: register('POST'),
    put: register('PUT'),
    delete: register('DELETE'),
    use() {},
  };
}

// Returns { res, result } where result.payload is set once the handler responds.
function call(handler, { body = {}, query = {}, headers = {} } = {}) {
  const result = { statusCode: 200, payload: undefined };
  const res = {
    headersSent: false,
    status(code) {
      result.statusCode = code;
      return res;
    },
    json(data) {
      result.payload = data;
      res.headersSent = true;
      return res;
    },
  };
  const req = { body, query, headers, ip: '203.0.113.7', socket: {}, on() {} };
  handler(req, res);
  return result;
}

describe('rig-bridge relay command long-poll', () => {
  let routes;
  let tmp;

  beforeEach(() => {
    vi.useFakeTimers();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ohc-relay-'));
    process.env.RELAY_TOKENS_FILE = path.join(tmp, 'relay-tokens.json');
    const app = makeApp();
    mountRigBridge(app, {
      ROOT_DIR: tmp,
      logInfo: () => {},
      logWarn: () => {},
      requireWriteAuth: (req, res, next) => next(),
      RIG_BRIDGE_RELAY_KEY: 'test-key',
    });
    routes = app.routes;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    delete process.env.RELAY_TOKENS_FILE;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const poll = (session) =>
    call(routes['GET /api/rig-bridge/relay/commands'], { query: { session, wait: String(LONG_POLL_WAIT) } });
  const pushState = (session) =>
    call(routes['POST /api/rig-bridge/relay/state'], {
      body: { session, connected: true, freq: 14074000, mode: 'USB' },
    });
  const sendCommand = (session) =>
    call(routes['POST /api/rig-bridge/relay/command'], {
      body: { session, type: 'setFreq', payload: { freq: 7074000 } },
    });

  it('holds a long-poll for a session the server does not know yet', () => {
    const result = poll('restarted-session');
    expect(result.payload).toBeUndefined();

    vi.advanceTimersByTime(LONG_POLL_WAIT);
    expect(result.statusCode).toBe(200);
    expect(result.payload).toEqual({ commands: [] });
  });

  it('delivers a dashboard command to a bridge that is long-polling an unknown session', () => {
    const result = poll('restarted-session');
    expect(sendCommand('restarted-session').statusCode).toBe(200);
    expect(result.payload.commands).toHaveLength(1);
    expect(result.payload.commands[0].type).toBe('setFreq');
  });

  it('keeps an idle session alive while its bridge keeps long-polling past the TTL', () => {
    pushState('idle-rig');
    // An hour and a half of empty long-polls, no state pushes (rig unchanged).
    for (let elapsed = 0; elapsed < TTL * 1.5; elapsed += LONG_POLL_WAIT) {
      const result = poll('idle-rig');
      vi.advanceTimersByTime(LONG_POLL_WAIT);
      expect(result.payload).toEqual({ commands: [] });
    }
    vi.advanceTimersByTime(CLEANUP_INTERVAL);

    // The session survived: a command is accepted and handed to the next poll.
    const pending = poll('idle-rig');
    expect(sendCommand('idle-rig').statusCode).toBe(200);
    expect(pending.payload.commands).toHaveLength(1);
  });

  it('still answers a non-waiting poll for an unknown session immediately', () => {
    const result = call(routes['GET /api/rig-bridge/relay/commands'], { query: { session: 'legacy' } });
    expect(result.payload).toEqual({ commands: [] });
  });
});
