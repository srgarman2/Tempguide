/**
 * Combustion Inc. Predictive Thermometer — Web Bluetooth Hook
 *
 * Protocol reference:
 *   https://github.com/combustion-inc/combustion-documentation
 *
 * Supports two connection paths:
 *
 * PATH A — Direct Probe (Probe Status Service):
 *   Probe Status Service:  00000100-CAAB-3792-3D44-97AE51C1407A
 *   Device Status Char:    00000101-CAAB-3792-3D44-97AE51C1407A
 *   Notifications are raw Device Status bytes (no framing header).
 *
 * PATH B — MeatNet Node / Giant Grill Gauge (UART Service):
 *   UART Service:  6E400001-B5A3-F393-E0A9-E50E24DCCA9E
 *   UART RX:       6E400002-B5A3-F393-E0A9-E50E24DCCA9E  (Write — send commands)
 *   UART TX:       6E400003-B5A3-F393-E0A9-E50E24DCCA9E  (Read/Notify — receive data)
 *   Notifications are UART-framed messages (see parseUARTFrame).
 *   Message 0x45 (Probe Status) — relayed 8-sensor probe data.
 *   Message 0x60 (Gauge Status) — GGG's own RTD grill temperature.
 *
 * UART Response/Notification Frame (15-byte header):
 *   Bytes  0–1:  Sync { 0xCA, 0xFE }
 *   Bytes  2–3:  CRC-16-CCITT (poly 0x1021, init 0xFFFF) over bytes[4..end]
 *   Byte     4:  Message type | 0x80 (high bit = response/notification)
 *   Bytes  5–8:  Request ID
 *   Bytes 9–12:  Response ID
 *   Byte    13:  Success (1 = ok)
 *   Byte    14:  Payload length
 *   Bytes  15+:  Payload
 *
 * Probe Status (0x45) payload[4:] is byte-for-byte identical to the Device Status
 * Char layout, so parseDeviceStatus() is reused with a shifted DataView.
 *
 * Gauge Status (0x60) payload[16:18] = 13-bit RTD (0.1°C/step, range −20 to 799°C).
 *
 * Advertising data format (25 bytes manufacturer-specific, vendor ID 0x09C7):
 *   Bytes 7–19: 13 bytes = 104 bits = 8 thermistors × 13 bits each (LSB-first / LE packed)
 *   Conversion: temp_celsius = (raw_13bit × 0.05) − 20
 *   Range: −20°C to 369°C, resolution 0.05°C
 *
 * Device Status characteristic layout:
 *   Bytes 0–7:   Log range (min/max sequence numbers)
 *   Bytes 8–20:  Raw temperature data (13 bytes, same LE packing as advertising)
 *   Byte  21:    Mode / color / probe ID
 *   Byte  22:    Battery status (bit 0) + Virtual Sensor IDs (bits 1–7)
 *   Bytes 23–29: Prediction status (7 bytes)
 *
 * The probe has 8 sensors along its length (T1=tip to T8=near-handle).
 * Combustion's firmware dynamically identifies which sensor is the true thermal
 * center via the Virtual Core Sensor ID in byte 22. T1 is NOT always the core.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { cToF } from '../utils/carryover';
import { THERMOMETER_STATE } from '../constants/thermometer';

// ── Combustion Inc. BLE constants ───────────────────────────────────────────
const COMBUSTION_VENDOR_ID    = 0x09C7;
const PROBE_STATUS_SERVICE    = '00000100-caab-3792-3d44-97ae51c1407a';
const DEVICE_STATUS_CHAR      = '00000101-caab-3792-3d44-97ae51c1407a';
const UART_SERVICE            = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const UART_RX_CHAR            = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const UART_TX_CHAR            = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

// UART message type IDs (strip high bit 0x80 before comparing)
const MSG_PROBE_STATUS = 0x45;  // GGG relays probe data: 8-sensor gradient + virtual IDs
const MSG_GAUGE_STATUS = 0x60;  // GGG's own RTD ambient grill temperature

const NUM_SENSORS = 8;

/**
 * Parse 13 bytes of raw temperature data into 8 sensor readings (°C → °F).
 * Each sensor is 13 bits, packed LSB-first (little-endian) into the 13-byte (104-bit) block.
 *
 * Ref: https://github.com/combustion-inc/combustion-documentation/blob/main/probe_ble_specification.rst
 *   Bits 1–13:  Thermistor 1 (T1, tip)
 *   Bits 14–26: Thermistor 2
 *   ...
 *   Bits 92–104: Thermistor 8 (T8, near handle)
 *
 * @param {Uint8Array} bytes - 13-byte temperature block
 * @returns {number[]} Array of 8 temperatures in °F
 */
