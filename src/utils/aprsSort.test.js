import { describe, it, expect, beforeEach } from 'vitest';
import {
  sortAprsStations,
  nextAprsSort,
  readStoredAprsSort,
  storeAprsSort,
  APRS_SORT_STORAGE_KEY,
} from './aprsSort.js';

const NOW = Date.now();
const min = (m) => NOW - m * 60000;
const DE = { lat: 40.0, lon: -105.0 }; // Colorado
const stations = [
  { ssid: 'KE8PLM-9', call: 'KE8PLM', lat: 41.5, lon: -81.7, timestamp: min(30) }, // Cleveland, ~2000 km
  { ssid: 'W0ABC-7', call: 'W0ABC', lat: 40.1, lon: -105.1, timestamp: min(5) }, // next door
  { ssid: 'N0XYZ', call: 'N0XYZ', timestamp: min(120) }, // no position
  { ssid: 'AA1A-1', call: 'AA1A', lat: 42.3, lon: -71.0 }, // no timestamp (age unknown)
];
const calls = (list) => list.map((s) => s.ssid);

describe('sortAprsStations', () => {
  it('returns the input untouched with no sort active', () => {
    expect(sortAprsStations(stations, null, DE)).toBe(stations);
    expect(sortAprsStations(stations, { key: 'bogus', dir: 'asc' }, DE)).toBe(stations);
  });

  it('sorts by callsign A→Z and reverses', () => {
    expect(calls(sortAprsStations(stations, { key: 'call', dir: 'asc' }, DE))).toEqual([
      'AA1A-1',
      'KE8PLM-9',
      'N0XYZ',
      'W0ABC-7',
    ]);
    expect(calls(sortAprsStations(stations, { key: 'call', dir: 'desc' }, DE))).toEqual([
      'W0ABC-7',
      'N0XYZ',
      'KE8PLM-9',
      'AA1A-1',
    ]);
  });

  it('sorts by age newest first, unknown age last in both directions', () => {
    expect(calls(sortAprsStations(stations, { key: 'age', dir: 'asc' }, DE))).toEqual([
      'W0ABC-7',
      'KE8PLM-9',
      'N0XYZ',
      'AA1A-1',
    ]);
    expect(calls(sortAprsStations(stations, { key: 'age', dir: 'desc' }, DE))).toEqual([
      'N0XYZ',
      'KE8PLM-9',
      'W0ABC-7',
      'AA1A-1',
    ]);
  });

  it('sorts by distance nearest first, positionless stations last', () => {
    expect(calls(sortAprsStations(stations, { key: 'dist', dir: 'asc' }, DE))).toEqual([
      'W0ABC-7',
      'KE8PLM-9',
      'AA1A-1',
      'N0XYZ',
    ]);
    expect(calls(sortAprsStations(stations, { key: 'dist', dir: 'desc' }, DE))).toEqual([
      'AA1A-1',
      'KE8PLM-9',
      'W0ABC-7',
      'N0XYZ',
    ]);
  });

  it('is a no-op on distance when DE has no location (everything unknown, order kept)', () => {
    expect(calls(sortAprsStations(stations, { key: 'dist', dir: 'asc' }, null))).toEqual(calls(stations));
  });

  it('does not mutate the input', () => {
    const copy = [...stations];
    sortAprsStations(stations, { key: 'call', dir: 'asc' }, DE);
    expect(stations).toEqual(copy);
  });
});

describe('nextAprsSort', () => {
  it('starts a new column ascending and flips the active one', () => {
    expect(nextAprsSort(null, 'age')).toEqual({ key: 'age', dir: 'asc' });
    expect(nextAprsSort({ key: 'age', dir: 'asc' }, 'age')).toEqual({ key: 'age', dir: 'desc' });
    expect(nextAprsSort({ key: 'age', dir: 'desc' }, 'age')).toEqual({ key: 'age', dir: 'asc' });
    expect(nextAprsSort({ key: 'age', dir: 'desc' }, 'call')).toEqual({ key: 'call', dir: 'asc' });
  });
  it('ignores unknown columns', () => {
    expect(nextAprsSort({ key: 'age', dir: 'asc' }, 'nope')).toEqual({ key: 'age', dir: 'asc' });
  });
});

describe('stored sort', () => {
  beforeEach(() => localStorage.clear());
  it('round-trips and rejects garbage', () => {
    expect(readStoredAprsSort()).toBeNull();
    storeAprsSort({ key: 'dist', dir: 'desc' });
    expect(readStoredAprsSort()).toEqual({ key: 'dist', dir: 'desc' });
    localStorage.setItem(APRS_SORT_STORAGE_KEY, '{"key":"x","dir":"asc"}');
    expect(readStoredAprsSort()).toBeNull();
    localStorage.setItem(APRS_SORT_STORAGE_KEY, 'not json');
    expect(readStoredAprsSort()).toBeNull();
    storeAprsSort(null);
    expect(localStorage.getItem(APRS_SORT_STORAGE_KEY)).toBeNull();
  });
});
