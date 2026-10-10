/**
 * useIdleClock — Vitest + React 18, fake timers.
 * Rendered with createRoot/act, same pattern as useSceneRotation.test.jsx.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import useIdleClock, { clampIdleMinutes } from './useIdleClock.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root;
let container;
let latest; // { config, result }
let saves;

function Harness({ initial, paused }) {
  const [config, setConfig] = useState(initial);
  const result = useIdleClock(
    config,
    (next) => {
      saves.push(next);
      setConfig(next);
    },
    { paused },
  );
  latest = { config, result, setConfig };
  return null;
}

const mount = (initial, paused = false) =>
  act(() => {
    root.render(<Harness initial={initial} paused={paused} />);
  });
const advance = (ms) => act(() => vi.advanceTimersByTime(ms));
const fire = (type) => act(() => window.dispatchEvent(new Event(type)));

beforeEach(() => {
  vi.useFakeTimers();
  saves = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const cfg = (over = {}) => ({ layout: 'modern', idleClock: { enabled: true, minutes: 2 }, ...over });

describe('useIdleClock', () => {
  it('switches to the clock after the idle period and restores on input', () => {
    mount(cfg());
    advance(119_000);
    expect(saves).toHaveLength(0);
    advance(2_000);
    expect(saves.at(-1)?.layout).toBe('clock');
    expect(latest.result.active).toBe(true);

    fire('pointerdown');
    expect(saves.at(-1)?.layout).toBe('modern');
    expect(latest.result.active).toBe(false);
  });

  it('input before the deadline defers the switch', () => {
    mount(cfg());
    advance(90_000);
    fire('keydown');
    advance(90_000);
    expect(saves).toHaveLength(0);
    advance(31_000);
    expect(saves.at(-1)?.layout).toBe('clock');
  });

  it('does nothing while disabled, and never touches a Clock layout the user chose', () => {
    mount(cfg({ idleClock: { enabled: false, minutes: 1 } }));
    advance(5 * 60_000);
    expect(saves).toHaveLength(0);

    act(() => root.unmount());
    root = createRoot(container);
    saves = [];
    mount(cfg({ layout: 'clock', idleClock: { enabled: true, minutes: 1 } }));
    advance(3 * 60_000);
    fire('pointerdown');
    expect(saves).toHaveLength(0);
    expect(latest.result.active).toBe(false);
  });

  it('a dialog being open pauses the idle timer', () => {
    mount(cfg({ idleClock: { enabled: true, minutes: 1 } }), true);
    advance(5 * 60_000);
    expect(saves).toHaveLength(0);
  });

  it('forgets the restore if the layout is changed another way while the clock is up', () => {
    mount(cfg({ idleClock: { enabled: true, minutes: 1 } }));
    advance(61_000);
    expect(latest.config.layout).toBe('clock');
    advance(1_500); // a tick sees the clock applied
    act(() => latest.setConfig({ ...latest.config, layout: 'dockable' })); // e.g. Settings
    advance(1_500);
    expect(latest.result.active).toBe(false);
    fire('pointerdown');
    expect(saves.filter((s) => s.layout === 'modern')).toHaveLength(0);
  });

  it('clamps minutes into 1–120 and defaults to 10', () => {
    expect(clampIdleMinutes(0)).toBe(1);
    expect(clampIdleMinutes(999)).toBe(120);
    expect(clampIdleMinutes('abc')).toBe(10);
    expect(clampIdleMinutes('15')).toBe(15);
  });
});
