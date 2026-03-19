/**
 * Combustion WiFi Bridge — Local Network Client
 *
 * Connects to a Combustion WiFi accessory (Booster, Display, Giant Grill Gauge)
 * on the local network. The accessory handles BLE↔WiFi bridging — no cloud,
 * no auth, no Bluetooth range issues. Any device on the same WiFi can poll.
 *
 * In development, requests are proxied through the Vite dev server
 * (/api/bridge/data?host=<ip>) to avoid browser CORS restrictions.
 * In production, the app fetches directly from http://<ip>/data — which
 * requires the Combustion device to return CORS headers, or the app to be
 * served from the same origin / behind a reverse proxy.
 *
 * Environment overrides:
 *   VITE_WIFI_BRIDGE_POLL_MS — polling interval in ms (default 2000)
 */

const DEFAULT_POLL_MS = 2000;
const IS_DEV = import.meta.env.DEV;

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
 * Dev  → /api/bridge/data?host=192.168.0.145  (same-origin, proxied by Vite)
 * Prod → http://192.168.0.145/data             (direct, needs CORS headers)
 */
function bridgeDataUrl(address) {
  const host = address.trim();
  if (!host) return '';

  if (IS_DEV) {
    return `/api/bridge/data?host=${encodeURIComponent(host)}`;
  }

  let base = host;
  if (!/^https?:\/\//i.test(base)) base = `http://${base}`;
  return `${base.replace(/\/+$/, '')}/data`;
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
    // Distinguish CORS / mixed-content from genuine network errors
    if (err instanceof TypeError) {
      const onHttps = globalThis.location?.protocol === 'https:';
      if (onHttps) {
        throw new Error(
          `Mixed-content blocked: this page is served over HTTPS but the ` +
          `bridge is on plain HTTP. Open the app over HTTP instead, or ` +
          `place a reverse proxy in front of the bridge.`
        );
      }
      throw new Error(
        `Network error reaching ${address} — this is usually caused by ` +
        `CORS restrictions. Make sure the Combustion accessory is powered on ` +
        `and reachable at http://${address.trim()}/data.`
      );
    }
    throw err;
  }

  if (!response.ok) {
    throw new Error(`Bridge responded with HTTP ${response.status}`);
  }

  return response.json();
}