function parseTemperatureBytes(bytes) {
  const temps = [];
  let bitOffset = 0;

  for (let i = 0; i < NUM_SENSORS; i++) {
    const byteIndex = Math.floor(bitOffset / 8);
    const bitShift = bitOffset % 8;

    // Build a 24-bit window in LITTLE-ENDIAN order (LSB first)
    const b0 = bytes[byteIndex]     ?? 0;
    const b1 = bytes[byteIndex + 1] ?? 0;
    const b2 = bytes[byteIndex + 2] ?? 0;

    const window = b0 | (b1 << 8) | (b2 << 16);
    const raw13 = (window >> bitShift) & 0x1FFF;

    const tempC = raw13 * 0.05 - 20.0;
    temps.push(Math.round(cToF(tempC) * 10) / 10);
    bitOffset += 13;
  }
  return temps;
}

// ── UART framing helpers (MeatNet Node / Giant Grill Gauge) ─────────────────

/**
 * CRC-16-CCITT with polynomial 0x1021 and initial value 0xFFFF.
 * Used to validate UART frame integrity.
 * @param {Uint8Array} bytes
 * @returns {number} 16-bit CRC
 */
function crc16ccitt(bytes) {
  let crc = 0xFFFF;
  for (const b of bytes) {
    crc ^= (b << 8);
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
  }
  return crc;
}

/**
 * Parse a UART response/notification frame from a MeatNet Node or Giant Grill Gauge.
 *
 * Frame layout (15-byte header):
 *   [0-1]  Sync bytes { 0xCA, 0xFE }
 *   [2-3]  CRC-16-CCITT over bytes[4..end]
 *   [4]    Message type (bit 7 = 1 for responses/notifications)
 *   [5-8]  Request ID
 *   [9-12] Response ID
 *   [13]   Success flag
 *   [14]   Payload length
 *   [15+]  Payload
 *
 * @param {Uint8Array} bytes
 * @returns {{ msgType: number, payload: Uint8Array, crcValid: boolean } | null}
 */
function parseUARTFrame(bytes) {
  if (bytes.length < 15) return null;
  if (bytes[0] !== 0xCA || bytes[1] !== 0xFE) return null;

  const msgType    = bytes[4] & 0x7F;   // strip high bit (response/notification marker)
  const payloadLen = bytes[14];
  if (bytes.length < 15 + payloadLen) return null;

  const payload  = bytes.slice(15, 15 + payloadLen);
  const crcStored = (bytes[2] << 8) | bytes[3];
  const crcActual = crc16ccitt(bytes.slice(4));  // CRC covers bytes[4] to end of payload
  const crcValid  = crcStored === crcActual;

  if (!crcValid) {
    console.warn('[useThermometer] UART CRC mismatch — stored:', crcStored.toString(16),
      'computed:', crcActual.toString(16), '— processing anyway');
  }

  return { msgType, payload, crcValid };
}

/**
 * Parse a Gauge Status (0x60) UART payload to extract the GGG's platinum RTD reading.
 *
 * Payload layout:
 *   [0-9]   Serial Number (10 bytes)
 *   [10-13] Session ID (uint32 LE)
 *   [14-15] Sample Period ms (uint16 LE)
 *   [16-17] Raw Temperature Data (uint16 LE, bits 0-12 = 13-bit reading)
 *               temp_c = (raw & 0x1FFF) × 0.1 − 20   (range: −20 to 799°C)
 *   [18]    Gauge Status Flags
 *               bit 0: Sensor Present
 *               bit 1: Sensor Overheating
 *               bit 2: Low Battery
 *
 * @param {Uint8Array} payload
 * @returns {{ gaugeTempF: number | null, sensorPresent: boolean, lowBattery: boolean }}
 */
function parseGaugeStatusPayload(payload) {
  if (payload.length < 19) return { gaugeTempF: null, sensorPresent: false, lowBattery: false };

  const rawU16       = payload[16] | (payload[17] << 8);
  const raw13        = rawU16 & 0x1FFF;
  const tempC        = raw13 * 0.1 - 20.0;
  const flags        = payload[18];
  const sensorPresent = !!(flags & 0x01);
  const lowBattery   = !!(flags & 0x04);

  const gaugeTempF = sensorPresent && tempC > -20 && tempC < 800
    ? Math.round(cToF(tempC) * 10) / 10
    : null;

  return { gaugeTempF, sensorPresent, lowBattery };
}

