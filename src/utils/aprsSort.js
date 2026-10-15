/**
 * APRS station list sorting (#1208): by callsign, age or distance from DE,
 * with the choice remembered per browser.
 */
import { calculateDistance } from './geo.js';
import { stationAgeMinutes } from './aprsStationAge.js';

export const APRS_SORT_KEYS = ['call', 'age', 'dist'];
export const APRS_SORT_STORAGE_KEY = 'openhamclock_aprsSort';

const isValidSort = (s) => !!s && APRS_SORT_KEYS.includes(s.key) && (s.dir === 'asc' || s.dir === 'desc');

export function readStoredAprsSort() {
  try {
    const raw = localStorage.getItem(APRS_SORT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isValidSort(parsed) ? { key: parsed.key, dir: parsed.dir } : null;
  } catch {
    return null;
  }
}

export function storeAprsSort(sort) {
  try {
    if (!isValidSort(sort)) localStorage.removeItem(APRS_SORT_STORAGE_KEY);
    else localStorage.setItem(APRS_SORT_STORAGE_KEY, JSON.stringify({ key: sort.key, dir: sort.dir }));
  } catch {
    /* storage unavailable — sorting still works for the session */
  }
}

/**
 * Sort state after a header click: a new column starts ascending (A→Z,
 * newest first, nearest first); clicking the active column reverses it.
 */
export function nextAprsSort(current, key) {
  if (!APRS_SORT_KEYS.includes(key)) return current ?? null;
  if (current?.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: 'asc' };
}

export function stationDistanceKm(station, deLocation) {
  if (deLocation?.lat == null || deLocation?.lon == null) return null;
  if (station?.lat == null || station?.lon == null) return null;
  const d = calculateDistance(deLocation.lat, deLocation.lon, station.lat, station.lon);
  return Number.isFinite(d) ? d : null;
}

const sortValue = (station, key, deLocation) => {
  if (key === 'call') return String(station.ssid || station.call || '').toUpperCase() || null;
  if (key === 'age') return stationAgeMinutes(station);
  if (key === 'dist') return stationDistanceKm(station, deLocation);
  return null;
};

/**
 * Stable sort; stations without a value for the column (no position, no
 * timestamp) always sink to the bottom whichever direction is chosen.
 * Returns the input array untouched when no sort is active.
 */
export function sortAprsStations(stations, sort, deLocation) {
  if (!Array.isArray(stations) || !isValidSort(sort)) return stations;
  const mul = sort.dir === 'desc' ? -1 : 1;
  const keyed = stations.map((s, i) => ({ s, i, v: sortValue(s, sort.key, deLocation) }));
  keyed.sort((a, b) => {
    if (a.v == null && b.v == null) return a.i - b.i;
    if (a.v == null) return 1;
    if (b.v == null) return -1;
    let c;
    if (typeof a.v === 'string') c = a.v < b.v ? -1 : a.v > b.v ? 1 : 0;
    else c = a.v - b.v;
    return c !== 0 ? c * mul : a.i - b.i;
  });
  return keyed.map((k) => k.s);
}
