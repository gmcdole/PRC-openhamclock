/**
 * useIdleClock — show the Clock layout after a period of no input, and come
 * straight back when someone touches the screen.
 *
 * Settings → Display → Idle clock persists (via the normal config save path):
 *   config.idleClock = { enabled: boolean, minutes: number }   // 1–120
 *
 * While the hook has switched to the clock, any pointer / key / wheel / touch
 * event restores the layout that was showing before. A layout the user picked
 * by hand (including the Clock layout itself) is never touched: the restore
 * only fires for a switch this hook made. Dialogs pause the idle timer, and
 * if the user changes layout while the idle clock is up the hook simply
 * forgets it (no restore later).
 *
 * Returns { active, minutes } — `active` is true while the idle clock is up,
 * which App uses to hold Scene Rotation still.
 */
import { useEffect, useRef, useState } from 'react';

export const IDLE_CLOCK_LAYOUT = 'clock';
export const IDLE_CLOCK_MIN_MINUTES = 1;
export const IDLE_CLOCK_MAX_MINUTES = 120;
const TICK_MS = 1000;

/** Clamp a stored minutes value into the supported range. */
export const clampIdleMinutes = (min) => {
  const n = parseInt(min, 10);
  if (!Number.isFinite(n)) return 10;
  return Math.min(IDLE_CLOCK_MAX_MINUTES, Math.max(IDLE_CLOCK_MIN_MINUTES, n));
};

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'];

export default function useIdleClock(config, onSaveConfig, { paused = false } = {}) {
  const enabled = !!config?.idleClock?.enabled;
  const minutes = clampIdleMinutes(config?.idleClock?.minutes);
  const [active, setActive] = useState(false);

  const configRef = useRef(config);
  configRef.current = config;
  const saveRef = useRef(onSaveConfig);
  saveRef.current = onSaveConfig;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const activeRef = useRef(false);
  const restoreRef = useRef(null); // layout to go back to
  const appliedRef = useRef(false); // config has been seen showing the clock since our switch
  const lastActivityRef = useRef(Date.now());

  // Input tracking (capture phase so panels cannot swallow it). While the
  // idle clock is up, the first input restores the previous layout.
  useEffect(() => {
    if (!enabled) return undefined;
    lastActivityRef.current = Date.now();
    const bump = () => {
      lastActivityRef.current = Date.now();
      if (!activeRef.current) return;
      activeRef.current = false;
      setActive(false);
      const cfg = configRef.current;
      const back = restoreRef.current;
      restoreRef.current = null;
      if (back && cfg?.layout === IDLE_CLOCK_LAYOUT) saveRef.current?.({ ...cfg, layout: back });
    };
    const opts = { capture: true, passive: true };
    for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, bump, opts);
    return () => {
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, bump, opts);
    };
  }, [enabled]);

  // The ticker: a 1 s heartbeat checking the idle deadline.
  useEffect(() => {
    if (!enabled) {
      activeRef.current = false;
      restoreRef.current = null;
      setActive(false);
      return undefined;
    }
    const timer = setInterval(() => {
      const cfg = configRef.current;
      if (activeRef.current) {
        // Wait until the config has caught up with our switch (a render or
        // two); after that, a layout other than the clock means someone
        // changed it another way (settings, scene rotation) — forget the restore.
        if (cfg?.layout === IDLE_CLOCK_LAYOUT) {
          appliedRef.current = true;
        } else if (appliedRef.current) {
          activeRef.current = false;
          restoreRef.current = null;
          setActive(false);
          lastActivityRef.current = Date.now(); // start a fresh idle period from here
        }
        return;
      }
      if (pausedRef.current) {
        lastActivityRef.current = Date.now(); // a dialog counts as activity
        return;
      }
      if (cfg?.layout === IDLE_CLOCK_LAYOUT) return; // already on the clock by choice
      if (Date.now() - lastActivityRef.current < minutes * 60_000) return;
      restoreRef.current = cfg?.layout || 'modern';
      activeRef.current = true;
      appliedRef.current = false;
      setActive(true);
      saveRef.current?.({ ...cfg, layout: IDLE_CLOCK_LAYOUT });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [enabled, minutes]);

  return { active, minutes };
}
