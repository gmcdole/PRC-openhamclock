import { describe, it, expect, vi } from 'vitest';
import { fetchFreshestImage, parseLastModified } from './solarImageFreshness.js';

const H = 60 * 60 * 1000;
const NOW = Date.parse('2026-10-08T17:00:00Z');
const img = (source, ageMs) => ({
  buffer: Buffer.from(source),
  contentType: 'image/jpeg',
  source,
  lastModified: ageMs == null ? null : NOW - ageMs,
});
const src = (name, result) => ({
  name,
  fn: result instanceof Error ? () => Promise.reject(result) : () => Promise.resolve(result),
});
const opts = (extra = {}) => ({ maxAge: 3 * H, now: () => NOW, ...extra });

describe('parseLastModified', () => {
  it('parses an HTTP date', () => {
    expect(parseLastModified('Mon, 21 Sep 2026 15:43:10 GMT')).toBe(Date.parse('2026-09-21T15:43:10Z'));
  });
  it('returns null for missing or garbage headers', () => {
    expect(parseLastModified(null)).toBeNull();
    expect(parseLastModified('')).toBeNull();
    expect(parseLastModified('not a date')).toBeNull();
  });
});

describe('fetchFreshestImage', () => {
  it('takes the first fresh source', async () => {
    const r = await fetchFreshestImage([src('SDO', img('SDO', 10 * 60 * 1000)), src('LMSAL', img('LMSAL', 0))], opts());
    expect(r.source).toBe('SDO');
    expect(r.stale).toBe(false);
  });

  it('skips a stale primary that still answers 200 and uses the fresh fallback (the Sept-2026 NASA freeze)', async () => {
    const onStale = vi.fn();
    const r = await fetchFreshestImage(
      [src('SDO', img('SDO', 17 * 24 * H)), src('LMSAL', img('LMSAL', 5 * 60 * 1000))],
      opts({ onStale }),
    );
    expect(r.source).toBe('LMSAL');
    expect(r.stale).toBe(false);
    expect(onStale).toHaveBeenCalledWith('SDO', NOW - 17 * 24 * H);
  });

  it('skips failing sources and keeps going', async () => {
    const onFail = vi.fn();
    const r = await fetchFreshestImage(
      [src('SDO', new Error('timeout')), src('LMSAL', img('LMSAL', 0))],
      opts({ onFail }),
    );
    expect(r.source).toBe('LMSAL');
    expect(onFail).toHaveBeenCalledTimes(1);
  });

  it('treats a missing Last-Modified as fresh (Helioviewer renders on demand)', async () => {
    const r = await fetchFreshestImage(
      [src('SDO', img('SDO', 30 * 24 * H)), src('Helioviewer', img('Helioviewer', null))],
      opts(),
    );
    expect(r.source).toBe('Helioviewer');
    expect(r.stale).toBe(false);
  });

  it('serves the freshest stale image when nothing fresh is available', async () => {
    const r = await fetchFreshestImage(
      [src('SDO', img('SDO', 17 * 24 * H)), src('LMSAL', img('LMSAL', 5 * H)), src('SOHO', new Error('HTTP 503'))],
      opts(),
    );
    expect(r.source).toBe('LMSAL');
    expect(r.stale).toBe(true);
  });

  it('throws when every source fails', async () => {
    await expect(
      fetchFreshestImage([src('SDO', new Error('x')), src('LMSAL', new Error('y'))], opts()),
    ).rejects.toThrow('All solar image sources failed');
  });

  it('accepts an image exactly at the age limit', async () => {
    const r = await fetchFreshestImage([src('SDO', img('SDO', 3 * H))], opts());
    expect(r.stale).toBe(false);
  });
});
