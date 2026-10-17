/**
 * relay-sign — Cloud Relay command signatures as Rig Bridge checks them:
 * valid commands pass once; tampering, wrong session, stale or replayed
 * commands and a missing key are refused.
 */
import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import lib from './relay-sign.js';

describe('relay read token', () => {
  const K = 'a'.repeat(64);
  const S = 'f00dbabe12345678';
  it('is HKDF-SHA256 of the key with a session-bound label, and only its hash is shared', () => {
    const t = lib.deriveReadToken(K, S);
    const info = Buffer.from(`ohc-relay-read-v1\n${S}`);
    const expected = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(K, 'hex'), Buffer.alloc(0), info, 32));
    expect(t).toBe(expected.toString('hex'));
    expect(lib.deriveReadToken(K, 'othersession0000')).not.toBe(t);
    expect(lib.deriveReadToken('', S)).toBe('');
    expect(lib.readTokenHash(t)).toBe(crypto.createHash('sha256').update(Buffer.from(t, 'hex')).digest('hex'));
  });
});

const { canonicalJson, signCommand, createCommandVerifier, isValidKey, MAX_SKEW_MS } = lib;

const KEY = 'a'.repeat(64);
const SESSION = 'f00dbabe12345678';

const make = (opts = {}) => {
  let t = 1_800_000_000_000;
  const v = createCommandVerifier({
    key: () => opts.key ?? KEY,
    session: () => opts.session ?? SESSION,
    now: () => t,
  });
  return { v, at: (ms) => (t = ms), now: () => t };
};

const cmd = (type, payload, auth) => ({ type, payload, auth });

describe('canonicalJson', () => {
  it('sorts keys at every level and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: 'x' }, u: undefined })).toBe(
      '{"a":{"c":"x","d":[1,{"y":2,"z":1}]},"b":1}',
    );
    expect(canonicalJson(undefined)).toBe('null');
  });
});

describe('createCommandVerifier', () => {
  it('accepts a correctly signed command once, then refuses the replay', () => {
    const { v, now } = make();
    const payload = { freq: 14074000, tune: true };
    const auth = signCommand(KEY, SESSION, 'setFreq', payload, { ts: now() });
    expect(v.verify(cmd('setFreq', { tune: true, freq: 14074000 }, auth))).toEqual({ ok: true }); // key order irrelevant
    expect(v.verify(cmd('setFreq', payload, auth))).toEqual({ ok: false, reason: 'replayed' });
  });

  it('refuses tampering with type, payload, session or key', () => {
    const { v, now } = make();
    const auth = signCommand(KEY, SESSION, 'setFreq', { freq: 1 }, { ts: now() });
    expect(v.verify(cmd('setPTT', { freq: 1 }, auth)).reason).toBe('bad-signature');
    expect(v.verify(cmd('setFreq', { freq: 2 }, auth)).reason).toBe('bad-signature');
    const other = make({ session: 'deadbeef00000000' });
    expect(other.v.verify(cmd('setFreq', { freq: 1 }, auth)).reason).toBe('bad-signature');
    const wrongKey = signCommand('b'.repeat(64), SESSION, 'setFreq', { freq: 1 }, { ts: now() });
    expect(v.verify(cmd('setFreq', { freq: 1 }, wrongKey)).reason).toBe('bad-signature');
  });

  it('refuses commands outside the clock window', () => {
    const { v, now } = make();
    const old = signCommand(KEY, SESSION, 'setFreq', {}, { ts: now() - MAX_SKEW_MS - 1 });
    expect(v.verify(cmd('setFreq', {}, old)).reason).toBe('expired');
    const future = signCommand(KEY, SESSION, 'setFreq', {}, { ts: now() + MAX_SKEW_MS + 1 });
    expect(v.verify(cmd('setFreq', {}, future)).reason).toBe('expired');
  });

  it('reports unsigned, malformed and not-paired', () => {
    const { v, now } = make();
    expect(v.verify(cmd('setFreq', {})).reason).toBe('unsigned');
    expect(v.verify(cmd('setFreq', {}, { v: 1, ts: now(), nonce: 'xyz', sig: 'q' })).reason).toBe('malformed');
    const unpaired = make({ key: '' });
    expect(unpaired.v.verify(cmd('setFreq', {}, signCommand(KEY, SESSION, 'setFreq', {}))).reason).toBe('not-paired');
    expect(isValidKey(KEY)).toBe(true);
    expect(isValidKey('A'.repeat(64))).toBe(false);
    expect(isValidKey('abc')).toBe(false);
  });
});
