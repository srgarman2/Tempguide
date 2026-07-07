/**
 * Math audit — regression tests for every calculation surface in the app.
 *
 * The carryover engine is full of hand-calibrated constants; these tests pin
 * the calibration anchors (documented empirical values from Thermoworks,
 * Chris Young, Kenji) and the physical invariants (monotonicity, maximum
 * principle, continuity) so future tuning can't silently break them.
 *
 * Run: npm test
 */

import { describe, it, expect } from 'vitest';
import {
  estimateCarryover, adjustedPullTemp, getCookStatus,
  fToC, cToF, displayDeltaF, formatTempDisplay, displayTemp,
  inchesToCm, displayThickness, GEOMETRY_TYPES,
} from '../carryover';
import { simulateCarryover } from '../heatSim';
import { estimateMicrowaveTime } from '../microwaveTime';
import { estimateTimeToPull } from '../eta';
import { COOKING_METHODS, CATEGORIES, getMethodById } from '../../data/temperatures';

// ── Unit conversions ─────────────────────────────────────────────────────────

describe('unit conversions', () => {
  it('anchors: freezing and boiling', () => {
    expect(fToC(32)).toBe(0);
    expect(fToC(212)).toBe(100);
    expect(cToF(0)).toBe(32);
    expect(cToF(100)).toBe(212);
  });

  it('roundtrips within rounding error', () => {
    for (let f = -20; f <= 500; f += 7) {
      expect(Math.abs(cToF(fToC(f)) - f)).toBeLessThanOrEqual(0.15);
    }
  });

  it('deltas convert by ×5/9, not the absolute formula', () => {
    expect(displayDeltaF(9, true)).toBe('+5°C');
    expect(displayDeltaF(18, true)).toBe('+10°C');
    expect(displayDeltaF(9, false)).toBe('+9°F');
  });

  it('absolute temps use the full formula', () => {
    expect(displayTemp(212, true)).toBe('100°C');
    expect(displayTemp(131, true)).toBe('55°C');
  });

  it('range formatting', () => {
    expect(formatTempDisplay({ min: 125, max: 130 }, false)).toBe('125–130°F');
    expect(formatTempDisplay([120, 130], false)).toBe('120–130°F');
    expect(formatTempDisplay(null)).toBe('—');
  });

  it('thickness conversions', () => {
    expect(inchesToCm(1)).toBe(2.5);
    expect(inchesToCm(2)).toBe(5.1);
    expect(displayThickness(1, true)).toBe('2.5 cm');
    expect(displayThickness(1, false)).toBe('1"');
  });
});

// ── Carryover: calibration anchors ───────────────────────────────────────────
// These pin the model to the documented empirical sources. If a refactor
// moves one of these outside its window, the calibration broke.

describe('carryover calibration anchors', () => {
  const co = (over) => estimateCarryover({
    methodId: 'pan-sear', pullTempF: 123, thicknessInches: 1.0,
    categoryId: 'beef', ...over,
  });

  it('pan-sear 1" steak ≈ Thermoworks pull 5–7°F early (model 5–10)', () => {
    expect(co().deltaF).toBeGreaterThanOrEqual(5);
    expect(co().deltaF).toBeLessThanOrEqual(10);
  });

  it('low & slow ≈ minimal carryover (2–5°F)', () => {
    const d = co({ methodId: 'low-slow', pullTempF: 130 }).deltaF;
    expect(d).toBeGreaterThanOrEqual(2);
    expect(d).toBeLessThanOrEqual(5);
  });

  it('basting flip ≈ Chris Young "around 20°F" for 1" steaks', () => {
    const d = co({ methodId: 'basting-flip', pullTempF: 115 }).deltaF;
    expect(d).toBeGreaterThanOrEqual(15);
    expect(d).toBeLessThanOrEqual(25);
  });

  it('thin salmon pan-sear ≈ empirical 15–19°F spike (model 12–20)', () => {
    const d = co({ pullTempF: 110, thicknessInches: 0.75, categoryId: 'seafood' }).deltaF;
    expect(d).toBeGreaterThanOrEqual(12);
    expect(d).toBeLessThanOrEqual(20);
  });

  it('sous vide = bath temp, ~1°F from the finishing sear', () => {
    expect(co({ methodId: 'sous-vide' }).deltaF).toBe(1);
  });

  it('boil = exactly zero (water-capped surface)', () => {
    const r = co({ methodId: 'boil', pullTempF: 200, categoryId: 'potato' });
    expect(r.deltaF).toBe(0);
    expect(r.peakTempF).toBe(200);
  });

  it('prime rib 5" wrapped bone-in lands in the documented 10–25°F window', () => {
    const d = estimateCarryover({
      methodId: 'oven-moderate', pullTempF: 118, thicknessInches: 5,
      categoryId: 'beef', geometry: 'cylinder', isWrapped: true, boneIn: true,
    }).deltaF;
    expect(d).toBeGreaterThanOrEqual(10);
    expect(d).toBeLessThanOrEqual(25);
  });
});

