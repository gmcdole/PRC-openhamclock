/**
 * useLogbookQsos — the layer must not leak its canvas renderer: every re-run
 * (a filter keystroke, a new QSO, an opacity drag) removes the previous one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const points = [
  { lat: 41.5, lon: -73, band: '40m', approx: false, place: 'FN31', qsos: [{ call: 'W1AW' }] },
  { lat: -25.5, lon: 29, band: '20m', approx: true, place: 'South Africa', qsos: [{ call: 'ZS6AA' }] },
];
vi.mock('../../utils/logbookMap.js', () => ({
  useLogbookMapPoints: () => points,
  logbookLinesShown: () => true,
}));

import { useLayer } from './useLogbookQsos.js';

// Minimal Leaflet stand-in: layers record themselves on the fake map.
const makeLayer = (kind) => {
  const layer = {
    kind,
    addTo(map) {
      map.live.add(layer);
      return layer;
    },
    bindPopup() {
      return layer;
    },
  };
  return layer;
};
const makeMap = () => {
  const map = {
    options: {},
    live: new Set(),
    removeLayer(layer) {
      map.live.delete(layer);
      map.removed.push(layer);
    },
    removed: [],
  };
  return map;
};

let renderers;
beforeEach(() => {
  renderers = [];
  globalThis.L = {
    canvas: () => {
      const r = makeLayer('renderer');
      renderers.push(r);
      return r;
    },
    polyline: () => makeLayer('line'),
    circleMarker: () => makeLayer('dot'),
  };
});
afterEach(() => {
  delete globalThis.L;
});

function Harness(props) {
  useLayer(props);
  return null;
}

describe('useLogbookQsos layer', () => {
  it('removes the previous canvas renderer on every re-run and on unmount', () => {
    const map = makeMap();
    const container = document.createElement('div');
    const root = createRoot(container);
    const render = (opacity) =>
      act(() => root.render(<Harness enabled map={map} opacity={opacity} deLat={51} deLon={4} />));

    render(0.8);
    render(0.6); // re-run, like a filter keystroke
    render(0.4);
    expect(renderers).toHaveLength(3);
    expect(map.removed.filter((l) => l.kind === 'renderer')).toEqual(renderers.slice(0, 2));
    expect([...map.live].filter((l) => l.kind === 'dot')).toHaveLength(6); // 2 points × 3 world copies

    act(() => root.unmount());
    expect(map.removed.filter((l) => l.kind === 'renderer')).toEqual(renderers);
    expect(map.live.size).toBe(0);
  });
});
