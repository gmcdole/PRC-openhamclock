/**
 * Tests for aprsMessageSend — the shared client path to POST /api/aprs/message.
 */
import { describe, it, expect, vi } from 'vitest';
import { sendAprsMessage, directRigUrl } from './aprsMessageSend.js';

const okRes = () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
const errRes = (status, error) => ({ ok: false, status, json: async () => ({ error }) });

describe('sendAprsMessage', () => {
  it('posts the addressee (upper-cased) and text to the server', async () => {
    const fetchImpl = vi.fn(async () => okRes());
    const r = await sendAprsMessage({ to: 'ke8plm-9', message: ' Hello ' }, fetchImpl);
    expect(r).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/aprs/message');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ to: 'KE8PLM-9', message: 'Hello' });
  });

  it('refuses blank or over-length messages without calling the server', async () => {
    const fetchImpl = vi.fn(async () => okRes());
    expect((await sendAprsMessage({ to: '', message: 'x' }, fetchImpl)).ok).toBe(false);
    expect((await sendAprsMessage({ to: 'K0CJH', message: '  ' }, fetchImpl)).ok).toBe(false);
    expect((await sendAprsMessage({ to: 'K0CJH', message: 'x'.repeat(68) }, fetchImpl)).ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('surfaces the server error (e.g. no TNC) and network failures', async () => {
    const noTnc = vi.fn(async () => errRes(503, 'APRS TNC not available'));
    expect(await sendAprsMessage({ to: 'K0CJH', message: 'hi' }, noTnc)).toEqual({
      ok: false,
      error: 'APRS TNC not available',
    });
    const offline = vi.fn(async () => {
      throw new Error('Failed to fetch');
    });
    expect(await sendAprsMessage({ to: 'K0CJH', message: 'hi' }, offline)).toEqual({
      ok: false,
      error: 'Failed to fetch',
    });
  });
});

describe('direct Rig Bridge path (#1243)', () => {
  it('directRigUrl: only when this browser reaches the bridge itself', () => {
    expect(directRigUrl({ enabled: true, isCloudRelay: false, rigUrl: 'http://localhost:5556/' })).toBe(
      'http://localhost:5556',
    );
    expect(directRigUrl({ enabled: true, isCloudRelay: true, rigUrl: 'http://localhost:5556' })).toBeNull();
    expect(directRigUrl({ enabled: false, rigUrl: 'http://localhost:5556' })).toBeNull();
    expect(directRigUrl(null)).toBeNull();
  });

  it('transmits through the bridge, then records our side on the server', async () => {
    const fetchImpl = vi.fn(async () => okRes());
    const r = await sendAprsMessage({ to: 'n8tag', message: 'hi', rigUrl: 'http://192.168.1.50:5556' }, fetchImpl);
    expect(r).toEqual({ ok: true });
    expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual([
      'http://192.168.1.50:5556/aprs/message',
      '/api/aprs/message',
    ]);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ to: 'N8TAG', message: 'hi' });
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({ to: 'N8TAG', message: 'hi', recordOnly: true });
  });

  it('reports the bridge error and does not record anything', async () => {
    const fetchImpl = vi.fn(async () => errRes(503, 'TNC not connected'));
    const r = await sendAprsMessage({ to: 'N8TAG', message: 'hi', rigUrl: 'http://localhost:5556' }, fetchImpl);
    expect(r).toEqual({ ok: false, error: 'Rig Bridge: TNC not connected' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('says where it looked when the bridge is unreachable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const r = await sendAprsMessage({ to: 'N8TAG', message: 'hi', rigUrl: 'http://localhost:5556' }, fetchImpl);
    expect(r.error).toBe('Rig Bridge not reachable at http://localhost:5556');
  });
});
