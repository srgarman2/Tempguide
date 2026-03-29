/**
 * cookLog.js — Persistent cook history via localStorage
 *
 * Each log entry captures:
 *   - Cut / method metadata (labels + IDs)
 *   - Physical parameters (thickness, geometry, bone-in, wrapped)
 *   - Pull-moment sensor data (core, surface, ambient, full 8-sensor array)
 *   - Initial carryover prediction (all physics model fields)
 *   - Actual measured outcome (peak temp + time to peak from liveHistory)
 *   - Error = actualPeakF − predictedPeakF  (null when no live data)
 */

const STORAGE_KEY = 'cookLog_v1';
const MAX_ENTRIES = 200;

// ── Read / Write ─────────────────────────────────────────────────────────────

export function loadLog() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveLogEntry(entry) {
  try {
    const log = loadLog();
    log.unshift(entry);                         // newest first
    if (log.length > MAX_ENTRIES) log.length = MAX_ENTRIES;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
  } catch (e) {
    console.warn('cookLog: failed to save entry', e);
  }
}

export function deleteLogEntry(id) {
  try {
    const log = loadLog().filter(e => e.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
  } catch {}
}

export function clearLog() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

// ── Entry builder ─────────────────────────────────────────────────────────────

/**
 * Build a structured log entry from everything available at the end of a rest.
 *
 * @param {Object} p
 * @param {Object}   p.selection          - Full selection object from App state
 * @param {Object}   p.item               - Item record from temperatures.js
 * @param {Object}   p.category           - Category record from temperatures.js
 * @param {Object}   p.method             - Method record from temperatures.js
 * @param {Object}   p.doneness           - Doneness record (may be null)
 * @param {Object}   p.initialCarryover   - Result of estimateCarryover() at pull time
 * @param {Array}    p.liveHistory        - [{minute, tempF}] from useRestTimer
 * @param {number[]} p.sensorGradientF    - Sensor slice used for FD simulation (may be null)
 * @param {boolean}  p.isDegenerateGradient - Whether core === surface sensor
 * @returns {Object} Log entry ready for saveLogEntry()
 */
export function buildLogEntry({
  selection,
  item,
  category,
  method,
  doneness,
  initialCarryover,
  liveHistory,
  sensorGradientF,
  isDegenerateGradient,
  cookPhaseHistory,
}) {
  // ── Actual outcome from live probe history ──────────────────────────
  let actualPeakF       = null;
  let actualMinutesToPeak = null;

  if (liveHistory && liveHistory.length > 0) {
    const maxPoint = liveHistory.reduce(
      (best, p) => (p.tempF > best.tempF ? p : best),
      liveHistory[0],
    );
    actualPeakF         = maxPoint.tempF;
    actualMinutesToPeak = maxPoint.minute;
  }

  const predictedPeakF = initialCarryover?.peakTempF ?? null;
  const errorF = (actualPeakF != null && predictedPeakF != null)
    ? Math.round((actualPeakF - predictedPeakF) * 10) / 10
    : null;

  return {
    id:        Date.now(),
    timestamp: new Date().toISOString(),

    // ── Cut metadata ────────────────────────────────────────────────
    categoryId:    selection.categoryId,
    categoryLabel: category?.label ?? selection.categoryId,
    itemId:        selection.itemId,
    itemLabel:     item?.label ?? selection.itemId,
    donenessLabel: doneness?.label ?? null,
    methodId:      selection.methodId,
    methodLabel:   method?.label ?? selection.methodId,

    // ── Physical params ─────────────────────────────────────────────
    thicknessInches: selection.thicknessInches,
    geometry:        selection.geometry ?? 'slab',
    boneIn:          selection.boneIn ?? false,
    isWrapped:       selection.isWrapped ?? false,

    // ── Pull-moment sensor data ─────────────────────────────────────
    pullCoreTempF:    selection.actualCoreTempF    ?? null,
    pullSurfaceTempF: selection.actualSurfaceTempF ?? null,
    pullAmbientTempF: selection.actualAmbientTempF ?? null,
    sensorReadingsAtPull:      selection.sensorReadingsAtPull      ?? null,
    virtualCoreIndexAtPull:    selection.virtualCoreIndexAtPull    ?? null,
    virtualSurfaceIndexAtPull: selection.virtualSurfaceIndexAtPull ?? null,
    isDegenerateGradient:      isDegenerateGradient ?? false,
    sensorGradientUsed:        sensorGradientF ?? null,

    // ── Initial prediction (physics model fields) ───────────────────
    predictedDeltaF:        initialCarryover?.deltaF             ?? null,
    predictedPeakF:         initialCarryover?.peakTempF          ?? null,
    predictedMinutesToPeak: initialCarryover?.minutesToPeak      ?? null,
    surfaceGradientF:       initialCarryover?.surfaceGradientF   ?? null,
    surfaceDataSource:      initialCarryover?.surfaceDataSource  ?? null,
    penetrationFactor:      initialCarryover?.penetrationFactor  ?? null,
    fractionReached:        initialCarryover?.fractionReached    ?? null,
    fourier:                initialCarryover?.fourier            ?? null,
    biot:                   initialCarryover?.biot               ?? null,
    lambda1:                initialCarryover?.lambda1            ?? null,
    A1:                     initialCarryover?.A1                 ?? null,
    thermalDiffusivity:     initialCarryover?.thermalDiffusivity ?? null,
    halfThicknessM:         initialCarryover?.halfThicknessM     ?? null,
    geometryFactor:         initialCarryover?.geometryFactor     ?? null,
    convectiveH:            initialCarryover?.convectiveH        ?? null,
    surfaceTempAtPull:      initialCarryover?.surfaceTempAtPull  ?? null,
    effectiveAmbientF:      initialCarryover?.effectiveAmbientF  ?? null,

    // ── Actual outcome ──────────────────────────────────────────────
    actualPeakF,
    actualMinutesToPeak,
    hasLiveData: liveHistory != null && liveHistory.length > 0,
    liveHistoryPoints: liveHistory?.length ?? 0,

    // ── Cook phase history ──────────────────────────────────────────
    cookPhaseHistory: cookPhaseHistory ?? null,

    // ── Error ───────────────────────────────────────────────────────
    errorF,
  };
}

// ── CSV export ────────────────────────────────────────────────────────────────

const CSV_COLUMNS = [
  ['timestamp',             'Timestamp'],
  ['categoryLabel',         'Category'],
  ['itemLabel',             'Cut'],
  ['donenessLabel',         'Doneness'],
  ['methodLabel',           'Method'],
  ['thicknessInches',       'Thickness (in)'],
  ['geometry',              'Geometry'],
  ['boneIn',                'Bone-In'],
  ['isWrapped',             'Wrapped'],
  ['pullCoreTempF',         'Pull Core (°F)'],
  ['pullSurfaceTempF',      'Pull Surface (°F)'],
  ['pullAmbientTempF',      'Pull Ambient (°F)'],
  ['surfaceGradientF',      'Surface Gradient (°F)'],
  ['surfaceDataSource',     'Gradient Source'],
  ['predictedDeltaF',       'Predicted ΔF'],
  ['predictedPeakF',        'Predicted Peak (°F)'],
  ['predictedMinutesToPeak','Predicted Min to Peak'],
  ['actualPeakF',           'Actual Peak (°F)'],
  ['actualMinutesToPeak',   'Actual Min to Peak'],
  ['errorF',                'Error (°F)'],
  ['fourier',               'Fourier Number'],
  ['biot',                  'Biot Number'],
  ['penetrationFactor',     'Penetration Factor'],
  ['fractionReached',       'Fraction Reached'],
  ['thermalDiffusivity',    'Thermal Diffusivity (m²/s)'],
  ['isDegenerateGradient',  'Degenerate Gradient'],
];

function csvCell(val) {
  if (val == null) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function exportCSV(log) {
  const header = CSV_COLUMNS.map(([, label]) => csvCell(label)).join(',');
  const rows   = log.map(entry =>
    CSV_COLUMNS.map(([key]) => csvCell(entry[key])).join(','),
  );
  const csv  = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `cook-log-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