/**
 * Parse a Device Status characteristic notification from the Combustion probe.
 *
 * Mode/ID byte layout (byte 21):
 *   Bits 0–1: Mode  (0=Normal, 1=InstantRead, 2=Reserved, 3=Error)
 *   Bits 2–4: Color ID
 *   Bits 5–7: Probe ID
 *
 * Byte 22 — Battery + Virtual Sensor IDs (from Combustion open-source SDK):
 *   Bit  0        : Battery status (1 = ok)
 *   Bits [3:1]    : Virtual Core ID    (3-bit, 0–5 → T1–T6, direct array index)
 *   Bits [5:4]    : Virtual Surface ID (2-bit, 0–3 → T4–T7, index = id + 3)
 *   Bits [7:6]    : Virtual Ambient ID (2-bit, 0–3 → T5–T8, index = id + 4)
 *
 * Bytes 23–29 — Prediction Status (7 bytes):
 *   Estimated Core Temp: 11-bit field in sub-bytes 5–6 (packet bytes 28–29)
 *   rawCore = bytes[29] << 3 | (bytes[28] & 0xE0) >> 5
 *   temp_c  = rawCore × 0.1 − 20.0
 *
 * In Instant Read mode the probe only populates T1; T2–T8 are 0 (= −20°C = −4°F).
 * We filter the sensors array down to [T1] in that case.
 *
 * @param {DataView} dataView
 * @returns {{ sensors: number[], allSensors: number[], isInstantRead: boolean, mode: number,
 *             batteryOk: boolean, virtualCoreIndex: number, virtualSurfaceIndex: number,
 *             virtualAmbientIndex: number, estimatedCoreTempF: number|null }}
 */