// ── Carryover: physical invariants ───────────────────────────────────────────

describe('carryover physical invariants', () => {
  const base = { methodId: 'oven-moderate', pullTempF: 120, categoryId: 'beef' };

  it('deltaF bounded [0, 25] for every method × thickness × category', () => {
    for (const m of COOKING_METHODS) {
      for (const t of [0.5, 1, 2, 3, 5, 8]) {
        for (const cat of ['beef', 'pork', 'lamb', 'poultry', 'seafood', 'potato']) {
          const r = estimateCarryover({ methodId: m.id, pullTempF: 130, thicknessInches: t, categoryId: cat });
          expect(r.deltaF, `${m.id} ${t}" ${cat}`).toBeGreaterThanOrEqual(0);
          expect(r.deltaF, `${m.id} ${t}" ${cat}`).toBeLessThanOrEqual(25);
          expect(Number.isFinite(r.peakTempF)).toBe(true);
          expect(r.peakTempF).toBeCloseTo(130 + r.deltaF, 5);
        }
      }
    }
  });

  it('carryover is monotonically non-decreasing in roast size (no large-roast collapse)', () => {
    // A bigger roast stores more energy — its carryover must never crash
    // toward zero as thickness grows (the 120-min display cap must not gut Fo).
    let prev = 0;
    for (const t of [3, 4, 5, 6, 7, 8]) {
      const d = estimateCarryover({
        ...base, pullTempF: 118, thicknessInches: t, geometry: 'cylinder',
      }).deltaF;
      expect(d, `at ${t}"`).toBeGreaterThanOrEqual(prev - 0.01);
      prev = d;
    }
    // And an 8" roast must carry meaningfully more than a token amount
    expect(prev).toBeGreaterThan(8);
  });

  it('wrapped rest ≥ unwrapped rest', () => {
    for (const methodId of ['pan-sear', 'oven-moderate', 'smoker', 'grill-high', 'broil']) {
      const u = estimateCarryover({ ...base, methodId, thicknessInches: 1.5 }).deltaF;
      const w = estimateCarryover({ ...base, methodId, thicknessInches: 1.5, isWrapped: true }).deltaF;
      expect(w, methodId).toBeGreaterThanOrEqual(u);
    }
  });

  it('bone-in ≤ boneless', () => {
    const bl = estimateCarryover({ ...base, thicknessInches: 2 }).deltaF;
    const bi = estimateCarryover({ ...base, thicknessInches: 2, boneIn: true }).deltaF;
    expect(bi).toBeLessThanOrEqual(bl);
  });

  it('geometry factors order: tapered ≤ slab ≤ cylinder', () => {
    const g = (geometry) => estimateCarryover({ ...base, thicknessInches: 2, geometry }).deltaF;
    expect(g('tapered')).toBeLessThanOrEqual(g('slab'));
    expect(g('slab')).toBeLessThanOrEqual(g('cylinder'));
    expect(GEOMETRY_TYPES.tapered.factor).toBeLessThan(GEOMETRY_TYPES.cylinder.factor);
  });

  it('rest profile starts at pull temp, peaks at peakTempF, and is continuous', () => {
    const r = estimateCarryover({ ...base, methodId: 'pan-sear', pullTempF: 123, thicknessInches: 1 });
    const temps = r.restProfile.map(p => p.tempF);
    expect(temps[0]).toBeCloseTo(123, 1);
    // Profile is sampled at whole minutes; the true peak can fall between
    // samples, so allow half-degree sampling error.
    expect(Math.max(...temps)).toBeCloseTo(r.peakTempF, 0);
    expect(Math.max(...temps)).toBeLessThanOrEqual(r.peakTempF + 0.05);
    for (let i = 1; i < temps.length; i++) {
      expect(Math.abs(temps[i] - temps[i - 1]), `minute ${i}`).toBeLessThanOrEqual(3);
    }
  });

  it('minutesToPeak stays within [3, 120] and scales with size', () => {
    const small = estimateCarryover({ ...base, thicknessInches: 0.5 });
    const large = estimateCarryover({ ...base, thicknessInches: 6, geometry: 'cylinder' });
    expect(small.minutesToPeak).toBeGreaterThanOrEqual(3);
    expect(large.minutesToPeak).toBeLessThanOrEqual(120);
    expect(large.minutesToPeak).toBeGreaterThan(small.minutesToPeak);
  });

  it('wet-bulb: unwrapped ambient depressed ~10–14°F, wrapped ≈ dry bulb', () => {
    const u = estimateCarryover({ ...base, ambientTempF: 72 });
    const w = estimateCarryover({ ...base, ambientTempF: 72, isWrapped: true });
    expect(u.effectiveAmbientF).toBeGreaterThan(58);
    expect(u.effectiveAmbientF).toBeLessThan(63);
    expect(Math.abs(w.effectiveAmbientF - 72)).toBeLessThan(1.5);
  });

  it('adjustedPullTemp round-trips: pull + carryover = target', () => {
    for (const methodId of ['pan-sear', 'oven-high', 'grill-high', 'deep-fry']) {
      const { deltaF } = estimateCarryover({ ...base, methodId, thicknessInches: 1.25 });
      const pull = adjustedPullTemp(135, deltaF);
      expect(Math.abs(pull + deltaF - 135)).toBeLessThanOrEqual(0.5);
    }
    expect(adjustedPullTemp({ min: 125, max: 130 }, 5)).toEqual({ min: 120, max: 125 });
  });
});

