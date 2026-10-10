/**
 * Smoke test: the Clock layout mounts, shows both clocks, swaps on tap,
 * and remembers the choice.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import ClockLayout from './ClockLayout.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe('ClockLayout', () => {
  it('renders UTC large by default with local beneath, callsign and grid, and swaps on tap', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-08T15:04:05Z'));
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<ClockLayout config={{ callsign: 'K0CJH', timezone: 'America/Chicago' }} deGrid="EN34" />);
    });
    const text = container.textContent;
    expect(text).toContain('UTC');
    expect(text).toContain('15:04:05'); // UTC, 24 h
    expect(text).toContain('10:04:05'); // Chicago (CDT) beneath
    expect(text).toContain('CDT');
    expect(text).toContain('Thursday, October 8, 2026');
    expect(text).toContain('K0CJH · EN34');

    const btn = container.querySelector('button');
    act(() => btn.click());
    expect(localStorage.getItem('openhamclock_clockPrimary')).toBe('local');
    // Local is now the big one: its label leads the page
    expect(container.textContent.indexOf('CDT')).toBeLessThan(container.textContent.indexOf('UTC'));

    act(() => root.unmount());
    container.remove();
  });

  it('honours the 12-hour setting and hides a placeholder callsign', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-08T15:04:05Z'));
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<ClockLayout config={{ callsign: 'N0CALL', timezone: 'UTC' }} use12Hour />);
    });
    expect(container.textContent).toContain('3:04:05');
    expect(container.textContent).toContain('PM');
    expect(container.textContent).not.toContain('N0CALL');
    act(() => root.unmount());
    container.remove();
  });
});