function parseDeviceStatus(dataView) {
  const bytes = new Uint8Array(dataView.buffer);

  // Device Status characteristic layout:
  //  0–7:   Log range — min/max sequence numbers (2 × uint32 LE)
  //  8–20:  Raw temperature data (13 bytes, 8 × 13-bit sensors, LE packed)
  //  21:    Mode / color / probe ID
  //  22:    Battery status (bit 0) + Virtual Sensor IDs (bits 1–7)
  //  23–29: Prediction status (7 bytes)
  //  30+:   Food safe data, alarms, etc.
  const tempBytes = bytes.slice(8, 21);
  const allSensors = parseTemperatureBytes(tempBytes);  // always all 8

  const modeRaw = bytes.length > 21 ? bytes[21] : 0;
  const mode = modeRaw & 0x03;           // bits 0–1
  const isInstantRead = mode === 1;

  // In Instant Read mode only T1 is valid — trim for display
  const sensors = isInstantRead ? [allSensors[0]] : allSensors;

  // ── Byte 22: Battery + Virtual Sensor IDs ─────────────────────────────────
  // Source: Combustion open-source iOS/Android SDK (BatteryStatusVirtualSensors, VirtualSensors)
  const byte22 = bytes.length > 22 ? bytes[22] : 0;
  const batteryOk        = !!(byte22 & 0x01);          // bit 0  (1 = ok)
  const virtualCoreId    = (byte22 >> 1) & 0x07;       // bits [3:1] → 0–5 = T1–T6
  const virtualSurfaceId = (byte22 >> 4) & 0x03;       // bits [5:4] → 0–3 = T4–T7
  const virtualAmbientId = (byte22 >> 6) & 0x03;       // bits [7:6] → 0–3 = T5–T8

  const virtualCoreIndex    = virtualCoreId;            // T1=0 … T6=5  (direct array index)
  const virtualSurfaceIndex = virtualSurfaceId + 3;     // T4=3 … T7=6
  const virtualAmbientIndex = virtualAmbientId + 4;     // T5=4 … T8=7

  // ── Bytes 23–29: Prediction Status ────────────────────────────────────────
  // Estimated Core: 11-bit field spanning packet bytes 28 (upper 3 bits) + 29 (all 8 bits)
  // Source: Combustion PredictionStatus.swift — `rawCore = bytes[6] << 3 | (bytes[5] & 0xE0) >> 5`
  let estimatedCoreTempF = null;
  if (bytes.length > 29) {
    const rawCore = (bytes[29] << 3) | ((bytes[28] & 0xE0) >> 5);
    const estimatedCoreTempC = rawCore * 0.1 - 20.0;
    // Only expose when in a plausible cooking range (−5 to 105°C / 23 to 221°F)
    if (estimatedCoreTempC > -5 && estimatedCoreTempC < 105) {
      estimatedCoreTempF = Math.round(cToF(estimatedCoreTempC) * 10) / 10;
    }
  }

  return {
    sensors,
    allSensors,
    isInstantRead,
    mode,
    batteryOk,
    virtualCoreIndex,
    virtualSurfaceIndex,
    virtualAmbientIndex,
    estimatedCoreTempF,
  };
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export default function useThermometer() {
  const [state, setState]               = useState(THERMOMETER_STATE.IDLE);
  const [sensors, setSensors]           = useState(null);   // number[] | null — [T1] in IR, all 8 in Normal
  const [coreTemp, setCoreTemp]         = useState(null);   // °F — sensor at virtualCoreIndex
  const [surfaceTemp, setSurfaceTemp]   = useState(null);   // °F — sensor at virtualSurfaceIndex
  const [ambientTemp, setAmbientTemp]   = useState(null);   // °F — sensor at virtualAmbientIndex
  const [predictedCoreTemp, setPredictedCoreTemp] = useState(null); // °F — Combustion's prediction engine
  const [virtualCoreIndex, setVirtualCoreIndex]   = useState(0);    // 0-based index into allSensors
  const [virtualSurfaceIndex, setVirtualSurfaceIndex] = useState(null);
  const [virtualAmbientIndex, setVirtualAmbientIndex] = useState(null);
  const [isInstantRead, setIsInstantRead] = useState(false);
  const [deviceName, setDeviceName]     = useState(null);
  const [batteryOk, setBatteryOk]       = useState(true);
  const [errorMsg, setErrorMsg]         = useState(null);
  const [gaugeAmbientTemp, setGaugeAmbientTemp] = useState(null); // GGG RTD grill temp (°F)
  const [connectedVia, setConnectedVia] = useState(null);         // 'probe' | 'node' | null

  const deviceRef           = useRef(null);
  const serverRef           = useRef(null);
  const charRef             = useRef(null);
  const rxCharRef           = useRef(null);    // UART RX — for sending commands to node/GGG
  const isNodeConnectionRef = useRef(false);   // true when connected via UART (node/GGG path)

  // Web Bluetooth availability check
  const isSupported = typeof navigator !== 'undefined' && !!navigator.bluetooth;

  useEffect(() => {
    if (!isSupported) setState(THERMOMETER_STATE.UNSUPPORTED);
  }, [isSupported]);

  const onDisconnect = useCallback(() => {
    setState(THERMOMETER_STATE.DISCONNECTED);
    setSensors(null);
    setCoreTemp(null);
    setSurfaceTemp(null);
    setAmbientTemp(null);
    setPredictedCoreTemp(null);
    setGaugeAmbientTemp(null);
    setConnectedVia(null);
    charRef.current           = null;
    rxCharRef.current         = null;
    serverRef.current         = null;
    isNodeConnectionRef.current = false;
  }, []);

  /**
   * Apply a parsed Device Status result to hook state.
   * Used by both the direct-probe path and the GGG UART Probe Status path.
   */
  const applyDeviceStatus = useCallback((parsed) => {
    const {
      sensors: newSensors,
      allSensors: newAllSensors,
      isInstantRead: ir,
      batteryOk: batt,
      virtualCoreIndex: coreIdx,
      virtualSurfaceIndex: surfIdx,
      virtualAmbientIndex: ambIdx,
      estimatedCoreTempF,
    } = parsed;

    setSensors(newSensors);
    setIsInstantRead(ir);
    setBatteryOk(batt);
    setPredictedCoreTemp(estimatedCoreTempF);

    if (ir) {
      // Instant Read: only T1 is valid — no gradient available
      setCoreTemp(newSensors[0] ?? null);
      setSurfaceTemp(null);
      setAmbientTemp(null);
      setVirtualCoreIndex(0);
      setVirtualSurfaceIndex(null);
      setVirtualAmbientIndex(null);
    } else {
      // Normal mode: use probe-identified virtual sensor positions
      setCoreTemp(newAllSensors[coreIdx] ?? null);
      setSurfaceTemp(newAllSensors[surfIdx] ?? null);
      setAmbientTemp(newAllSensors[ambIdx] ?? null);
      setVirtualCoreIndex(coreIdx);
      setVirtualSurfaceIndex(surfIdx);
      setVirtualAmbientIndex(ambIdx);
    }
  }, []);

  /**
   * Handle incoming BLE notifications.
   *
   * Branches on connection type:
   *   - Direct probe (Probe Status Service): raw Device Status bytes, no framing
   *   - MeatNet Node / GGG (UART TX):        UART-framed messages, dispatch by type
   *       0x45 Probe Status — relay of connected probe data
   *       0x60 Gauge Status — GGG's own RTD grill temperature
   */
  const handleNotification = useCallback((event) => {
    try {
      const bytes = new Uint8Array(event.target.value.buffer);

      if (isNodeConnectionRef.current) {
        // ── UART framed path (GGG / Node) ──────────────────────────────────
        const frame = parseUARTFrame(bytes);
        if (!frame) {
          console.warn('[useThermometer] Could not parse UART frame, bytes:', bytes.length);
          return;
        }

        if (frame.msgType === MSG_PROBE_STATUS) {
          // Probe Status (0x45): payload[0-3] = probe serial, payload[4:] = Device Status layout
          if (frame.payload.length < 32) return; // need at least through prediction status
          // Shift DataView past the 4-byte probe serial — rest matches Device Status Char exactly
          const shiftedView = new DataView(
            frame.payload.buffer,
            frame.payload.byteOffset + 4,
            frame.payload.byteLength - 4,
          );
          applyDeviceStatus(parseDeviceStatus(shiftedView));

        } else if (frame.msgType === MSG_GAUGE_STATUS) {
          // Gauge Status (0x60): GGG's own platinum RTD reading
          const { gaugeTempF } = parseGaugeStatusPayload(frame.payload);
          if (gaugeTempF !== null) setGaugeAmbientTemp(gaugeTempF);
        }
        // Other message types (heartbeats, network topology, etc.) are silently ignored

      } else {
        // ── Direct Probe path (Device Status Char, no framing header) ───────
        applyDeviceStatus(parseDeviceStatus(event.target.value));
      }
    } catch (e) {
      console.warn('[useThermometer] Failed to parse notification:', e);
    }
  }, [applyDeviceStatus]);

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

      // Try primary Probe Status service first (direct probe)
      try {
        const service = await server.getPrimaryService(PROBE_STATUS_SERVICE);
        char = await service.getCharacteristic(DEVICE_STATUS_CHAR);
        isNodeConnectionRef.current = false;
        setConnectedVia('probe');
      } catch {
        // Fall back to UART service — this is the path for GGG / MeatNet Nodes
        try {
          const uartService = await server.getPrimaryService(UART_SERVICE);
          char = await uartService.getCharacteristic(UART_TX_CHAR);
          // Also grab RX so we can send commands later (e.g. Read Probe List 0x44)
          try {
            rxCharRef.current = await uartService.getCharacteristic(UART_RX_CHAR);
          } catch {
            rxCharRef.current = null; // non-fatal — notifications still work without RX
          }
          isNodeConnectionRef.current = true;
          setConnectedVia('node');
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
    deviceRef.current           = null;
    serverRef.current           = null;
    charRef.current             = null;
    rxCharRef.current           = null;
    isNodeConnectionRef.current = false;
    setState(THERMOMETER_STATE.IDLE);
    setSensors(null);
    setCoreTemp(null);
    setSurfaceTemp(null);
    setAmbientTemp(null);
    setPredictedCoreTemp(null);
    setGaugeAmbientTemp(null);
    setConnectedVia(null);
  }, [handleNotification, onDisconnect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { disconnect(); };
  }, [disconnect]);

  return {
    state,
    sensors,              // number[] | null — [T1] in Instant Read, all 8 in Normal mode
    coreTemp,             // number | null — temp at virtualCoreIndex (probe-identified thermal center)
    surfaceTemp,          // number | null — temp at virtualSurfaceIndex
    ambientTemp,          // number | null — temp at virtualAmbientIndex
    predictedCoreTemp,    // number | null — Combustion's prediction-engine estimated core (°F)
    virtualCoreIndex,     // number — 0-based index of the virtual core sensor (0=T1 … 5=T6)
    virtualSurfaceIndex,  // number | null — 0-based index of the virtual surface sensor
    virtualAmbientIndex,  // number | null — 0-based index of the virtual ambient sensor
    isInstantRead,        // true when probe is in Instant Read (single-sensor) mode
    gaugeAmbientTemp,     // number | null — GGG platinum RTD grill temperature (°F), null when direct probe
    connectedVia,         // 'probe' | 'node' | null — which BLE path was used
    deviceName,
    batteryOk,
    errorMsg,
    isSupported,
    connect,
    disconnect,
  };
}
