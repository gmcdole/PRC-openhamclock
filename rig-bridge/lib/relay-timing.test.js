// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  nextLongPollDelay,
  heartbeatDue,
  FAST_EMPTY_POLL_MS,
  FAST_EMPTY_POLL_BACKOFF_MS,
  ERROR_BACKOFF_MS,
  HEARTBEAT_MS,
} from './relay-timing.js';

describe('nextLongPollDelay', () => {
  it('re-polls at once after a long-poll that was actually held', () => {
    expect(nextLongPollDelay({ ok: true, elapsedMs: 28000, commandCount: 0 })).toBe(0);
  });

  it('re-polls at once when commands were delivered, however fast', () => {
    expect(nextLongPollDelay({ ok: true, elapsedMs: 3, commandCount: 2 })).toBe(0);
  });

  // An older server answers a poll for a session it does not know with an
  // instant empty 200; re-polling at once spins at network speed.
  it('backs off when an empty poll comes back without being held', () => {
    expect(nextLongPollDelay({ ok: true, elapsedMs: 1, commandCount: 0 })).toBe(FAST_EMPTY_POLL_BACKOFF_MS);
    expect(nextLongPollDelay({ ok: true, elapsedMs: FAST_EMPTY_POLL_MS - 1, commandCount: 0 })).toBe(
      FAST_EMPTY_POLL_BACKOFF_MS,
    );
    expect(nextLongPollDelay({ ok: true, elapsedMs: FAST_EMPTY_POLL_MS, commandCount: 0 })).toBe(0);
  });

  it('backs off after an error or unexpected status', () => {
    expect(nextLongPollDelay({ ok: false, elapsedMs: 5, commandCount: 0 })).toBe(ERROR_BACKOFF_MS);
  });

  it('caps a storm at about one request per second', () => {
    expect(FAST_EMPTY_POLL_BACKOFF_MS).toBeGreaterThanOrEqual(1000);
  });
});

describe('heartbeatDue', () => {
  it('is due before anything has been pushed', () => {
    expect(heartbeatDue(1000, 0)).toBe(true);
  });

  it('is not due within the heartbeat interval', () => {
    expect(heartbeatDue(10_000 + HEARTBEAT_MS - 1, 10_000)).toBe(false);
  });

  it('is due once the heartbeat interval has passed', () => {
    expect(heartbeatDue(10_000 + HEARTBEAT_MS, 10_000)).toBe(true);
  });

  // The server forgets sessions on restart and after an idle hour; a heartbeat
  // well inside that window re-registers an unchanged rig promptly.
  it('beats well inside the server session TTL', () => {
    expect(HEARTBEAT_MS).toBeLessThanOrEqual(60_000);
  });
});
