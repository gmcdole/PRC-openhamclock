#!/usr/bin/env node
/**
 * Refresh server/utils/aprs-deviceid.json from the aprs-deviceid project
 * (Hessu, OH7LZB — the table behind aprs.fi's device identification).
 *
 *   node scripts/vendor-aprs-deviceid.mjs
 *
 * Source: https://github.com/aprsorg/aprs-deviceid  (CC BY-SA 2.0)
 * The generated JSON lives on a CDN, not in the git repo. We keep only the
 * fields the app shows (vendor, model, class) so the vendored file stays small.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_URL = 'https://aprs-deviceid.aprsfoundation.org/tocalls.pretty.json';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'utils', 'aprs-deviceid.json');

const pick = (e) => {
  const o = {};
  if (e.vendor) o.vendor = e.vendor;
  if (e.model) o.model = e.model;
  if (e.class) o.class = e.class;
  return o;
};

const res = await fetch(SOURCE_URL, { headers: { 'User-Agent': 'OpenHamClock vendor-aprs-deviceid' } });
if (!res.ok) throw new Error(`${SOURCE_URL} → HTTP ${res.status}`);
const src = await res.json();

const sortedEntries = (obj) => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

const out = {
  source: 'https://github.com/aprsorg/aprs-deviceid',
  license: 'CC BY-SA 2.0 — https://creativecommons.org/licenses/by-sa/2.0/',
  generated: src.meta?.generation_time || null,
  vendored: new Date().toISOString(),
  classes: sortedEntries(Object.fromEntries(Object.entries(src.classes || {}).map(([k, v]) => [k, v.shown || k]))),
  tocalls: sortedEntries(Object.fromEntries(Object.entries(src.tocalls || {}).map(([k, v]) => [k, pick(v)]))),
  mice: sortedEntries(Object.fromEntries(Object.entries(src.mice || {}).map(([k, v]) => [k, pick(v)]))),
  micelegacy: sortedEntries(
    Object.fromEntries(
      Object.entries(src.micelegacy || {}).map(([k, v]) => [
        k,
        { prefix: v.prefix, ...(v.suffix ? { suffix: v.suffix } : {}), ...pick(v) },
      ]),
    ),
  ),
};

fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(
  `Wrote ${path.relative(process.cwd(), OUT)}: ${Object.keys(out.tocalls).length} tocalls, ` +
    `${Object.keys(out.mice).length} Mic-E, ${Object.keys(out.micelegacy).length} legacy (upstream ${out.generated})`,
);
