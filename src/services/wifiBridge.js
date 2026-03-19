/**
 * Combustion WiFi Bridge — Local Network Client
 *
 * Connects to a Combustion WiFi accessory (Booster, Display, Giant Grill Gauge)
 * on the local network. The accessory handles BLE↔WiFi bridging — no cloud,
 * no auth, no Bluetooth range issues. Any device on the same WiFi can poll.
 *
 * All bridge requests go through a same-origin proxy at /api/bridge/* to avoid
 * browser CORS and mixed-content restrictions. In dev mode, the Vite plugin
 * handles the proxy; in production, server.js handles it.
 *
 * Environment overrides:
 *   VITE_WIFI_BRIDGE_POLL_MS — polling interval in ms (default 2000)
 */

const DEFAULT_POLL_MS = 2000;

export const WIFI_BRIDGE_CONFIG = {
  pollMs: Number(import.meta.env.VITE_WIFI_BRIDGE_POLL_MS ?? DEFAULT_POLL_MS),
};

const STORAGE_KEY = 'combustion-wifi-bridge-v1';

export function readStoredBridgeAddress() {
  try {
    return localStorage.getItem(STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function persistBridgeAddress(address) {
  try {
    if (address) {
      localStorage.setItem(STORAGE_KEY, address);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Storage unavailable — non-fatal
  }
}

/**
 * Build the URL to fetch bridge telemetry.
 * Always uses the same-origin proxy: /api/bridge/data?host=<ip>
 */
function bridgeDataUrl(address) {
  const host = address.trim();
  if (!host) return '';
  return `/api/bridge/data?host=${encodeURIComponent(host)}`;
}

export async function fetchBridgeTelemetry({ address, signal }) {
  const url = bridgeDataUrl(address);
  if (!url) throw new Error('No bridge address configured.');

  let response;
  try {
    response = await fetch(url, {
      signal,
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    throw new Error(
      `Network error reaching bridge proxy — make sure the server is running ` +
      `and the Combustion accessory at ${address.trim()} is powered on.`
    );
  }

  if (!response.ok) {
    // The proxy returns JSON { error: "..." } on failure
    let detail = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      if (body?.error) {
        detail = typeof body.error === 'string' ? body.error : JSON.stringify(body.error);
      }
    } catch { /* use status code */ }
    throw new Error(`Bridge error: ${detail}`);
  }

  const data = await response.json();
  if (data == null || typeof data !== 'object') {
    throw new Error('Bridge returned unexpected data (not JSON).');
  }
  return data;
}
