import { describe, it, expect } from 'vitest';
import { firstVisitPlan, hasSavedLayout } from './firstVisit.js';

// What src/theme/useTheme.js writes on first load, before App's check runs
const THEME_ONLY = JSON.stringify({ theme: 'dark', customTheme: { '--bg-primary': '#0a0e14' } });
const SAVED = JSON.stringify({ callsign: 'K0CJH', layout: 'modern', theme: 'retro', customTheme: {} });

describe('hasSavedLayout', () => {
  it('only a stored layout counts as a saved setup', () => {
    expect(hasSavedLayout(null)).toBe(false);
    expect(hasSavedLayout('')).toBe(false);
    expect(hasSavedLayout('not json')).toBe(false);
    expect(hasSavedLayout(THEME_ONLY)).toBe(false);
    expect(hasSavedLayout(SAVED)).toBe(true);
  });
});

describe('firstVisitPlan', () => {
  it('a theme-only config is still a first visit: Settings opens', () => {
    const plan = firstVisitPlan({ savedConfigRaw: THEME_ONLY, width: 1440 });
    expect(plan).toEqual({ firstVisit: true, openSettings: true, layout: null });
  });

  it('a real saved setup is never treated as a first visit', () => {
    for (const width of [390, 1024, 1440]) {
      expect(firstVisitPlan({ savedConfigRaw: SAVED, callsign: 'N0CALL', width, isTouch: true })).toEqual({
        firstVisit: false,
        openSettings: false,
        layout: null,
      });
    }
  });

  it('touch devices get Compact or Tablet, as before', () => {
    expect(firstVisitPlan({ width: 390, isTouch: true }).layout).toBe('compact');
    expect(firstVisitPlan({ width: 768, isTouch: true }).layout).toBe('compact');
    expect(firstVisitPlan({ width: 1024, isTouch: true }).layout).toBe('tablet');
    expect(firstVisitPlan({ width: 1200, isTouch: true }).layout).toBe('tablet');
    expect(firstVisitPlan({ width: 1440, isTouch: true }).layout).toBeNull();
    expect(firstVisitPlan({ width: 390, isTouch: false }).layout).toBeNull();
  });

  it('a station configured on the server opens nothing and picks no layout', () => {
    expect(firstVisitPlan({ callsign: 'K0CJH', width: 390, isTouch: true })).toEqual({
      firstVisit: true,
      openSettings: false,
      layout: null,
    });
  });

  it('the first-visit layout save keeps the theme the theme module stored', async () => {
    const { loadConfig } = await import('./config.js');
    localStorage.setItem('openhamclock_config', JSON.stringify({ theme: 'retro', customTheme: { '--x': '1' } }));
    const cfg = loadConfig();
    expect(cfg.theme).toBe('retro');
    expect(cfg.customTheme).toEqual({ '--x': '1' });
    // App then saves { ...config, layout: plan.layout }: theme and customTheme ride along
    expect({ ...cfg, layout: 'compact' }).toMatchObject({ theme: 'retro', customTheme: { '--x': '1' } });
    localStorage.clear();
  });
});
