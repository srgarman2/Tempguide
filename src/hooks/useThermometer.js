/**
 * Combustion Inc. Predictive Thermometer — Web Bluetooth Hook
 *
 * Protocol reference:
 *   https://github.com/combustion-inc/combustion-documentation
 *
 * BLE Service UUIDs:
 *   Probe Status Service:  00000100-CAAB-3792-3D44-97AE51C1407A
 *   Device Status Char:    00000101-CAAB-3792-3D44-97AE51C1407A
 *   UART Service:          6E400001-B5A3-F393-E0A9-E50E24DCCA9E
 *   UART TX (notify):      6E400003-B5A3-F393-E0A9-E50E24DCCA9E
 *
 * Advertising data format (25 bytes manufacturer-specific, vendor ID 0x09C7):
 *   Bytes 7–19: 13 bytes = 104 bits = 8 thermistors × 13 bits each
 *   Conversion: temp_celsius = (raw_13bit × 0.05) − 20
 *   Range: −20°C to 369°C, resolution 0.05°C
 *
 * The probe has 8 sensors along its length (T1=tip to T8=near-handle).
 * We display all 8 and treat the minimum as the estimated "core" temp.
 * The predictive algorithm in the real Combustion app is more sophisticated.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { cToF } from '../utils/carryover';

// ── Combustion Inc. BLE constants ───────────────────────────────────────────
const COMBUSTION_VENDOR_ID    = 0x09C7;
const PROBE_STATUS_SERVICE    = '00000100-caab-3792-3d44-97ae51c1407a';
const DEVICE_STATUS_CHAR      = '00000101-caab-3792-3d44-97ae51c1407a';
const UART_SERVICE            = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const UART_TX_CHAR            = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

const NUM_SENSORS = 8;

/**
 * Parse 13 bytes of raw temperature data into 8 sensor readings (°C → °F).
 * Each sensor is 13 bits, packed MSB-first into the 13-byte (104-bit) block.
 *
 * @param {Uint8Array} bytes - 13-byte temperature block (offset 7–19 of adv payload,
 *                             or from Device Status characteristic)
 * @returns {number[]} Array of 8 temperatures in °F
 */
function parseTemperatureBytes(bytes) {
  const temps = [];
  let bitOffset = 0;

  for (let i = 0; i < NUM_SENSORS; i++) {
    // Extract 13 bits starting at bitOffset
    const byteIndex = Math.floor(bitOffset / 8);
    const bitShift = bitOffset % 8;

    // Build a 16-bit window then mask to 13 bits
    const b0 = bytes[byteIndex]     ?? 0;
    const b1 = bytes[byteIndex + 1] ?? 0;
    const b2 = bytes[byteIndex + 2] ?? 0;

    const window = (b0 << 16) | (b1 << 8) | b2;
    const raw13 = (window >> (24 - bitShift - 13)) & 0x1FFF;

    const tempC = raw13 * 0.05 - 20.0;
    temps.push(Math.round(cToF(tempC) * 10) / 10);
    bitOffset += 13;
  }
  return temps;
}

/**
 * Parse a Device Status characteristic notification from the Combustion probe.
 * The characteristic payload mirrors the advertising data format.
 *
 * @param {DataView} dataView
 * @returns {{ sensors: number[], mode: number, batteryOk: boolean }}
 */
