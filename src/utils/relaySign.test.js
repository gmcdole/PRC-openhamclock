/**
 * relaySign (browser) — SHA-256 / HMAC against published test vectors, and a
 * browser-signed command verified by Rig Bridge's own verifier, with Web
 * Crypto and with the pure-JS fallback.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';
import {
  canonicalJson,
  sha256,
  hmacSha256Fallback,
  hmacHex,
  generateCommandKey,
  getCommandKey,
  setCommandKey,
  signRelayCommand,
  sendRelayCommand,
  deriveReadToken,
  relayReadHeaders,
  relayStreamUrl,
} from './relaySign.js';

const bridge = createRequire(import.meta.url)('../../rig-bridge/lib/relay-sign.js');

describe('relay read token (browser)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('matches Rig Bridge’s derivation, with Web Crypto and with the fallback', async () => {
    const key = generateCommandKey();
    const viaSubtle = await deriveReadToken(key, 'sess0001');
    expect(viaSubtle).toBe(bridge.deriveReadToken(key, 'sess0001'));
    vi.stubGlobal('crypto', { subtle: undefined, getRandomValues: () => {} });
    try {
      expect(await deriveReadToken(key, 'sess0001')).toBe(viaSubtle);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('buys a one-time stream ticket with the read token; no secret in the URL', async () => {
    const key = generateCommandKey();
    setCommandKey(key);
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ticket: 'abc123' }) }));
    vi.stubGlobal('fetch', fetchMock);
    const { url } = await relayStreamUrl('sess0002');
    expect(url).toBe('/api/rig-bridge/relay/stream?session=sess0002&ticket=abc123');
    const [ticketUrl, opts] = fetchMock.mock.calls[0];
    expect(ticketUrl).toBe('/api/rig-bridge/relay/stream-ticket?session=sess0002');
    expect(opts.headers['X-Relay-Read']).toBe(bridge.deriveReadToken(key, 'sess0002'));
    expect(url).not.toContain(opts.headers['X-Relay-Read']);
    expect(await relayReadHeaders('sess0002')).toEqual({ 'X-Relay-Read': bridge.deriveReadToken(key, 'sess0002') });
  });

  it('without a key uses the plain stream URL and sends no read header', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await relayStreamUrl('sess0003')).toEqual({ url: '/api/rig-bridge/relay/stream?session=sess0003' });
    expect(await relayReadHeaders('sess0003')).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a refused ticket', async () => {
    setCommandKey(generateCommandKey());
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })),
    );
    expect(await relayStreamUrl('sess0004')).toMatchObject({ url: null, status: 401 });
  });
});

const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
const bytes = (s) => new TextEncoder().encode(s);

describe('SHA-256 / HMAC fallback', () => {
  it('matches FIPS 180-4 vectors', () => {
    expect(hex(sha256(bytes('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hex(sha256(bytes('')))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(hex(sha256(bytes('a'.repeat(1000))))).toBe(
      '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3',
    );
  });

  it('matches RFC 4231 test case 2', () => {
    expect(hex(hmacSha256Fallback(bytes('Jefe'), bytes('what do ya want for nothing?')))).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
  });
});

describe('browser ↔ Rig Bridge agreement', () => {
  const KEY = generateCommandKey();
  const SESSION = 'f00dbabe12345678';

  it('canonical JSON is identical on both sides', () => {
    for (const v of [
      { b: 1, a: [{ y: 1, x: 'é' }] },
      null,
      { tune: true, freq: 7074000 },
      { body: { text: 'a\nb' } },
    ]) {
      expect(canonicalJson(v)).toBe(bridge.canonicalJson(v));
    }
  });

  it('a browser-signed command passes the bridge verifier (Web Crypto)', async () => {
    const payload = { action: 'send', body: { text: 'QST de KE8PLM' } };
    const auth = await signRelayCommand(SESSION, 'fldigi', payload, { key: KEY });
    const v = bridge.createCommandVerifier({ key: () => KEY, session: () => SESSION });
    expect(v.verify({ type: 'fldigi', payload, auth })).toEqual({ ok: true });
  });

  it('the pure-JS fallback produces the same signature', async () => {
    const text = bridge.signedText(SESSION, 1, 'abcdefabcdefabcdef', 'setPTT', { ptt: true });
    const viaSubtle = await hmacHex(KEY, text);
    const subtle = globalThis.crypto.subtle;
    vi.stubGlobal('crypto', { getRandomValues: (b) => globalThis.crypto?.getRandomValues?.(b), subtle: undefined });
    try {
      expect(await hmacHex(KEY, text)).toBe(viaSubtle);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(globalThis.crypto.subtle).toBe(subtle);
    expect(viaSubtle).toBe(bridge.hmacHex(KEY, text));
  });
});

describe('key storage and sending', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('stores only well-formed keys', () => {
    expect(getCommandKey()).toBe('');
    const k = generateCommandKey();
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    setCommandKey(k);
    expect(getCommandKey()).toBe(k);
    setCommandKey('nope');
    expect(getCommandKey()).toBe('');
  });

  it('sends signed commands when a key is held, plain ones otherwise', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await sendRelayCommand('sess0001', 'setFreq', { freq: 7074000 })).toMatchObject({ ok: true, signed: false });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ type: 'setFreq', payload: { freq: 7074000 } });

    const k = generateCommandKey();
    setCommandKey(k);
    expect(await sendRelayCommand('sess0001', 'setFreq', { freq: 7074000 })).toMatchObject({ ok: true, signed: true });
    const sent = JSON.parse(fetchMock.mock.calls[1][1].body);
    const v = bridge.createCommandVerifier({ key: () => k, session: () => 'sess0001' });
    expect(v.verify(sent)).toEqual({ ok: true });
  });

  it('reports the server’s refusal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Rig Bridge requires signed commands' }),
      })),
    );
    expect(await sendRelayCommand('sess0001', 'setPTT', { ptt: true })).toMatchObject({
      ok: false,
      status: 401,
      error: 'Rig Bridge requires signed commands',
    });
  });
});
