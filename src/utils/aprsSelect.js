/**
 * aprsSelect — "show this station in the APRS list" request bus (#1210).
 *
 * The map dispatches a window event when an APRS marker is clicked; whichever
 * APRS panel is mounted answers by scrolling the matching row into view and
 * highlighting it for a moment. Mirrors the shape of utils/mapFocus.js.
 */

export const APRS_SELECT_EVENT = 'ohc-aprs-select';
/** Map popup → "show me this station's message history" (#1216). */
export const APRS_HISTORY_EVENT = 'ohc-aprs-history';

/** Highlight lifetime, ms. */
export const APRS_SELECT_HIGHLIGHT_MS = 4000;

/**
 * Ask the APRS panel to bring a station's row into view.
 * @param {{ssid?: string, call?: string}} station
 * @returns {boolean} false when the request was dropped (no identity / no window)
 */
export function requestAprsHistory(call) {
  if (typeof window === 'undefined') return false;
  const key = String(call || '').trim();
  if (!key) return false;
  window.dispatchEvent(new CustomEvent(APRS_HISTORY_EVENT, { detail: { call: key } }));
  return true;
}

export function requestAprsSelect({ ssid, call } = {}) {
  if (typeof window === 'undefined') return false;
  const key = String(ssid || call || '').trim();
  if (!key) return false;
  window.dispatchEvent(new CustomEvent(APRS_SELECT_EVENT, { detail: { key } }));
  return true;
}
