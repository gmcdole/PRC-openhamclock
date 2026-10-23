import { describe, it, expect } from 'vitest';
import { relayTokenFor, isValidRelayToken, pickEvictableSession } from './wsjtxRelayToken.js';

const KEY = 'relay-openhamclock-2026';

describe('relayTokenFor / isValidRelayToken', () => {
  it('derives a 64-hex token that is stable per session', () => {
    const t = relayTokenFor(KEY, 'abcd1234');
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    expect(relayTokenFor(KEY, 'abcd1234')).toBe(t);
    expect(relayTokenFor(KEY, 'abcd1235')).not.toBe(t);
  });

  it('accepts the token only for its own session', () => {
    const t = relayTokenFor(KEY, 'abcd1234');
    expect(isValidRelayToken(KEY, 'abcd1234', t)).toBe(true);
    expect(isValidRelayToken(KEY, 'zzzz9999', t)).toBe(false);
  });

  it('no longer accepts the server-wide key itself', () => {
    expect(isValidRelayToken(KEY, 'abcd1234', KEY)).toBe(false);
  });

  it('rejects tokens minted with another key (key rotation)', () => {
    expect(isValidRelayToken('rotated-key', 'abcd1234', relayTokenFor(KEY, 'abcd1234'))).toBe(false);
  });

  it('rejects missing or malformed input', () => {
    const t = relayTokenFor(KEY, 'abcd1234');
    expect(isValidRelayToken('', 'abcd1234', t)).toBe(false);
    expect(isValidRelayToken(KEY, '', t)).toBe(false);
    expect(isValidRelayToken(KEY, 'abcd1234', undefined)).toBe(false);
    expect(isValidRelayToken(KEY, 'abcd1234', t.toUpperCase())).toBe(false);
    expect(isValidRelayToken(KEY, 'abcd1234', t.slice(0, 63))).toBe(false);
  });
});

describe('pickEvictableSession', () => {
  const IDLE = 10 * 60 * 1000;
  const now = 1_000_000_000;

  it('evicts the oldest session once it has been idle long enough', () => {
    const sessions = { a: { lastAccess: now - IDLE - 1 }, b: { lastAccess: now - 1000 } };
    expect(pickEvictableSession(sessions, now, IDLE)).toBe('a');
  });

  it('refuses to evict when every session is still active', () => {
    const sessions = { a: { lastAccess: now - 60_000 }, b: { lastAccess: now - 1000 } };
    expect(pickEvictableSession(sessions, now, IDLE)).toBe(null);
  });

  it('returns null for an empty store', () => {
    expect(pickEvictableSession({}, now, IDLE)).toBe(null);
  });
});
