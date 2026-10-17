'use strict';
/**
 * relay-timing.js — pacing decisions for the Cloud Relay plugin (CommonJS)
 *
 * Kept separate from plugins/cloud-relay.js so the decisions can be unit
 * tested without a network.
 *
 * Long-poll pacing: a healthy long-poll is held by the server for up to the
 * wait window, so re-polling at once is fine. An empty 200 that returns
 * almost instantly means the server did not hold it (an older server does
 * this for a session it has forgotten); re-polling at once would spin at
 * network speed and exhaust the server's per-IP rate limit.
 *
 * Heartbeat: state is pushed only when it changes, but the server forgets
 * sessions on restart and after an idle TTL. A periodic push of unchanged
 * state re-registers the session and its current rig state.
 */

const FAST_EMPTY_POLL_MS = 1000; // an empty 200 faster than this was not held
const FAST_EMPTY_POLL_BACKOFF_MS = 1000;
const ERROR_BACKOFF_MS = 1000;
const HEARTBEAT_MS = 30000;

/**
 * Delay before the next long-poll attempt.
 * @param {{ ok: boolean, elapsedMs: number, commandCount: number }} result
 *   ok: the poll returned HTTP 200; elapsedMs: how long the request took;
 *   commandCount: commands delivered by it.
 * @returns {number} milliseconds to wait (0 = re-poll now)
 */
function nextLongPollDelay({ ok, elapsedMs, commandCount }) {
  if (!ok) return ERROR_BACKOFF_MS;
  if (commandCount > 0) return 0;
  return elapsedMs < FAST_EMPTY_POLL_MS ? FAST_EMPTY_POLL_BACKOFF_MS : 0;
}

/**
 * Whether an unchanged state should be pushed anyway as a heartbeat.
 * @param {number} now - current time (ms)
 * @param {number} lastPushAt - time of the last successful push (0 = never)
 */
function heartbeatDue(now, lastPushAt) {
  return !lastPushAt || now - lastPushAt >= HEARTBEAT_MS;
}

module.exports = {
  nextLongPollDelay,
  heartbeatDue,
  FAST_EMPTY_POLL_MS,
  FAST_EMPTY_POLL_BACKOFF_MS,
  ERROR_BACKOFF_MS,
  HEARTBEAT_MS,
};
