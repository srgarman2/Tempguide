import { useCallback, useEffect, useRef, useState } from 'react';
import { THERMOMETER_STATE, THERMOMETER_TRANSPORT } from '../constants/thermometer';
import {
  WIFI_BRIDGE_CONFIG,
  fetchBridgeTelemetry,
  probeBridge,
  pickBestEndpoint,
  readStoredBridgeAddress,
  persistBridgeAddress,
  readStoredBridgePath,
  persistBridgePath,
} from '../services/wifiBridge';

/**
 * Map the WiFi bridge's JSON payload into the same shape the rest of the app
 * consumes from the BLE hook. Tolerates multiple possible field names so it
 * works with Combustion's WiFi Booster, Display, and Giant Grill Gauge firmware.
 */
function mapBridgePayload(payload) {
  const sensors = Array.isArray(payload?.temperatures)
    ? payload.temperatures
    : Array.isArray(payload?.sensorsF)
      ? payload.sensorsF
      : Array.isArray(payload?.sensorGradientF)
        ? payload.sensorGradientF
        : null;

  function clamp(idx) {
    if (!Array.isArray(sensors) || sensors.length === 0) return null;
    if (typeof idx !== 'number' || Number.isNaN(idx)) return null;
    return Math.max(0, Math.min(sensors.length - 1, idx));
  }

  const coreIdx = clamp(payload?.virtualCoreIndex);
  const surfaceIdx = clamp(payload?.virtualSurfaceIndex);
  const ambientIdx = clamp(payload?.virtualAmbientIndex);

  return {
    sensors,
    coreTemp: payload?.coreTempF ?? (coreIdx != null ? sensors?.[coreIdx] : null) ?? null,
    surfaceTemp: payload?.surfaceTempF ?? (surfaceIdx != null ? sensors?.[surfaceIdx] : null) ?? null,
    ambientTemp: payload?.ambientTempF ?? (ambientIdx != null ? sensors?.[ambientIdx] : null) ?? null,
    predictedCoreTemp: payload?.prediction?.estimatedCoreTempF ?? payload?.predictedCoreTempF ?? null,
    virtualCoreIndex: coreIdx ?? 0,
    virtualSurfaceIndex: surfaceIdx,
    virtualAmbientIndex: ambientIdx,
    isInstantRead: !!payload?.isInstantRead,
    batteryOk: payload?.batteryOk ?? true,
    deviceName: payload?.probeName ?? payload?.deviceName ?? 'WiFi Bridge',
  };
}

export default function useWifiBridge() {
  const [bridgeAddress, setBridgeAddressRaw] = useState(() => readStoredBridgeAddress());
  const [bridgePath, setBridgePathRaw] = useState(() => readStoredBridgePath());
  const [state, setState] = useState(THERMOMETER_STATE.IDLE);
  const [errorMsg, setErrorMsg] = useState(null);
  const [probeResults, setProbeResults] = useState(null);

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
  const consecutiveErrors = useRef(0);

  const setBridgeAddress = useCallback((addr) => {
    setBridgeAddressRaw(addr);
    persistBridgeAddress(addr);
  }, []);

  const setBridgePath = useCallback((p) => {
    setBridgePathRaw(p);
    persistBridgePath(p);
  }, []);

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

  const applyPayload = useCallback((payload) => {
    const m = mapBridgePayload(payload);
    setSensors(m.sensors);
    setCoreTemp(m.coreTemp);
    setSurfaceTemp(m.surfaceTemp);
    setAmbientTemp(m.ambientTemp);
    setPredictedCoreTemp(m.predictedCoreTemp);
    setVirtualCoreIndex(m.virtualCoreIndex);
    setVirtualSurfaceIndex(m.virtualSurfaceIndex);
    setVirtualAmbientIndex(m.virtualAmbientIndex);
    setIsInstantRead(m.isInstantRead);
    setBatteryOk(m.batteryOk);
    setDeviceName(m.deviceName);
    setLastUpdateIso(new Date().toISOString());
  }, []);

  const pullOnce = useCallback(async (pathOverride) => {
    const usePath = pathOverride || bridgePath;
    const payload = await fetchBridgeTelemetry({ address: bridgeAddress, path: usePath });
    applyPayload(payload);
    consecutiveErrors.current = 0;
    setState(THERMOMETER_STATE.CONNECTED);
    setErrorMsg(null);
  }, [applyPayload, bridgeAddress, bridgePath]);

  const connect = useCallback(async () => {
    if (!bridgeAddress.trim()) {
      setErrorMsg('Enter the IP address or hostname of your Combustion WiFi bridge.');
      setState(THERMOMETER_STATE.IDLE);
      return;
    }

    try {
      setState(THERMOMETER_STATE.CONNECTING);
      setErrorMsg(null);
      consecutiveErrors.current = 0;

      // Discover the right endpoint on the device
      let activePath = bridgePath;

      const results = await probeBridge({ address: bridgeAddress });
      setProbeResults(results);

      const best = pickBestEndpoint(results);

      if (best) {
        activePath = best.path;
        setBridgePath(activePath);
      } else if (!activePath) {
        // No JSON endpoint found — build a diagnostic summary
        const summary = results
          .filter((r) => r.status > 0)
          .map((r) => `${r.path} → ${r.status}`)
          .join(', ');
        throw new Error(
          `Could not find a JSON telemetry endpoint on ${bridgeAddress}. ` +
          `Probed paths: ${summary || 'none responded'}. ` +
          `The device may not expose an HTTP API.`
        );
      }

      await pullOnce(activePath);

      stopPolling();
      pollRef.current = setInterval(() => {
        pullOnce(activePath).catch((err) => {
          consecutiveErrors.current += 1;
          if (consecutiveErrors.current >= 5) {
            stopPolling();
            setState(THERMOMETER_STATE.ERROR);
            setErrorMsg(`Lost connection to bridge: ${err.message}`);
          }
        });
      }, WIFI_BRIDGE_CONFIG.pollMs);
    } catch (err) {
      setState(THERMOMETER_STATE.ERROR);
      setErrorMsg(err.message ?? 'Failed to connect to WiFi bridge.');
    }
  }, [bridgeAddress, bridgePath, pullOnce, setBridgePath, stopPolling]);

  const disconnect = useCallback(() => {
    stopPolling();
    consecutiveErrors.current = 0;
    setState(THERMOMETER_STATE.DISCONNECTED);
    clearTelemetry();
  }, [clearTelemetry, stopPolling]);

  // Clean up on unmount
  useEffect(() => () => stopPolling(), [stopPolling]);

  return {
    transport: THERMOMETER_TRANSPORT.WIFI,
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
    bridgeAddress,
    setBridgeAddress,
    bridgePath,
    setBridgePath,
    probeResults,
    lastUpdateIso,
  };
}
