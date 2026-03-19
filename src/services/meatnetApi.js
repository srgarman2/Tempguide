const DEFAULT_BASE_URL = 'https://api.meatnet.com';
const DEFAULT_POLL_MS = 3000;

const runtimeEnv = typeof import.meta !== 'undefined' ? import.meta.env : {};

export const MEATNET_CONFIG = {
  baseUrl: (runtimeEnv.VITE_MEATNET_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, ''),
  pollMs: Number(runtimeEnv.VITE_MEATNET_POLL_MS ?? DEFAULT_POLL_MS),
};

function withJsonHeaders(token) {
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function parseJsonResponse(response) {
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const err = new Error(body?.message ?? `MeatNet API error (${response.status})`);
    err.status = response.status;
    err.body = body;
    throw err;
  }

  return body;
}

async function request(path, { method = 'GET', token, body, signal } = {}) {
  const response = await fetch(`${MEATNET_CONFIG.baseUrl}${path}`, {
    method,
    headers: withJsonHeaders(token),
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });

  return parseJsonResponse(response);
}

export async function loginWithEmailPassword({ email, password, signal }) {
  return request('/v1/auth/login', {
    method: 'POST',
    body: { email, password },
    signal,
  });
}

export async function exchangeOauthCode({ provider, code, redirectUri, signal }) {
  return request('/v1/auth/oauth/exchange', {
    method: 'POST',
    body: { provider, code, redirectUri },
    signal,
  });
}

export function buildOauthStartUrl({ provider, redirectUri }) {
  const params = new URLSearchParams({ provider, redirect_uri: redirectUri });
  return `${MEATNET_CONFIG.baseUrl}/v1/auth/oauth/start?${params.toString()}`;
}

export async function refreshSession({ refreshToken, signal }) {
  return request('/v1/auth/refresh', {
    method: 'POST',
    body: { refreshToken },
    signal,
  });
}

export async function fetchBridgeDevices({ token, bridgeSource, signal }) {
  const params = new URLSearchParams();
  if (bridgeSource) params.set('source', bridgeSource);
  const suffix = params.toString();
  return request(`/v1/bridges${suffix ? `?${suffix}` : ''}`, { token, signal });
}

export async function fetchLiveTelemetry({ token, bridgeId, bridgeSource, signal }) {
  const params = new URLSearchParams();
  if (bridgeId) params.set('bridgeId', bridgeId);
  if (bridgeSource) params.set('source', bridgeSource);
  const suffix = params.toString();
  return request(`/v1/telemetry/live${suffix ? `?${suffix}` : ''}`, { token, signal });
}
