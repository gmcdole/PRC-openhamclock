'use strict';
/**
 * SSRF helpers — shared between route modules that make outbound HTTP/TCP connections
 * based on caller-supplied hostnames (DX cluster, rig-bridge status, etc.).
 *
 * validateCustomHost resolves a hostname to its first IPv4 address and returns it so
 * callers connect to the resolved IP directly, preventing DNS-rebinding TOCTOU attacks
 * where the DNS record changes between validation and the actual connection.
 */

const dns = require('dns');

function isPrivateIP(ip) {
  // Normalize IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 → 127.0.0.1)
  const normalized = ip.replace(/^::ffff:/i, '');

  const parts = normalized.split('.').map(Number);
  if (parts.length === 4 && parts.every((n) => n >= 0 && n <= 255)) {
    if (parts[0] === 127) return true; // loopback
    if (parts[0] === 10) return true; // 10.0.0.0/8
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16.0.0/12
    if (parts[0] === 192 && parts[1] === 168) return true; // 192.168.0.0/16
    if (parts[0] === 169 && parts[1] === 254) return true; // link-local
    if (parts[0] === 0) return true; // 0.0.0.0/8
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true; // 100.64.0.0/10 CGNAT
    if (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) return true; // 198.18.0.0/15 benchmarking
    if (parts[0] >= 224) return true; // multicast + reserved
  }

  const lower = normalized.toLowerCase();
  if (
    lower === '::1' ||
    lower === '::' ||
    /^fe[89ab][0-9a-f]:/.test(lower) || // fe80::/10 link-local
    /^f[cd][0-9a-f]{2}:/.test(lower) || // fc00::/7 unique local
    /^ff[0-9a-f]{2}:/.test(lower) || // ff00::/8 multicast
    lower.startsWith('::ffff:')
  ) {
    return true;
  }
  return false;
}

/**
 * Validate a caller-supplied hostname for outbound connections.
 *
 * Self-hosted (the default, allowPrivate: true): localhost and bare IP literals
 * (including RFC-1918 ranges) are allowed — connecting to local services is the norm.
 *
 * Multi-user hosted servers pass allowPrivate: false, which refuses localhost,
 * private/reserved IP literals and any name that resolves to one (every address
 * is checked, not just the first), so a caller can't make the server reach its
 * own internal network.
 *
 * Returns { ok: true, resolvedIP } or { ok: false, reason }.
 */
const PRIVATE_REFUSED = 'Local and private network addresses are not allowed on this server';

async function validateCustomHost(host, { allowPrivate = true } = {}) {
  if (/^localhost$/i.test(host)) {
    return allowPrivate ? { ok: true, resolvedIP: '127.0.0.1' } : { ok: false, reason: PRIVATE_REFUSED };
  }

  // Bare IPv4 literal — allow directly without DNS lookup
  const ipParts = host.split('.').map(Number);
  if (ipParts.length === 4 && ipParts.every((n) => n >= 0 && n <= 255)) {
    if (!allowPrivate && isPrivateIP(host)) return { ok: false, reason: PRIVATE_REFUSED };
    return { ok: true, resolvedIP: host };
  }

  // Resolve hostname → IPv4. Try resolve4 first (pure DNS), fall back to OS resolver
  // which also handles /etc/hosts and search domains.
  let addresses;
  try {
    addresses = await dns.promises.resolve4(host);
  } catch {
    try {
      const result = await dns.promises.lookup(host, { family: 4 });
      if (result?.address) addresses = [result.address];
    } catch {
      return { ok: false, reason: 'Host could not be resolved (IPv4 required)' };
    }
  }

  if (!addresses || addresses.length === 0) {
    return { ok: false, reason: 'Host did not resolve to any IPv4 address' };
  }
  if (!allowPrivate && addresses.some(isPrivateIP)) return { ok: false, reason: PRIVATE_REFUSED };

  return { ok: true, resolvedIP: addresses[0] };
}

module.exports = { isPrivateIP, validateCustomHost };
