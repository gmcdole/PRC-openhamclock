/**
 * Tests for server/routes/aprs.js — APRS telemetry store.
 *
 * Regression: the telemetryData / telemetryDefs maps and their size limits
 * were lost in a refactor while every use survived, so each T# frame threw a
 * ReferenceError (swallowed by parseAprsTelemetry's try/catch) and
 * GET /api/aprs/telemetry 500'd. Caught by ESLint no-undef.
 *
 * The route module is mounted on a minimal fake Express app; handlers are
 * invoked directly with stub req/res objects. No network: APRS_ENABLED is
 * unset, so no APRS-IS socket is opened.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const mountAprs = require('./aprs.js');

function makeApp() {
  const routes = {};
  const register =
    (method) =>
    (path, ...handlers) => {
      routes[`${method} ${path}`] = handlers[handlers.length - 1];
    };
  return { routes, get: register('GET'), post: register('POST') };
}

function call(handler, { body = {}, query = {} } = {}) {
  let statusCode = 200;
  let payload;
  const res = {
    status(code) {
      statusCode = code;
      return res;
    },
    json(data) {
      payload = data;
      return res;
    },
  };
  handler({ body, query }, res);
  return { statusCode, payload };
}

describe('APRS telemetry', () => {
  let app;

  beforeAll(() => {
    // The module starts a cleanup setInterval on mount; keep it off the real clock.
    vi.useFakeTimers();
    app = makeApp();
    const noop = () => {};
    mountAprs(app, {
      CONFIG: {},
      APP_VERSION: 'test',
      logDebug: noop,
      logInfo: noop,
      logWarn: noop,
      logErrorOnce: noop,
    });
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it('stores T# frames from a local TNC and serves them with PARM labels', () => {
    const local = app.routes['POST /api/aprs/local'];
    const telemetry = app.routes['GET /api/aprs/telemetry'];

    const post = call(local, {
      body: {
        packets: [
          { source: 'N0CALL-11', destination: 'APRS', info: 'T#005,199,000,255,073,123,01101001' },
          { source: 'N0CALL-11', destination: 'APRS', info: ':N0CALL-11:PARM.Battery,Btemp,ATemp,Pres,Alt' },
        ],
      },
    });
    expect(post.statusCode).toBe(200);

    const one = call(telemetry, { query: { callsign: 'n0call' } });
    expect(one.statusCode).toBe(200);
    expect(one.payload).toMatchObject({
      call: 'N0CALL',
      seq: '005',
      values: [199, 0, 255, 73, 123],
      bits: '01101001',
      source: 'local-tnc',
      params: ['Battery', 'Btemp', 'ATemp', 'Pres', 'Alt'],
    });
    expect(one.payload.history).toHaveLength(1);

    const all = call(telemetry);
    expect(all.payload.count).toBe(1);
  });

  it('reports unknown callsigns instead of throwing', () => {
    const telemetry = app.routes['GET /api/aprs/telemetry'];
    const res = call(telemetry, { query: { callsign: 'NOBODY' } });
    expect(res.payload).toEqual({ error: 'No telemetry for this callsign' });
  });
});

describe('POST /api/aprs/message recordOnly (#1243)', () => {
  it('records a message the browser already transmitted, without contacting rig-bridge', () => {
    vi.useFakeTimers();
    const app = makeApp();
    const noop = () => {};
    const fetch = vi.fn();
    mountAprs(app, {
      CONFIG: { callsign: 'k0cjh' },
      APP_VERSION: 'test',
      logDebug: noop,
      logInfo: noop,
      logWarn: noop,
      logErrorOnce: noop,
      fetch,
    });
    let out;
    app.routes['POST /api/aprs/message'](
      { body: { to: 'n8tag', message: 'hi', recordOnly: true } },
      {
        status() {
          return this;
        },
        json(d) {
          out = d;
        },
      },
    );
    expect(out).toEqual({ ok: true, recorded: true });
    expect(fetch).not.toHaveBeenCalled();
    const hist = call(app.routes['GET /api/aprs/messages/history'], { query: { call: 'N8TAG' } }).payload;
    expect(hist.messages[0]).toMatchObject({ from: 'K0CJH', to: 'N8TAG', text: 'hi', direction: 'sent' });
    vi.useRealTimers();
  });
});
