import { useState, useEffect, useRef } from 'react';
import { esc } from '../../utils/escapeHtml.js';
import { ZONE_SOURCES } from '../../utils/globeOverlays.js';
import { densifyGeoJson, shiftGeoJsonLon } from '../../utils/geo.js';

/**
 * CQ / ITU Zones Overlay Plugin
 *
 * Renders CQ zone (40) or ITU zone (90) boundary polygons with zone number
 * labels at each zone's label point. A small on-map control toggles between
 * CQ and ITU (persisted to localStorage, default CQ) — same per-layer config
 * pattern as the earthquakes feed selector.
 *
 * Data: vendored GeoJSON fetched at runtime from /geo/cq-zones.geojson and
 * /geo/itu-zones.geojson.
 *   Source: https://github.com/HB9HIL/hamradio-zones-geojson
 *   (files cqzones.geojson / ituzones.geojson, commit as of 2026-08-27)
 *   License: MIT — Copyright (c) HB9HIL. Used e.g. by Wavelog.
 */

export const metadata = {
  id: 'zones',
  name: 'plugins.layers.zones.name',
  description: 'plugins.layers.zones.description',
  icon: '🌐',
  category: 'overlay',
  defaultEnabled: false,
  defaultOpacity: 0.7,
  version: '1.0.0',
};

// File paths + colours are shared with the 3D globe's zones painter via
// utils/globeOverlays.js; only the control labels are local to this layer.
const ZONE_TYPES = {
  cq: { ...ZONE_SOURCES.cq, label: 'CQ Zones (40)' },
  itu: { ...ZONE_SOURCES.itu, label: 'ITU Zones (90)' },
};