// ── Finite-difference simulation ─────────────────────────────────────────────

describe('heat-equation FD simulation', () => {
  it('obeys the maximum principle: core never exceeds the hottest initial reading', () => {
    const r = simulateCarryover({
      sensorTempsF: [120, 135, 150, 165], thicknessInches: 1.5,
      ambientTempF: 60, simMinutes: 60,
    });
    expect(r.peakTempF).toBeLessThanOrEqual(165 + 0.01);
    expect(r.deltaF).toBeGreaterThan(0);
  });

  it('uniform initial profile only cools — no phantom rise', () => {
    const r = simulateCarryover({
      sensorTempsF: [130, 130], thicknessInches: 1, ambientTempF: 60, simMinutes: 45,
    });
    expect(r.deltaF).toBeLessThanOrEqual(0.01);
    const temps = r.restProfile.map(p => p.tempF);
    for (let i = 1; i < temps.length; i++) expect(temps[i]).toBeLessThanOrEqual(temps[i - 1] + 0.01);
  });

  it('numerically stable across sizes — no NaN/oscillation', () => {
    for (const t of [0.25, 0.5, 1, 2, 4, 8]) {
      const r = simulateCarryover({
        sensorTempsF: [120, 140, 170], thicknessInches: t, ambientTempF: 60, simMinutes: 30,
      });
      for (const p of r.restProfile) expect(Number.isFinite(p.tempF), `${t}"`).toBe(true);
    }
  });

  it('bone-in retards the rise; wrapping preserves it', () => {
    const args = { sensorTempsF: [120, 140, 165], thicknessInches: 1.5, ambientTempF: 60, simMinutes: 45 };
    expect(simulateCarryover({ ...args, boneIn: true }).deltaF)
      .toBeLessThanOrEqual(simulateCarryover(args).deltaF);
    expect(simulateCarryover({ ...args, isWrapped: true }).deltaF)
      .toBeGreaterThanOrEqual(simulateCarryover(args).deltaF);
  });

  it('estimateCarryover FD path applies wet-bulb exactly once and stays bounded', () => {
    const r = estimateCarryover({
      methodId: 'pan-sear', pullTempF: 123, thicknessInches: 1, categoryId: 'beef',
      sensorGradientF: [123, 135, 150, 165], ambientTempF: 72,
    });
    expect(r.effectiveAmbientF).toBeGreaterThan(58);
    expect(r.effectiveAmbientF).toBeLessThan(63);
    expect(r.deltaF).toBeGreaterThan(0);
    expect(r.deltaF).toBeLessThanOrEqual(165 - 123);
    expect(r.penetrationFactor).toBeLessThanOrEqual(2.0);
  });
});

