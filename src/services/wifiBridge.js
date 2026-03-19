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
 * On initial connect the service probes the device to discover which endpoint
 * returns JSON telemetry, then polls that endpoint.
 *
 * Environment overrides:
 *   VITE_WIFI_BRIDGE_POLL_MS — polling interval in ms (default 2000)
 */

const DEFAULT_POLL_MS = 2000;

export const WIFI_BRIDGE_CONFIG = {
  pollMs: Number(import.meta.env.VITE_WIFI_BRIDGE_POLL_MS ?? DEFAULT_POLL_MS),
};

const STORAGE_KEY = 'combustion-wifi-bridge-v1';
const PATH_KEY = 'combustion-wifi-bridge-path-v1';

export function readStoredBridgeAddress() {
  try { return localStorage.getItem(STORAGE_KEY) || ''; } catch { return ''; }
}

export function persistBridgeAddress(address) {
  try {
    if (address) localStorage.setItem(STORAGE_KEY, address);
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* non-fatal */ }
}

export function readStoredBridgePath() {
  try { return localStorage.getItem(PATH_KEY) || ''; } catch { return ''; }
}

export function persistBridgePath(path) {
  try {
    if (path) localStorage.setItem(PATH_KEY, path);
    else localStorage.removeItem(PATH_KEY);
  } catch { /* non-fatal */ }
}

/**
 * Probe the device to discover which endpoint returns usable JSON.
 * Returns an array of { path, status, contentType, body, isJson }.
 */
export async function probeBridge({ address, signal }) {
  const host = address.trim();
  if (!host) throw new Error('No bridge address configured.');

  const response = await fetch(
    `/api/bridge/probe?host=${encodeURIComponent(host)}`,
    { signal, headers: { Accept: 'application/json' } },
  );

  if (!response.ok) {
    throw new Error(`Probe failed with HTTP ${response.status}`);
  }

  const { results } = await response.json();

  return results.map((r) => {
    let isJson = false;
    let parsed = null;
    if (r.status >= 200 && r.status < 300 && r.body) {
      try {
        parsed = JSON.parse(r.body);
        isJson = typeof parsed === 'object' && parsed !== null;
      } catch { /* not JSON */ }
    }
    return { ...r, isJson, parsed };
  });
}

/**
 * Pick the best endpoint from probe results.
 * Prefers a 200 JSON response that looks like telemetry.
 */
export function pickBestEndpoint(probeResults) {
  // Look for JSON responses with temperature-related keys
  const tempKeywords = ['temp', 'sensor', 'probe', 'core', 'surface', 'ambient', 'prediction'];

  const jsonHits = probeResults.filter((r) => r.isJson && r.status === 200);

  // Score each hit by how many temperature-related keys it has
  const scored = jsonHits.map((r) => {
    const keys = Object.keys(r.parsed).join(' ').toLowerCase();
    const score = tempKeywords.reduce((n, kw) => n + (keys.includes(kw) ? 1 : 0), 0);
    return { ...r, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // Return the best match, or the first JSON hit, or null
  return scored[0] ?? jsonHits[0] ?? null;
}

/**
 * Fetch telemetry from a specific device path via the proxy.
 */
export async function fetchBridgeTelemetry({ address, path, signal }) {
  const host = address.trim();
  if (!host) throw new Error('No bridge address configured.');
  if (!path) throw new Error('No bridge endpoint path configured.');

  const url = `/api/bridge/get?host=${encodeURIComponent(host)}&path=${encodeURIComponent(path)}`;

  let response;
  try {
    response = await fetch(url, {
      signal,
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    throw new Error(
      `Network error reaching bridge proxy — make sure the server is running ` +
      `and the Combustion accessory at ${host} is powered on.`
    );
  }

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      if (body?.error) {
        detail = typeof body.error === 'string' ? body.error : JSON.stringify(body.error);
      }
    } catch { /* use status code */ }
    throw new Error(`Bridge error: ${detail}`);
  }

  return response.json();
}
