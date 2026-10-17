/**
 * aprsMessageSend — the one client-side path for transmitting an APRS
 * message through the local TNC.
 *
 * Directly to the Rig Bridge this browser uses (POST <rigUrl>/aprs/message),
 * or, without a direct bridge (Cloud Relay, rig control off), POST
 * /api/aprs/message → server → rig-bridge APRS TNC plugin on localhost:5555.
 * Used by the EmComm layout's MSG composer.
 */
const APRS_MSG_MAX = 67; // APRS message text limit

/**
 * The Rig Bridge base URL to transmit through directly, or null to go via
 * the server. Direct whenever this browser talks to Rig Bridge itself (rig
 * control on, not Cloud Relay): the server only knows localhost:5555, so a
 * bridge on another port or another machine never got the message (#1243).
 */
export function directRigUrl(rig) {
  if (!rig || !rig.enabled || rig.isCloudRelay || !rig.rigUrl) return null;
  return String(rig.rigUrl).replace(/\/+$/, '');
}

async function errorFrom(res, prefix = '') {
  let error = `HTTP ${res?.status ?? '?'}`;
  try {
    const body = await res.json();
    if (body?.error) error = body.error;
  } catch {
    /* non-JSON error body */
  }
  return prefix + error;
}

/**
 * Send one APRS message.
 * With `rigUrl` the message goes straight to that Rig Bridge's APRS TNC
 * plugin, and the server is then told (record only) so the station's
 * message history keeps our side; without it, the server relays it.
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function sendAprsMessage({ to, message, rigUrl = null }, fetchImpl = globalThis.fetch) {
  const addressee = String(to || '')
    .trim()
    .toUpperCase();
  const text = String(message || '').trim();
  if (!addressee || !text) return { ok: false, error: 'Missing addressee or message' };
  if (text.length > APRS_MSG_MAX) return { ok: false, error: `Message exceeds ${APRS_MSG_MAX} characters` };
  const body = JSON.stringify({ to: addressee, message: text });
  try {
    if (rigUrl) {
      const res = await fetchImpl(`${rigUrl}/aprs/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      if (!res?.ok) return { ok: false, error: await errorFrom(res, 'Rig Bridge: ') };
      // History only — a failure here must not report the transmission as failed
      fetchImpl('/api/aprs/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: addressee, message: text, recordOnly: true }),
      }).catch?.(() => {});
      return { ok: true };
    }
    const res = await fetchImpl('/api/aprs/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (res?.ok) return { ok: true };
    return { ok: false, error: await errorFrom(res) };
  } catch (e) {
    return {
      ok: false,
      error: rigUrl ? `Rig Bridge not reachable at ${rigUrl}` : e?.message || 'Network error',
    };
  }
}