// ── Microwave estimator ──────────────────────────────────────────────────────

describe('microwave time estimator', () => {
  it('linear in thickness and ΔT, ranges bracket the estimate', () => {
    const a = estimateMicrowaveTime({ pullTempF: 138, thicknessInches: 1, categoryId: 'beef' });
    const b = estimateMicrowaveTime({ pullTempF: 138, thicknessInches: 2, categoryId: 'beef' });
    expect(b.minutes).toBeGreaterThan(a.minutes * 1.7);
    expect(a.rangeLow).toBeLessThanOrEqual(a.minutes);
    expect(a.rangeHigh).toBeGreaterThanOrEqual(a.minutes);
  });

  it('unknown category falls back to beef factor', () => {
    const beef = estimateMicrowaveTime({ pullTempF: 140, thicknessInches: 1, categoryId: 'beef' });
    const unknown = estimateMicrowaveTime({ pullTempF: 140, thicknessInches: 1, categoryId: 'baked' });
    expect(unknown.minutes).toBe(beef.minutes);
  });
});

// ── Cook status ──────────────────────────────────────────────────────────────

describe('getCookStatus', () => {
  it('progress percentage is bounded and finite', () => {
    const s = getCookStatus(100, 130, 135);
    expect(s.pct).toBeGreaterThan(0);
    expect(s.pct).toBeLessThan(100);
  });

  it('never returns NaN, even for a degenerate pull temp', () => {
    for (const pull of [35, 34, 20]) {
      const s = getCookStatus(50, pull, 60);
      expect(Number.isFinite(s.pct)).toBe(true);
    }
  });
});

// ── ETA (time to pull) ───────────────────────────────────────────────────────

describe('estimateTimeToPull', () => {
  const mkHistory = (slope, minutes = 10, start = 80) =>
    Array.from({ length: minutes * 6 }, (_, i) => ({
      minute: i / 6, coreTemp: start + slope * (i / 6),
    }));

  it('recovers a clean linear ramp exactly', () => {
    const h = mkHistory(2);                    // 2°F/min, ends at 100°F
    const eta = estimateTimeToPull(h, 100, 130);
    expect(eta.slopePerMin).toBeCloseTo(2, 1);
    expect(eta.minutes).toBe(15);              // 30°F to go at 2°F/min
  });

  it('returns 0 when already at pull temp', () => {
    expect(estimateTimeToPull(mkHistory(2), 135, 130).minutes).toBe(0);
  });

  it('declines to guess on flat, falling, or sparse data', () => {
    expect(estimateTimeToPull(mkHistory(0), 80, 130)).toBeNull();      // stall
    expect(estimateTimeToPull(mkHistory(-1), 70, 130)).toBeNull();     // cooling
    expect(estimateTimeToPull([{ minute: 0, coreTemp: 80 }], 80, 130)).toBeNull();
    expect(estimateTimeToPull(null, 80, 130)).toBeNull();
  });

  it('uses only the recent window, ignoring the sear spike an hour ago', () => {
    const old = Array.from({ length: 60 }, (_, i) => ({ minute: i, coreTemp: 40 + i * 5 }));
    const recent = Array.from({ length: 30 }, (_, i) => ({ minute: 60 + i / 6, coreTemp: 115 + (i / 6) }));
    const eta = estimateTimeToPull([...old, ...recent], 120, 130);     // recent slope 1°F/min
    expect(eta.slopePerMin).toBeCloseTo(1, 0);
    expect(eta.minutes).toBeGreaterThanOrEqual(8);
    expect(eta.minutes).toBeLessThanOrEqual(12);
  });
});

