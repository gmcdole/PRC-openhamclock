/**
 * useWinlink — Vitest + React 18
 *
 * The panel shows "Loading..." while `loading` is true. It must clear when
 * /api/winlink/status fails (404/5xx) or apiFetch returns null (shared 429
 * backoff) — not only on success — or the Winlink panel never leaves
 * "Loading...".
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

const api = vi.hoisted(() => ({ fetch: null }));
vi.mock('../utils/apiFetch', () => ({
  apiFetch: (...args) => api.fetch(...args),
}));

import { useWinlink } from './useWinlink.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root;
let container;
let latest;

function Harness() {
  latest = useWinlink();
  return null;
}

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<Harness />);
  });
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('useWinlink loading state', () => {
  it('stops loading when the status endpoint returns an error', async () => {
    api.fetch = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }));
    await mount();
    expect(latest.loading).toBe(false);
    expect(latest.status).toEqual({ enabled: false, running: false });
  });

  it('stops loading when apiFetch is backed off (returns null)', async () => {
    api.fetch = vi.fn(async () => null);
    await mount();
    expect(latest.loading).toBe(false);
  });

  it('stores the status and stops loading on success', async () => {
    api.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ enabled: true, running: true, patEnabled: false }),
    }));
    await mount();
    expect(latest.loading).toBe(false);
    expect(latest.status).toMatchObject({ enabled: true, running: true });
  });
});