function parseDeviceStatus(dataView) {
  const bytes = new Uint8Array(dataView.buffer);

  // Layout (roughly mirrors advertising payload but without vendor ID header):
  //  0–3:  serial number
  //  4–16: temperature data (13 bytes, 8 × 13-bit sensors)
  //  17:   mode / probe ID
  //  18:   battery status & virtual sensor flags
  const tempBytes = bytes.slice(4, 17);
  const sensors = parseTemperatureBytes(tempBytes);

  const batteryOk = !!(bytes[18] & 0x80);
  const mode = bytes[17] & 0x0F;

  return { sensors, mode, batteryOk };
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export const THERMOMETER_STATE = {
  IDLE:         'idle',
  SCANNING:     'scanning',
  CONNECTING:   'connecting',
  CONNECTED:    'connected',
  DISCONNECTED: 'disconnected',
  ERROR:        'error',
  UNSUPPORTED:  'unsupported',
};

export default function useThermometer() {
  const [state, setState]           = useState(THERMOMETER_STATE.IDLE);
  const [sensors, setSensors]       = useState(null);   // number[] | null — all 8 sensor temps (°F)
  const [coreTemp, setCoreTemp]     = useState(null);   // number | null — estimated core temp
  const [deviceName, setDeviceName] = useState(null);
  const [batteryOk, setBatteryOk]   = useState(true);
  const [errorMsg, setErrorMsg]     = useState(null);

  const deviceRef    = useRef(null);
  const serverRef    = useRef(null);
  const charRef      = useRef(null);

  // Web Bluetooth availability check
  const isSupported = typeof navigator !== 'undefined' && !!navigator.bluetooth;

  useEffect(() => {
    if (!isSupported) setState(THERMOMETER_STATE.UNSUPPORTED);
  }, [isSupported]);

  const onDisconnect = useCallback(() => {
    setState(THERMOMETER_STATE.DISCONNECTED);
    setSensors(null);
    setCoreTemp(null);
    charRef.current = null;
    serverRef.current = null;
  }, []);

  /**
   * Handle incoming temperature notification from Device Status characteristic.
   */
  const handleNotification = useCallback((event) => {
    try {
      const { sensors: newSensors, batteryOk: batt } = parseDeviceStatus(event.target.value);
      setSensors(newSensors);
      setBatteryOk(batt);

      // Core temp = the coldest sensor reading (deepest in the meat)
      // Filter out sensors that read near ambient (likely exposed to air)
      // A heuristic: sensors within 30°F of each other on the low end
      const sorted = [...newSensors].sort((a, b) => a - b);
      setCoreTemp(sorted[0]); // Tip (T1) = lowest = core when probe is fully inserted
    } catch (e) {
      console.warn('[useThermometer] Failed to parse notification:', e);
    }
  }, []);

  const connect = useCallback(async () => {
    if (!isSupported) {
      setErrorMsg('Web Bluetooth is not supported in this browser. Use Chrome on desktop or Android.');
      setState(THERMOMETER_STATE.UNSUPPORTED);
      return;
    }

    try {
      setState(THERMOMETER_STATE.SCANNING);
      setErrorMsg(null);

      // Request the Combustion device
      const device = await navigator.bluetooth.requestDevice({
        filters: [
          { namePrefix: 'Combustion' },
          { namePrefix: 'Meatnet' },
          // Also match by manufacturer data vendor ID
          { manufacturerData: [{ companyIdentifier: COMBUSTION_VENDOR_ID }] },
        ],
        optionalServices: [PROBE_STATUS_SERVICE, UART_SERVICE],
      });

      deviceRef.current = device;
      setDeviceName(device.name ?? 'Combustion Thermometer');
      setState(THERMOMETER_STATE.CONNECTING);

      device.addEventListener('gattserverdisconnected', onDisconnect);

      const server = await device.gatt.connect();
      serverRef.current = server;

      let char = null;

      // Try primary Probe Status service first
      try {
        const service = await server.getPrimaryService(PROBE_STATUS_SERVICE);
        char = await service.getCharacteristic(DEVICE_STATUS_CHAR);
      } catch {
        // Fall back to UART service
        try {
          const uartService = await server.getPrimaryService(UART_SERVICE);
          char = await uartService.getCharacteristic(UART_TX_CHAR);
        } catch {
          throw new Error('Could not find temperature characteristic. Ensure the probe firmware is up to date.');
        }
      }

      charRef.current = char;
      char.addEventListener('characteristicvaluechanged', handleNotification);
      await char.startNotifications();

      setState(THERMOMETER_STATE.CONNECTED);
    } catch (err) {
      if (err.name === 'NotFoundError') {
        // User cancelled — return to idle
        setState(THERMOMETER_STATE.IDLE);
      } else {
        setErrorMsg(err.message ?? 'Failed to connect to thermometer.');
        setState(THERMOMETER_STATE.ERROR);
      }
    }
  }, [isSupported, handleNotification, onDisconnect]);

  const disconnect = useCallback(async () => {
    if (charRef.current) {
      try {
        charRef.current.removeEventListener('characteristicvaluechanged', handleNotification);
        await charRef.current.stopNotifications();
      } catch { /* ignore */ }
    }
    if (deviceRef.current?.gatt?.connected) {
      deviceRef.current.removeEventListener('gattserverdisconnected', onDisconnect);
      deviceRef.current.gatt.disconnect();
    }
    deviceRef.current = null;
    serverRef.current = null;
    charRef.current   = null;
    setState(THERMOMETER_STATE.IDLE);
    setSensors(null);
    setCoreTemp(null);
  }, [handleNotification, onDisconnect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { disconnect(); };
  }, [disconnect]);

  return {
    state,
    sensors,       // All 8 sensor readings in °F (or null)
    coreTemp,      // Estimated core temperature in °F (or null)
    deviceName,
    batteryOk,
    errorMsg,
    isSupported,
    connect,
    disconnect,
  };
}
