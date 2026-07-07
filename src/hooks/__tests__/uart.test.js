/**
 * UART command-layer tests — frame builders and parser round-trips.
 *
 * The Set Prediction frames are write commands the probe must ACCEPT, so
 * byte-level correctness matters: a wrong CRC byte order or bit packing is a
 * silently ignored command. The CRC is verified against an independent
 * reference implementation (checked against the standard CRC-16/CCITT-FALSE
 * test vector) rather than the app's own function.
 */

import { describe, it, expect } from 'vitest';
import {
  parseUARTFrame, buildProbeRequest, buildNodeRequest, encodePredictionData,
} from '../useThermometer';

/** Independent CRC-16-CCITT (poly 0x1021, init 0xFFFF) reference. */
function refCrc16(bytes) {
  let crc = 0xFFFF;
  for (const b of bytes) {
    crc ^= (b << 8);
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
  }
  return crc;
}

describe('CRC reference', () => {
  it('matches the standard CRC-16/CCITT-FALSE test vector', () => {
    const ascii = [...'123456789'].map(c => c.charCodeAt(0));
    expect(refCrc16(ascii)).toBe(0x29B1);
  });
});

describe('encodePredictionData', () => {
  it('packs 130°F pull temp: 54.4°C → raw 544 | mode 1 << 10', () => {
    const [lo, hi] = encodePredictionData(130);
    const packed = lo | (hi << 8);
    expect(packed & 0x3FF).toBe(544);        // set point, 0.1°C steps
    expect((packed >> 10) & 0x03).toBe(1);   // Time to Removal
  });

  it('clamps to the 0–102.3°C field range', () => {
    const hot = encodePredictionData(300);
    expect((hot[0] | (hot[1] << 8)) & 0x3FF).toBe(1023);
    const cold = encodePredictionData(-40);
    expect((cold[0] | (cold[1] << 8)) & 0x3FF).toBe(0);
  });
});

describe('frame builders', () => {
  it('probe frame: 6-byte header, little-endian CRC over type..payload', () => {
    const payload = new Uint8Array(encodePredictionData(131));
    const frame = buildProbeRequest(0x05, payload);
    expect(frame.length).toBe(6 + 2);
    expect([frame[0], frame[1]]).toEqual([0xCA, 0xFE]);
    expect(frame[4]).toBe(0x05);
    expect(frame[5]).toBe(2);
    expect([...frame.slice(6)]).toEqual([...payload]);
    const crc = refCrc16(frame.slice(4));
    expect(frame[2]).toBe(crc & 0xFF);         // low byte first (SDK convention)
    expect(frame[3]).toBe((crc >> 8) & 0xFF);
  });

  it('node frame: 10-byte header with request ID, serial + prediction payload', () => {
    const serial = [0x12, 0x34, 0x56, 0x78];
    const payload = new Uint8Array([...serial, ...encodePredictionData(131)]);
    const frame = buildNodeRequest(0x05, payload);
    expect(frame.length).toBe(10 + 6);
    expect([frame[0], frame[1]]).toEqual([0xCA, 0xFE]);
    expect(frame[4]).toBe(0x05);
    expect(frame[9]).toBe(6);
    expect([...frame.slice(10, 14)]).toEqual(serial);
    const crc = refCrc16(frame.slice(4));
    expect(frame[2]).toBe(crc & 0xFF);
    expect(frame[3]).toBe((crc >> 8) & 0xFF);
  });

  it('node frame round-trips through parseUARTFrame with a valid CRC', () => {
    const payload = new Uint8Array([1, 2, 3, 4, 0x20, 0x06]);
    const parsed = parseUARTFrame(buildNodeRequest(0x05, payload));
    expect(parsed).not.toBeNull();
    expect(parsed.framing).toBe('request');
    expect(parsed.msgType).toBe(0x05);
    expect(parsed.crcValid).toBe(true);
    expect(parsed.success).toBeNull();
    expect([...parsed.payload]).toEqual([...payload]);
  });
});

describe('parseUARTFrame responses', () => {
  const buildResponse = (msgType, success, payload = new Uint8Array(0)) => {
    const buf = new Uint8Array(15 + payload.length);
    buf[0] = 0xCA; buf[1] = 0xFE;
    buf[4] = msgType | 0x80;
    buf[13] = success ? 1 : 0;
    buf[14] = payload.length;
    buf.set(payload, 15);
    const crc = refCrc16(buf.slice(4));
    buf[2] = crc & 0xFF; buf[3] = (crc >> 8) & 0xFF;
    return buf;
  };

  it('extracts the success flag from Set Prediction responses', () => {
    const ok = parseUARTFrame(buildResponse(0x05, true));
    expect(ok.framing).toBe('response');
    expect(ok.msgType).toBe(0x05);
    expect(ok.success).toBe(true);
    expect(ok.crcValid).toBe(true);

    const fail = parseUARTFrame(buildResponse(0x05, false));
    expect(fail.success).toBe(false);
  });

  it('accepts big-endian CRC too (early-firmware tolerance)', () => {
    const buf = buildResponse(0x45, true, new Uint8Array(33));
    const [lo, hi] = [buf[2], buf[3]];
    buf[2] = hi; buf[3] = lo;   // swap to big-endian
    expect(parseUARTFrame(buf).crcValid).toBe(true);
  });
});
