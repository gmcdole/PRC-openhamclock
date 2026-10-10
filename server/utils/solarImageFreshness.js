/**
 * Solar image source chain with a freshness gate.
 *
 * NASA's /assets/img/latest/ symlinks froze on 2026-09-21 while still
 * answering HTTP 200, so a plain "first source that responds wins" chain
 * served a 17-day-old sun for weeks. Each source reports the image's
 * Last-Modified; anything older than maxAge is set aside and the chain keeps
 * going. If every source is stale (or only stale ones answered), the freshest
 * stale image is still served — an old sun beats a broken panel.
 */

const DEFAULT_MAX_AGE = 3 * 60 * 60 * 1000; // SDO/LMSAL refresh every ~15 min

function parseLastModified(header) {
  if (!header) return null;
  const t = Date.parse(header);
  return Number.isFinite(t) ? t : null;
}

/**
 * @param {Array<{name: string, fn: () => Promise<{buffer, contentType, source, lastModified?: number|null}>}>} sources
 * @param {{maxAge?: number, now?: () => number, onFail?: Function, onStale?: Function}} opts
 */
async function fetchFreshestImage(sources, { maxAge = DEFAULT_MAX_AGE, now = Date.now, onFail, onStale } = {}) {
  let staleBest = null;
  for (const src of sources) {
    let result;
    try {
      result = await src.fn();
    } catch (e) {
      onFail?.(src.name, e);
      continue;
    }
    const lm = result.lastModified;
    // No Last-Modified (e.g. Helioviewer renders on demand) counts as fresh.
    if (lm != null && now() - lm > maxAge) {
      onStale?.(src.name, lm);
      if (!staleBest || lm > staleBest.lastModified) staleBest = result;
      continue;
    }
    return { ...result, stale: false };
  }
  if (staleBest) return { ...staleBest, stale: true };
  throw new Error('All solar image sources failed');
}

module.exports = { DEFAULT_MAX_AGE, parseLastModified, fetchFreshestImage };
