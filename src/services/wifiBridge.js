/**
 * Combustion WiFi Bridge — Local Network Client
 *
 * Connects to a Combustion WiFi accessory (Booster, Display, Giant Grill Gauge)
 * on the local network. The accessory handles BLE↔WiFi bridging — no cloud,
 * no auth, no Bluetooth range issues. Any device on the same WiFi can poll.
 *
 * The user provides the bridge's LAN address (IP or hostname). The app polls
 * the accessory's local HTTP endpoint for live telemetry at a configurable interval.
 *
 * Environment overrides:
 *   VITE_WIFI_BRIDGE_POLL_MS — polling interval in ms (default 2000)
 */

const DEFAULT_POLL_MS = 2000;

const runtimeEnv = typeof import.meta !== 'undefined' ? import.meta.env : {};

export const WIFI_BRIDGE_CONFIG = {
  pollMs: Number(runtimeEnv.VITE_WIFI_BRIDGE_POLL_MS ?? DEFAULT_POLL_MS),
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

function normalizeBridgeUrl(address) {
  let url = address.trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url.replace(/\/+$/, '');
}

export async function fetchBridgeTelemetry({ address, signal }) {
  const base = normalizeBridgeUrl(address);
  if (!base) throw new Error('No bridge address configured.');

  const response = await fetch(`${base}/data`, {
    signal,
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Bridge responded with ${response.status}`);
  }

  return response.json();
}

export async function pingBridge({ address, signal }) {
  const base = normalizeBridgeUrl(address);
  if (!base) throw new Error('No bridge address configured.');

  const controller = signal ? undefined : new AbortController();
  const timeout = signal ? undefined : setTimeout(() => controller.abort(), 4000);

  try {
    const response = await fetch(`${base}/data`, {
      signal: signal ?? controller.signal,
      headers: { Accept: 'application/json' },
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
