'use strict';

/**
 * Fletcher relay-health verdict (#1165 follow-up).
 *
 * The original probe marked fletcher degraded whenever the newest relay
 * outcome was an error inside a 10-minute window. Fletcher is a passive
 * relay with no background refresh, so after ONE transient upstream
 * timeout there is often no follow-up fetch to clear the error — health
 * sat degraded until the window expired, and watchtower paged Discord on
 * both flips. One failed HTTP request bought two pings, every time.
 *
 * Now a relay error only degrades health once fletcher reports at least
 * CONSECUTIVE_FAILS_THRESHOLD consecutive failures. A genuinely blocked
 * upstream (the v26.6.0 release-day serial 403s) still trips immediately
 * as retries stack up; a lone blip reports ok with the blip noted in the
 * detail string so the information isn't lost, it just doesn't page.
 */

const RELAY_ERROR_WINDOW_MS = 10 * 60 * 1000;
const CONSECUTIVE_FAILS_THRESHOLD = 2;

/**
 * @param {object} s parsed fletcher /stats JSON
 * @param {number} nowMs current time
 * @returns {{status: 'ok'|'degraded', detail: string}}
 */
function classifyFletcherRelays(s, nowMs) {
  const errAt = typeof s.lastUpstreamErrorAt === 'number' ? s.lastUpstreamErrorAt : 0;
  const okAt = typeof s.lastUpstreamOkAt === 'number' ? s.lastUpstreamOkAt : 0;
  const errorIsCurrent = errAt > okAt && nowMs - errAt < RELAY_ERROR_WINDOW_MS;
  if (!errorIsCurrent) return { status: 'ok', detail: 'relays ok' };

  const secs = Math.round((nowMs - errAt) / 1000);
  const statusText = s.lastUpstreamStatus === 0 ? 'no response' : `HTTP ${s.lastUpstreamStatus}`;
  // Older fletcher builds don't report the counter. Treat missing as a
  // single blip: during a mixed-version deploy window we'd rather
  // under-page than reintroduce the two-pings-per-blip noise, and
  // satellite data serves stale through relay trouble regardless.
  let fails = typeof s.consecutiveUpstreamFails === 'number' ? s.consecutiveUpstreamFails : 1;
  // Newer fletcher builds count per upstream. SatNOGS only serves radio
  // metadata (the daily transmitter walk), and it throttles bursts; that
  // never puts satellite tracking at risk, so it must not page. Judge
  // degraded on the orbital-data upstreams (CelesTrak, AMSAT) only.
  const byUpstream = s.consecutiveFailsByUpstream;
  if (byUpstream && typeof byUpstream === 'object') {
    const orbital = Object.entries(byUpstream).filter(([name]) => name !== 'satnogs');
    fails = orbital.reduce((m, [, n]) => Math.max(m, Number(n) || 0), 0);
    const satnogs = Number(byUpstream.satnogs) || 0;
    if (fails < CONSECUTIVE_FAILS_THRESHOLD && satnogs >= CONSECUTIVE_FAILS_THRESHOLD) {
      return {
        status: 'ok',
        detail: `ok (SatNOGS throttling the metadata walk, ${satnogs} consecutive — tracking unaffected)`,
      };
    }
  }
  if (fails >= CONSECUTIVE_FAILS_THRESHOLD) {
    return {
      status: 'degraded',
      detail: `alive but relays failing (${statusText}, ${fails} consecutive, last error ${secs}s ago)`,
    };
  }
  return { status: 'ok', detail: `ok (1 transient relay error ${secs}s ago, ${statusText})` };
}

module.exports = { classifyFletcherRelays, RELAY_ERROR_WINDOW_MS, CONSECUTIVE_FAILS_THRESHOLD };
