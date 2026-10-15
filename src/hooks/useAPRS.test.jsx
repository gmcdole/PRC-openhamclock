/**
 * useAPRS — RF frames from the rig-bridge SSE are forwarded to the server
 * (#1212). In local mode the TNC feed reaches only the browser; messages,
 * telemetry and net check-ins heard over the air must still get to
 * /api/aprs/local so the Net Roster sees them. Rendered with createRoot/act
 * (same pattern as useWSJTX.test.jsx).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

const api = vi.hoisted(() => ({ fetch: null }));
vi.mock('../utils/apiFetch', () => ({
  apiFetch: (...args) => api.fetch(...args),
}));

import { useAPRS } from './useAPRS.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root;
let container;
let latest;

function Harness() {
  latest = useAPRS({ enabled: true });
  return null;
}

const sse = (detail) => {
  act(() => {
    window.dispatchEvent(new CustomEvent('rig-plugin-data', { detail }));
  });
};

const advance = async (ms) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const localPosts = () =>
  api.fetch.mock.calls.filter(([url, opts]) => url === '/api/aprs/local' && opts?.method === 'POST');

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  api.fetch = vi.fn(async (url) => ({
    ok: true,
    status: 200,
    json: async () =>
      url.startsWith('/api/aprs/stations')
        ? { enabled: false, tncActive: false, stations: [] }
        : { connected: false, tncActive: false },
  }));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<Harness />);
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('useAPRS RF forwarding', () => {
  it('posts every RF frame to /api/aprs/local in one batch, positions and messages alike', async () => {
    const ts = Date.now();
    sse({
      event: 'aprs',
      data: {
        source: 'KE8PLM-9',
        destination: 'APDW18',
        info: '!4130.00N/08142.00W>Mobile',
        lat: 41.5,
        lon: -81.7,
        ssid: 'KE8PLM-9',
        call: 'KE8PLM',
        timestamp: ts,
      },
    });
    sse({
      event: 'aprs',
      data: { source: 'KE8PLM-9', destination: 'APDW18', info: ':EMCOMM   :CQ TESTNET at the EOC', timestamp: ts },
    });
    expect(localPosts()).toHaveLength(0); // debounced
    await advance(1100);
    const posts = localPosts();
    expect(posts).toHaveLength(1);
    const body = JSON.parse(posts[0][1].body);
    expect(body.packets.map((p) => p.info)).toEqual(['!4130.00N/08142.00W>Mobile', ':EMCOMM   :CQ TESTNET at the EOC']);
    expect(body.packets[1]).toMatchObject({ source: 'KE8PLM-9', destination: 'APDW18', timestamp: ts });
  });

  it('keeps only position frames in the RF station store', async () => {
    sse({
      event: 'aprs',
      data: { source: 'KE8PLM-9', destination: 'APDW18', info: ':EMCOMM   :CQ TESTNET', timestamp: Date.now() },
    });
    sse({
      event: 'aprs',
      data: {
        source: 'W8ABC-7',
        destination: 'APDW18',
        info: '!4130.00N/08142.00W>',
        lat: 41.5,
        lon: -81.7,
        ssid: 'W8ABC-7',
        call: 'W8ABC',
        timestamp: Date.now(),
      },
    });
    await advance(1100);
    expect(latest.stations.map((s) => s.ssid)).toEqual(['W8ABC-7']);
    expect(latest.hasRFStations).toBe(true);
  });

  it('ignores frames without the raw fields and never throws on a failed post', async () => {
    api.fetch.mockImplementation(async (url, opts) => {
      if (url === '/api/aprs/local' && opts?.method === 'POST') throw new Error('server down');
      return { ok: true, status: 200, json: async () => ({ enabled: false, tncActive: false, stations: [] }) };
    });
    sse({ event: 'aprs', data: { lat: 1, lon: 2, ssid: 'NOINFO' } }); // no source/info → not forwarded
    sse({ event: 'aprs', data: { source: 'X1X', destination: 'APRS', info: '>status', timestamp: Date.now() } });
    await advance(1100);
    expect(localPosts()).toHaveLength(1);
    expect(JSON.parse(localPosts()[0][1].body).packets).toHaveLength(1);
  });
});
