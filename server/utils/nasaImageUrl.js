'use strict';
/**
 * Validate an image URL handed back by a NASA API (Dial-A-Moon) before the
 * server proxies it, and normalise it to https.
 *
 * Dial-A-Moon started returning plain `http://svs.gsfc.nasa.gov/...` image
 * URLs in October 2026; an https-only check rejected every one of them and
 * the moon vanished from the Lunar panel and the 3D globe. Either scheme is
 * accepted for a *.nasa.gov host, and the fetch always goes over https.
 *
 * @param {unknown} url
 * @returns {string|null} the https URL to fetch, or null when it is not a NASA image URL
 */
function toNasaHttpsUrl(url) {
  if (typeof url !== 'string' || !url) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (parsed.username || parsed.password) return null;
  const host = parsed.hostname.toLowerCase();
  if (host !== 'nasa.gov' && !host.endsWith('.nasa.gov')) return null;
  parsed.protocol = 'https:';
  return parsed.toString();
}

module.exports = { toNasaHttpsUrl };
