/**
 * Display helper for the device identified from an APRS packet's tocall or
 * Mic-E type code (server/utils/aprsDeviceId.js). `device` is
 * { vendor?, model?, class?, shown? } or null.
 */
export function formatAprsDevice(device) {
  if (!device) return '';
  const vendor = String(device.vendor || '').trim();
  const model = String(device.model || '').trim();
  if (vendor && model) return model.toUpperCase().startsWith(vendor.toUpperCase()) ? model : `${vendor} ${model}`;
  return model || vendor || (device.shown ? String(device.shown) : '');
}
