/**
 * Help deep-link map — topic keys → docs/MANUAL.md heading anchors.
 *
 * Every anchor here MUST correspond to a real heading in docs/MANUAL.md
 * (GitHub slug rules — see utils/slugify.js). helpTopics.test.js parses
 * the manual and fails the build if any anchor goes stale, so manual
 * edits can't silently break in-app help links.
 *
 * openHelp(topic) fires the `openhamclock:open-help` custom event:
 *  - App.jsx listens and opens Settings on the Help tab
 *  - SettingsPanel listens and switches to the Help tab + scrolls the
 *    rendered manual to the topic's anchor once it has loaded
 */

export const HELP_EVENT = 'openhamclock:open-help';

/** topic key → MANUAL.md heading anchor */
export const HELP_TOPICS = {
  basics: 'the-basics',
  map: 'the-map',
  projections: 'projections-flat-azimuthal-3d-globe',
  basemaps: 'basemap-styles',
  'map-layers': 'map-layers',
  'de-dx': 'de-and-dx-markers-click-to-set-favorites',
  'map-text-view': 'map-data-text-view-accessibility',
  'keyboard-shortcuts': 'keyboard-shortcuts',
  panels: 'panels',
  'spots-activity': 'spots-and-activity',
  'propagation-panels': 'propagation-and-space-weather',
  'station-rig-panels': 'station-and-rig',
  logging: 'logging',
  'emcomm-mesh': 'emcomm-and-mesh',
  'dx-cluster': 'dx-cluster-in-depth',
  logbook: 'the-logbook',
  propagation: 'propagation-in-depth',
  satellites: 'satellites',
  'rig-bridge': 'rig-control-and-rig-bridge',
  wsjtx: 'wsjt-x-and-digital-modes',
  emcomm: 'the-emcomm-layout',
  contest: 'contest-mode',
  alerts: 'alerts-and-notifications',
  offline: 'offline-mode-pwa',
  'layouts-themes-profiles': 'layouts-themes-and-profiles',
  languages: 'languages',
  settings: 'settings-reference',
  hosting: 'hosted-site-vs-self-hosted',
  utility: 'utility',
};

/** Dockable panel component id → topic key (see DockableApp panelDefs) */
export const PANEL_HELP = {
  'world-map': 'map',
  'map-list-view': 'map-text-view',
  'de-location': 'station-rig-panels',
  'dx-location': 'de-dx',
  'analog-clock': 'station-rig-panels',
  solar: 'propagation-panels',
  'solar-image': 'propagation-panels',
  'solar-indices': 'propagation-panels',
  'solar-xray': 'propagation-panels',
  lunar: 'propagation-panels',
  propagation: 'propagation',
  'propagation-chart': 'propagation',
  'propagation-bars': 'propagation',
  'band-conditions': 'propagation-panels',
  'band-health': 'propagation-panels',
  'band-activity': 'propagation-panels',
  'psk-bands': 'propagation-panels',
  ibp: 'propagation-panels',
  'dx-cluster': 'dx-cluster',
  logbook: 'logbook',
  awards: 'logging',
  'psk-reporter': 'spots-activity',
  dxpeditions: 'spots-activity',
  pota: 'spots-activity',
  wwff: 'spots-activity',
  sota: 'spots-activity',
  wwbota: 'spots-activity',
  aprs: 'emcomm-mesh',
  'aprs-telemetry': 'emcomm-mesh',
  rotator: 'station-rig-panels',
  contests: 'spots-activity',
  'swpc-alerts': 'propagation-panels',
  'meteor-showers': 'propagation-panels',
  ambient: 'station-rig-panels',
  'rig-control': 'rig-bridge',
  'freq-memories': 'station-rig-panels',
  'net-schedule': 'station-rig-panels',
  'callsign-search': 'utility',
  'dx-news': 'spots-activity',
  'solar-cycle': 'propagation-panels',
  'log-stats': 'logging',
  'sked-planner': 'propagation',
  ionosonde: 'propagation-panels',
  'prop-verify': 'propagation-panels',
  'on-air': 'station-rig-panels',
  'id-timer': 'station-rig-panels',
  image: 'station-rig-panels',
  keybindings: 'keyboard-shortcuts',
  meshtastic: 'emcomm-mesh',
  meshcom: 'emcomm-mesh',
  'digital-modes': 'wsjtx',
  winlink: 'emcomm-mesh',
  'sat-passes': 'satellites',
  'amsat-status': 'satellites',
  'sun-moon': 'propagation-panels',
  'swpc-trends': 'propagation-panels',
  'rbn-mine': 'propagation-panels',
  'wspr-mine': 'propagation-panels',
  'pota-activator': 'spots-activity',
  repeaters: 'utility',
  'world-clocks': 'utility',
  stopwatch: 'utility',
  'aircraft-nearby': 'utility',
};

/**
 * Map layer id → topic key. Layers with a dedicated manual section get
 * their own topic; everything else links to the Map layers overview.
 */
export const LAYER_HELP = {
  'history-playback': 'map-layers',
  satellites: 'satellites',
  'voacap-heatmap': 'propagation',
  'muf-map': 'propagation',
  grayline: 'map-layers',
  rbn: 'map-layers',
  wspr: 'map-layers',
  'great-circle': 'de-dx',
  ibp: 'propagation-panels',
  'psk-band-activity': 'propagation-panels',
  contest_qsos: 'logging',
  n3fjp_logged_qsos: 'logging',
  meshtastic: 'emcomm-mesh',
  'winlink-gateways': 'emcomm-mesh',
  'worked-grids': 'logbook',
  'active-users': 'map-layers',
};

/** Settings tab id → topic key */
export const SETTINGS_TAB_HELP = {
  station: 'settings',
  integrations: 'settings',
  display: 'layouts-themes-profiles',
  clock: 'layouts-themes-profiles',
  layers: 'map-layers',
  satellites: 'satellites',
  profiles: 'layouts-themes-profiles',
  community: 'settings',
  alerts: 'alerts',
  'rig-bridge': 'rig-bridge',
};

export function topicAnchor(topic) {
  return HELP_TOPICS[topic] || HELP_TOPICS.basics;
}

export function panelHelpTopic(componentId) {
  return PANEL_HELP[componentId] || 'panels';
}

export function layerHelpTopic(layerId) {
  return LAYER_HELP[layerId] || 'map-layers';
}

export function settingsTabHelpTopic(tabId) {
  return SETTINGS_TAB_HELP[tabId] || 'settings';
}

/** Open Settings → Help scrolled to the given topic's manual section. */
export function openHelp(topic) {
  window.dispatchEvent(
    new CustomEvent(HELP_EVENT, {
      detail: { topic, anchor: topicAnchor(topic) },
    }),
  );
}