// ITU zone names in the source data carry legacy marker prefixes like
// "!!:KL:**Alaska, east of 141º W#!" — keep only the human-readable part.
function cleanZoneName(name) {
  if (!name) return '';
  let s = String(name);
  const star = s.lastIndexOf('**');
  if (star !== -1) s = s.slice(star + 2);
  return s
    .replace(/^[!#:*]+/, '')
    .replace(/[#!]+$/, '')
    .trim();
}

export function useLayer({ enabled = false, opacity = 0.7, map = null }) {
  const [zoneType, setZoneType] = useState(() => {
    try {
      const v = localStorage.getItem('openhamclock_zones_type');
      return v === 'itu' ? 'itu' : 'cq';
    } catch {
      return 'cq';
    }
  });
  const [geojson, setGeojson] = useState(null);
  const cacheRef = useRef({}); // zoneType → parsed GeoJSON
  const layersRef = useRef([]);
  const controlRef = useRef(null);

  // Fetch (and cache) the GeoJSON for the selected zone type
  useEffect(() => {
    if (!enabled) return;
    const cached = cacheRef.current[zoneType];
    if (cached) {
      setGeojson(cached);
      return;
    }
    let alive = true;
    setGeojson(null);
    fetch(ZONE_TYPES[zoneType].file)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!alive || !data || !Array.isArray(data.features)) return;
        // Densify long boundary segments (>2°) so they curve correctly on the
        // azimuthal projection instead of cutting straight chords across it
        // (and track parallels slightly better on Mercator too). Done once at
        // fetch time and cached; cost is tiny — the CQ set grows 134,734 →
        // 137,145 points (+1.8%), ITU 73,407 → 77,269 (+5.3%).
        const densified = {
          ...data,
          features: data.features.map((f) => ({ ...f, geometry: densifyGeoJson(f.geometry, 2) })),
        };
        cacheRef.current[zoneType] = densified;
        setGeojson(densified);
      })
      .catch((err) => {
        console.error('[Zones] GeoJSON fetch error:', err);
      });
    return () => {
      alive = false;
    };
  }, [enabled, zoneType]);

  // Render boundaries + labels
  useEffect(() => {
    if (!map || typeof L === 'undefined') return;

    layersRef.current.forEach((layer) => {
      try {
        map.removeLayer(layer);
      } catch {}
    });
    layersRef.current = [];

    if (!enabled || !geojson) return;

    const { color } = ZONE_TYPES[zoneType];
    const renderer = L.canvas({ padding: 0.5 });
    const newLayers = [];

    // Mercator wraps the world — draw each zone one world-copy either side
    // as well (#1171: a map centred near the antimeridian, e.g. on VK,
    // otherwise shows an empty half where L.geoJSON never repeats its
    // vectors). The azimuthal projection is periodic in longitude, so one
    // copy covers the whole disc — same rule as useWorkedGrids.
    const isAzimuthal = map.options?.crs?.code === 'AzimuthalEquidistant';
    const lonOffsets = isAzimuthal ? [0] : [-360, 0, 360];

    geojson.features.forEach((feature) => {
      const props = feature.properties || {};
      const zoneNumber = props.cq_zone_number ?? props.itu_zone_number;
      const zoneName = cleanZoneName(props.cq_zone_name ?? props.itu_zone_name);
      const labelLoc = props.cq_zone_name_loc ?? props.itu_zone_name_loc; // [lat, lon]

      for (const dLon of lonOffsets) {
        try {
          const layer = L.geoJSON(shiftGeoJsonLon(feature.geometry, dLon), {
            renderer,
            style: {
              color,
              weight: 1.2,
              opacity: opacity * 0.9,
              fill: true,
              fillColor: color,
              fillOpacity: 0.02, // near-invisible fill so polygons stay hoverable
              interactive: true,
            },
          });

          // Hover tooltip, not a click popup: Leaflet's popup-open handler
          // stops the click event, so with a popup bound every map click
          // inside a zone (i.e. everywhere) was swallowed and the DX marker
          // could not be moved while this layer was on. Tooltips leave the
          // click to bubble through to the map's set-DX handler.
          layer.bindTooltip(
            `<div style="font-family: var(--font-mono); font-size: 12px;">
              <div style="font-weight: bold; color: var(--accent-cyan);">
                🌐 ${zoneType === 'cq' ? 'CQ' : 'ITU'} Zone ${esc(String(zoneNumber ?? '?'))}
              </div>
              ${zoneName ? `<div style="font-size: 11px;">${esc(zoneName)}</div>` : ''}
            </div>`,
            { sticky: true, direction: 'top', offset: [0, -8], opacity: 0.95 },
          );
          layer.addTo(map);
          newLayers.push(layer);
        } catch {
          // Bad geometry → skip
        }
      }

      // Zone number label at the zone's label point, one per world copy
      if (zoneNumber != null && Array.isArray(labelLoc) && labelLoc.length === 2) {
        for (const dLon of lonOffsets) {
          try {
            const label = L.marker([labelLoc[0], labelLoc[1] + dLon], {
              interactive: false,
              keyboard: false,
              icon: L.divIcon({
                className: 'zones-layer-label',
                html: `<div style="
                font-family: var(--font-mono, monospace);
                font-size: 13px;
                font-weight: 700;
                color: ${color};
                opacity: ${Math.min(1, opacity + 0.2)};
                text-shadow: 0 0 3px rgba(0,0,0,0.9), 0 0 1px rgba(0,0,0,0.9);
                white-space: nowrap;
                pointer-events: none;
                transform: translate(-50%, -50%);
              ">${esc(String(zoneNumber))}</div>`,
                iconSize: [0, 0],
              }),
            });
            label.addTo(map);
            newLayers.push(label);
          } catch {}
        }
      }
    });

    layersRef.current = newLayers;
    return () => {
      newLayers.forEach((layer) => {
        try {
          map.removeLayer(layer);
        } catch {}
      });
    };
  }, [enabled, geojson, zoneType, map, opacity]);

  // On-map control: CQ / ITU selector (earthquakes-feed-select pattern)
  useEffect(() => {
    if (!enabled || !map || controlRef.current) return;

    const Control = L.Control.extend({
      options: { position: 'topright' },
      onAdd() {
        const wrapper = L.DomUtil.create('div', 'panel-wrapper');
        const div = L.DomUtil.create('div', 'zones-layer-control', wrapper);
        div.style.minWidth = '160px';
        div.innerHTML = `
          <div class="floating-panel-header">🌐 Zones</div>
          <div style="margin-top:8px;font-size:11px;color:var(--text-secondary);">
            <label for="zones-type-select" style="display:block;margin-bottom:4px;">Zone set:</label>
            <select id="zones-type-select" style="width:100%;background:var(--bg-tertiary);color:var(--text-primary);border:1px solid var(--border-color);padding:4px;font-size:11px;">
              ${Object.entries(ZONE_TYPES)
                .map(([id, def]) => `<option value="${id}">${def.label}</option>`)
                .join('')}
            </select>
          </div>
        `;

        const select = div.querySelector('#zones-type-select');
        if (select) {
          select.value = zoneType;
          select.addEventListener('change', (e) => {
            const v = e.target.value === 'itu' ? 'itu' : 'cq';
            setZoneType(v);
            try {
              localStorage.setItem('openhamclock_zones_type', v);
            } catch {}
          });
        }

        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
        return wrapper;
      },
    });

    const control = new Control();
    map.addControl(control);
    controlRef.current = control;

    return () => {
      if (controlRef.current) {
        try {
          map.removeControl(controlRef.current);
        } catch {}
        controlRef.current = null;
      }
    };
    // zoneType intentionally omitted: the select drives it, so it never goes stale
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, enabled]);

  return { zoneType, zoneCount: geojson?.features?.length || 0 };
}
