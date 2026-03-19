import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BRIDGE_SOURCE,
  BRIDGE_SOURCE_LABEL,
  THERMOMETER_STATE,
  THERMOMETER_TRANSPORT,
} from '../constants/thermometer';
import {
  MEATNET_CONFIG,
  buildOauthStartUrl,
  exchangeOauthCode,
  fetchBridgeDevices,
  fetchLiveTelemetry,
  loginWithEmailPassword,
  refreshSession,
} from '../services/meatnetApi';

const STORAGE_KEY = 'meatnet-session-v1';

function readStoredSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.accessToken ? parsed : null;
  } catch {
    return null;
  }
}

function persistSession(session) {
  if (!session) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function clampIndex(index, values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  if (typeof index !== 'number' || Number.isNaN(index)) return null;
  return Math.max(0, Math.min(values.length - 1, index));
}

function mapTelemetryToThermoState(payload) {
  const sensors = Array.isArray(payload?.sensorGradientF)
    ? payload.sensorGradientF
    : Array.isArray(payload?.sensorsF)
      ? payload.sensorsF
      : null;

  const coreIdx = clampIndex(payload?.virtualCoreIndex, sensors);
  const surfaceIdx = clampIndex(payload?.virtualSurfaceIndex, sensors);
  const ambientIdx = clampIndex(payload?.virtualAmbientIndex, sensors);

  const coreTemp = payload?.coreTempF ?? (coreIdx != null ? sensors?.[coreIdx] : null);
  const surfaceTemp = payload?.surfaceTempF ?? (surfaceIdx != null ? sensors?.[surfaceIdx] : null);
  const ambientTemp = payload?.ambientTempF ?? (ambientIdx != null ? sensors?.[ambientIdx] : null);

  return {
    sensors,
    coreTemp: coreTemp ?? null,
    surfaceTemp: surfaceTemp ?? null,
    ambientTemp: ambientTemp ?? null,
    predictedCoreTemp: payload?.prediction?.estimatedCoreTempF ?? payload?.predictedCoreTempF ?? null,
    virtualCoreIndex: coreIdx ?? 0,
    virtualSurfaceIndex: surfaceIdx,
    virtualAmbientIndex: ambientIdx,
    isInstantRead: !!payload?.isInstantRead,
    batteryOk: payload?.batteryOk ?? true,
    deviceName: payload?.probeName ?? payload?.deviceName ?? 'MeatNet Cloud',
    cloudBridgeId: payload?.bridgeId ?? null,
    cloudBridgeSource: payload?.bridgeSource ?? null,
    prediction: payload?.prediction ?? null,
    lastUpdateIso: payload?.timestamp ?? new Date().toISOString(),
  };
}

function isLikelyIos() {
  return /iPad|iPhone|iPod/i.test(navigator.userAgent);
}

export default function useMeatNetCloud() {
  const initialSession = useMemo(() => readStoredSession(), []);

  const [state, setState] = useState(initialSession ? THERMOMETER_STATE.DISCONNECTED : THERMOMETER_STATE.IDLE);
  const [errorMsg, setErrorMsg] = useState(null);
  const [authState, setAuthState] = useState(initialSession ? 'authenticated' : 'signed-out');
  const [session, setSession] = useState(initialSession);
  const [bridgeSource, setBridgeSource] = useState(BRIDGE_SOURCE.WIFI_ACCESSORY);
  const [bridgeDevices, setBridgeDevices] = useState([]);
  const [selectedBridgeId, setSelectedBridgeId] = useState(null);

  const [sensors, setSensors] = useState(null);
  const [coreTemp, setCoreTemp] = useState(null);
  const [surfaceTemp, setSurfaceTemp] = useState(null);
  const [ambientTemp, setAmbientTemp] = useState(null);
  const [predictedCoreTemp, setPredictedCoreTemp] = useState(null);
  const [virtualCoreIndex, setVirtualCoreIndex] = useState(0);
  const [virtualSurfaceIndex, setVirtualSurfaceIndex] = useState(null);
  const [virtualAmbientIndex, setVirtualAmbientIndex] = useState(null);
  const [isInstantRead, setIsInstantRead] = useState(false);
  const [deviceName, setDeviceName] = useState(null);
  const [batteryOk, setBatteryOk] = useState(true);
  const [lastUpdateIso, setLastUpdateIso] = useState(null);

  const pollRef = useRef(null);
  const refreshPromiseRef = useRef(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const clearTelemetry = useCallback(() => {
    setSensors(null);
    setCoreTemp(null);
    setSurfaceTemp(null);
    setAmbientTemp(null);
    setPredictedCoreTemp(null);
    setVirtualCoreIndex(0);
    setVirtualSurfaceIndex(null);
    setVirtualAmbientIndex(null);
    setIsInstantRead(false);
    setBatteryOk(true);
    setDeviceName(null);
    setLastUpdateIso(null);
  }, []);

  const applyTelemetryPayload = useCallback((payload) => {
    const mapped = mapTelemetryToThermoState(payload);
    setSensors(mapped.sensors);
    setCoreTemp(mapped.coreTemp);
    setSurfaceTemp(mapped.surfaceTemp);
    setAmbientTemp(mapped.ambientTemp);
    setPredictedCoreTemp(mapped.predictedCoreTemp);
    setVirtualCoreIndex(mapped.virtualCoreIndex);
    setVirtualSurfaceIndex(mapped.virtualSurfaceIndex);
    setVirtualAmbientIndex(mapped.virtualAmbientIndex);
    setIsInstantRead(mapped.isInstantRead);
    setBatteryOk(mapped.batteryOk);
    setDeviceName(mapped.deviceName);
    setLastUpdateIso(mapped.lastUpdateIso);
    if (mapped.cloudBridgeSource) {
      setBridgeSource(mapped.cloudBridgeSource);
    }
  }, []);

  const resolveAccessToken = useCallback(async () => {
    if (!session?.accessToken) return null;

    const expiresAt = session.expiresAt ? Date.parse(session.expiresAt) : null;
    const almostExpired = expiresAt && expiresAt - Date.now() < 30_000;

    if (!almostExpired || !session.refreshToken) {
      return session.accessToken;
    }

    if (!refreshPromiseRef.current) {
      refreshPromiseRef.current = refreshSession({ refreshToken: session.refreshToken })
        .then((nextSession) => {
          setSession(nextSession);
          persistSession(nextSession);
          setAuthState('authenticated');
          return nextSession.accessToken;
        })
        .catch((err) => {
          setAuthState('signed-out');
          setSession(null);
          persistSession(null);
          throw err;
        })
        .finally(() => {
          refreshPromiseRef.current = null;
        });
    }

    return refreshPromiseRef.current;
  }, [session]);

  const pullTelemetry = useCallback(async () => {
    const token = await resolveAccessToken();
    if (!token) {
      setState(THERMOMETER_STATE.IDLE);
      return;
    }

    const payload = await fetchLiveTelemetry({
      token,
      bridgeId: selectedBridgeId,
      bridgeSource,
    });
    applyTelemetryPayload(payload);
    setState(THERMOMETER_STATE.CONNECTED);
    setErrorMsg(null);
  }, [applyTelemetryPayload, bridgeSource, resolveAccessToken, selectedBridgeId]);

  const loadBridgeDevices = useCallback(async () => {
    const token = await resolveAccessToken();
    if (!token) return;
    const payload = await fetchBridgeDevices({ token, bridgeSource });
    const devices = Array.isArray(payload?.bridges) ? payload.bridges : [];
    setBridgeDevices(devices);
    if (!selectedBridgeId && devices[0]?.id) {
      setSelectedBridgeId(devices[0].id);
    }
  }, [bridgeSource, resolveAccessToken, selectedBridgeId]);

  const loginEmail = useCallback(async ({ email, password }) => {
    try {
      setAuthState('authenticating');
      setErrorMsg(null);
      const nextSession = await loginWithEmailPassword({ email, password });
      setSession(nextSession);
      persistSession(nextSession);
      setAuthState('authenticated');
      setState(THERMOMETER_STATE.DISCONNECTED);
    } catch (err) {
      setAuthState('error');
      setErrorMsg(err.message ?? 'Unable to sign in to MeatNet Cloud.');
      return false;
    }

    // Bridge loading is non-fatal — don't roll back a successful login
    try {
      await loadBridgeDevices();
    } catch {
      // Errors will surface when user starts streaming
    }
    return true;
  }, [loadBridgeDevices]);

  const beginOauthLogin = useCallback((provider) => {
    const redirectUri = `${window.location.origin}${window.location.pathname}`;
    const url = buildOauthStartUrl({ provider, redirectUri });
    window.location.assign(url);
  }, []);

  const loginGoogle = useCallback(() => {
    beginOauthLogin('google');
  }, [beginOauthLogin]);

  const loginApple = useCallback(() => {
    beginOauthLogin('apple');
  }, [beginOauthLogin]);

  const consumeOauthCallback = useCallback(async () => {
    const currentUrl = new URL(window.location.href);
    const code = currentUrl.searchParams.get('code');
    const provider = currentUrl.searchParams.get('provider');

    if (!code || !provider) return;

    try {
      setAuthState('authenticating');
      const redirectUri = `${window.location.origin}${window.location.pathname}`;
      const nextSession = await exchangeOauthCode({ provider, code, redirectUri });
      setSession(nextSession);
      persistSession(nextSession);
      setAuthState('authenticated');
      setState(THERMOMETER_STATE.DISCONNECTED);
      setErrorMsg(null);
    } catch (err) {
      setAuthState('error');
      setErrorMsg(err.message ?? 'OAuth sign-in failed.');
    }

    // Bridge loading is non-fatal after successful OAuth
    try {
      await loadBridgeDevices();
    } catch {
      // Errors will surface when user starts streaming
    }

    currentUrl.searchParams.delete('code');
    currentUrl.searchParams.delete('provider');
    window.history.replaceState({}, '', currentUrl.toString());
  }, [loadBridgeDevices]);

  const connect = useCallback(async () => {
    if (!session?.accessToken) {
      setState(THERMOMETER_STATE.IDLE);
      setErrorMsg('Sign in to MeatNet Cloud before connecting.');
      return;
    }

    try {
      setState(THERMOMETER_STATE.CONNECTING);
      await loadBridgeDevices();
      await pullTelemetry();
      stopPolling();
      pollRef.current = setInterval(() => {
        pullTelemetry().catch((err) => {
          setState(THERMOMETER_STATE.ERROR);
          setErrorMsg(err.message ?? 'Cloud telemetry update failed.');
        });
      }, MEATNET_CONFIG.pollMs);
    } catch (err) {
      setState(THERMOMETER_STATE.ERROR);
      setErrorMsg(err.message ?? 'Failed to connect to MeatNet Cloud.');
    }
  }, [loadBridgeDevices, pullTelemetry, session?.accessToken, stopPolling]);

  const disconnect = useCallback(() => {
    stopPolling();
    setState(THERMOMETER_STATE.DISCONNECTED);
    clearTelemetry();
  }, [clearTelemetry, stopPolling]);

  const logout = useCallback(() => {
    stopPolling();
    clearTelemetry();
    setSession(null);
    persistSession(null);
    setAuthState('signed-out');
    setBridgeDevices([]);
    setSelectedBridgeId(null);
    setState(THERMOMETER_STATE.IDLE);
    setErrorMsg(null);
  }, [clearTelemetry, stopPolling]);

  useEffect(() => {
    consumeOauthCallback();
  }, [consumeOauthCallback]);

  useEffect(() => {
    if (session?.accessToken) {
      setAuthState('authenticated');
      loadBridgeDevices().catch(() => {
        // Non-fatal during startup; real errors are surfaced when connecting.
      });
    }
  }, [loadBridgeDevices, session?.accessToken]);

  useEffect(() => {
    if (!session?.accessToken) return;
    setSelectedBridgeId(null);
    loadBridgeDevices().catch(() => {
      // Errors surface when user starts cloud streaming.
    });
  }, [bridgeSource, loadBridgeDevices, session?.accessToken]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  return {
    transport: THERMOMETER_TRANSPORT.CLOUD,
    state,
    sensors,
    coreTemp,
    surfaceTemp,
    ambientTemp,
    predictedCoreTemp,
    virtualCoreIndex,
    virtualSurfaceIndex,
    virtualAmbientIndex,
    isInstantRead,
    deviceName,
    batteryOk,
    errorMsg,
    isSupported: true,
    connect,
    disconnect,
    authState,
    isAuthenticated: authState === 'authenticated',
    loginEmail,
    loginGoogle,
    loginApple,
    logout,
    bridgeSource,
    setBridgeSource,
    bridgeSourceLabel: BRIDGE_SOURCE_LABEL[bridgeSource] ?? 'Bridge',
    bridgeDevices,
    selectedBridgeId,
    setSelectedBridgeId,
    supportsAppleSignIn: isLikelyIos(),
    lastUpdateIso,
    cloudPollMs: MEATNET_CONFIG.pollMs,
  };
}
