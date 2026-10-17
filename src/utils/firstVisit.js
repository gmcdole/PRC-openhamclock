/**
 * firstVisitPlan — what to do the first time this browser opens the app.
 *
 * "First visit" means no real setup has been saved: openhamclock_config has
 * no layout in it. The key alone is not a usable signal, because the theme
 * module (src/theme/useTheme.js, via the always-mounted Settings panel)
 * stores `{ theme, customTheme }` under the same key on first load — before
 * App's first-visit check runs — so testing for the key made every visit
 * look like a return visit: Settings stopped auto-opening for new users and
 * touch devices stopped getting their layout.
 *
 * On a first visit with the station not set up (N0CALL): Settings opens,
 * and a touch device gets a layout picked — phones and small tablets
 * (≤ 768 px) Compact, tablets (769–1200 px) Tablet.
 */

/** Has a layout ever been saved? `raw` is the stored openhamclock_config string. */
export function hasSavedLayout(raw) {
  if (!raw) return false;
  try {
    const cfg = JSON.parse(raw);
    return !!(cfg && typeof cfg === 'object' && typeof cfg.layout === 'string' && cfg.layout);
  } catch {
    return false;
  }
}

export function firstVisitPlan({ savedConfigRaw = null, callsign = 'N0CALL', width = 0, isTouch = false } = {}) {
  const plan = { firstVisit: false, openSettings: false, layout: null };
  if (hasSavedLayout(savedConfigRaw)) return plan;
  plan.firstVisit = true;
  if (callsign && callsign !== 'N0CALL') return plan;
  plan.openSettings = true;
  if (isTouch && width > 0 && width <= 768) plan.layout = 'compact';
  else if (isTouch && width > 768 && width <= 1200) plan.layout = 'tablet';
  return plan;
}
