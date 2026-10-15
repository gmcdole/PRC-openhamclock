/**
 * QsoForm — the Rig button's handling of the tuned spot's call.
 * Uses react-dom/client.createRoot + react.act, like the other component tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key, opts) => (opts && opts.defaultValue) || key }),
}));

// The rig the form reads; each test sets the dial.
const rig = { connected: true, freq: 14025000, mode: 'CW' };
vi.mock('../contexts/RigContext.jsx', () => ({ useRig: () => rig }));

import { __resetLogbookForTests, setTunedSpot } from '../services/logbookStore.js';
import { QsoForm } from './QsoForm.jsx';

let container;
let root;

const field = (label) => container.querySelector(`input[aria-label="${label}"]`);
const callValue = () => field('Callsign').value;
const gridValue = () => field('Gridsquare').value;

// Set a controlled input's value the way a user would, so React sees it.
const type = (input, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const pressRig = () => {
  const btn = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Rig');
  act(() => btn.click());
};

const mount = () => {
  act(() => {
    root.render(<QsoForm prefill={{}} onSaved={() => {}} onCancel={() => {}} />);
  });
};

beforeEach(() => {
  __resetLogbookForTests();
  rig.freq = 14025000;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('QsoForm Rig button and the tuned spot', () => {
  it('fills in the spot call and grid while the rig is still near the spot', () => {
    setTunedSpot({ call: 'ZL1XYZ', freqHz: 14025000, gridsquare: 'RF73' });
    mount();
    pressRig();
    expect(callValue()).toBe('ZL1XYZ');
    expect(gridValue()).toBe('RF73');
  });

  it('clears a call that came from the spot once the rig has tuned away', () => {
    setTunedSpot({ call: 'ZL1XYZ', freqHz: 14025000, gridsquare: 'RF73' });
    mount();
    pressRig(); // near → spot call
    rig.freq = 7030000;
    pressRig(); // far → that call no longer belongs here
    expect(callValue()).toBe('');
    expect(gridValue()).toBe('');
  });

  it('keeps a hand-typed call and grid when a far-away spot is remembered', () => {
    setTunedSpot({ call: 'ZL1XYZ', freqHz: 14025000, gridsquare: 'RF73' });
    rig.freq = 7030000; // tuned to 40 m by hand since clicking the 20 m spot
    mount();
    type(field('Callsign'), 'W1AW');
    type(field('Gridsquare'), 'FN31');
    pressRig();
    expect(callValue()).toBe('W1AW');
    expect(gridValue()).toBe('FN31');
  });

  it('leaves the call alone when no spot is remembered', () => {
    mount();
    type(field('Callsign'), 'W1AW');
    pressRig();
    expect(callValue()).toBe('W1AW');
  });
});