// ── Data integrity: temperatures.js ──────────────────────────────────────────

describe('temperature data integrity', () => {
  const methodIds = new Set(COOKING_METHODS.map(m => m.id));
  const num = (v) => typeof v === 'number';
  const lo = (v) => (num(v) ? v : v?.min);
  const hi = (v) => (num(v) ? v : v?.max);

  it('every referenced cooking method exists', () => {
    for (const cat of CATEGORIES) for (const item of cat.items) {
      expect(item.compatibleMethods?.length, `${cat.id}/${item.id}`).toBeGreaterThan(0);
      for (const m of item.compatibleMethods) {
        expect(methodIds.has(m), `${cat.id}/${item.id} → ${m}`).toBe(true);
      }
    }
  });

  it('ranges are ordered and pull ≤ end everywhere', () => {
    for (const cat of CATEGORIES) for (const item of cat.items) {
      const levels = item.hasDoneness ? item.doneness : [item];
      for (const d of levels) {
        const name = `${cat.id}/${item.id}/${d.level ?? 'item'}`;
        if (d.pullTemp != null && !num(d.pullTemp)) {
          expect(d.pullTemp.min, name).toBeLessThanOrEqual(d.pullTemp.max);
        }
        if (d.endTemp != null && !num(d.endTemp)) {
          expect(d.endTemp.min, name).toBeLessThanOrEqual(d.endTemp.max);
        }
        if (d.pullTemp != null && d.endTemp != null) {
          expect(lo(d.pullTemp), name).toBeLessThanOrEqual(lo(d.endTemp));
          expect(hi(d.pullTemp), name).toBeLessThanOrEqual(hi(d.endTemp));
        }
        if (d.bastingPullTemp != null && d.pullTemp != null) {
          expect(d.bastingPullTemp, name).toBeLessThanOrEqual(lo(d.pullTemp));
        }
        if (d.sousVideTemp != null && d.endTemp != null) {
          expect(d.sousVideTemp, name).toBeGreaterThanOrEqual(lo(d.endTemp) - 10);
          expect(d.sousVideTemp, name).toBeLessThanOrEqual(hi(d.endTemp) + 10);
        }
        if (Array.isArray(d.restRangeMinutes)) {
          expect(d.restRangeMinutes[0], name).toBeLessThanOrEqual(d.restRangeMinutes[1]);
        }
      }
      if (Array.isArray(item.endTempRange)) {
        expect(item.endTempRange[0], item.id).toBeLessThanOrEqual(item.endTempRange[1]);
      }
      if (item.wrapTemp) {
        expect(item.wrapTemp.min, item.id).toBeLessThanOrEqual(item.wrapTemp.max);
      }
    }
  });

  it('slider configs are coherent', () => {
    for (const cat of CATEGORIES) for (const item of cat.items) {
      if (item.sliderMin != null) {
        expect(item.sliderMin, item.id).toBeLessThan(item.sliderMax);
        expect(item.sliderDefault, item.id).toBeGreaterThanOrEqual(item.sliderMin);
        expect(item.sliderDefault, item.id).toBeLessThanOrEqual(item.sliderMax);
        for (const l of item.sliderLabels ?? []) {
          expect(l.value, item.id).toBeGreaterThanOrEqual(item.sliderMin);
          expect(l.value, item.id).toBeLessThanOrEqual(item.sliderMax);
        }
      }
    }
  });

  it('methods that skip carryover are flagged, others produce a gradient', () => {
    for (const m of COOKING_METHODS) {
      const r = estimateCarryover({ methodId: m.id, pullTempF: 130, thicknessInches: 1, categoryId: 'beef' });
      if (m.appliesCarryover === false && m.id !== 'sous-vide') {
        expect(r.deltaF, m.id).toBe(0);
      }
      expect(r.surfaceGradientF, m.id).toBeGreaterThanOrEqual(0);
      expect(r.surfaceGradientF, m.id).toBeLessThanOrEqual(120);
    }
  });
});
