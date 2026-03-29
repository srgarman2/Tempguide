import { useState, useEffect } from 'react';
import { loadLog, deleteLogEntry, clearLog, exportCSV } from '../utils/cookLog';
import NavBar from './NavBar';
import ClaudeAnalysisModal from './ClaudeAnalysisModal';

function ErrorBadge({ errorF }) {
  if (errorF == null) return <span className="log-badge log-badge--neutral">No data</span>;
  const abs = Math.abs(errorF);
  const sign = errorF >= 0 ? '+' : '−';
  const cls = abs <= 1 ? 'log-badge--good' : abs <= 3 ? 'log-badge--warn' : 'log-badge--bad';
  return (
    <span className={`log-badge ${cls}`}>
      {sign}{abs.toFixed(1)}°F
    </span>
  );
}

function DetailRow({ label, value, highlight }) {
  if (value == null || value === '') return null;
  return (
    <div className="log-detail-row">
      <span className="log-detail-label">{label}</span>
      <span className="log-detail-value" style={highlight ? { color: '#f5a623' } : {}}>
        {value}
      </span>
    </div>
  );
}

function LogEntry({ entry, onDelete, onAnalyze }) {
  const [expanded, setExpanded] = useState(false);

  const date = new Date(entry.timestamp);
  const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const cutLabel = [
    entry.categoryLabel,
    entry.itemLabel,
    entry.donenessLabel,
  ].filter(Boolean).join(' · ');

  return (
    <div className={`log-entry ${expanded ? 'log-entry--expanded' : ''}`}>
      {/* ── Summary row ─────────────────────────────────────────── */}
      <button className="log-entry-summary" onClick={() => setExpanded(e => !e)}>
        <div className="log-entry-left">
          <div className="log-entry-cut">{cutLabel}</div>
          <div className="log-entry-meta">
            {entry.methodLabel} · {entry.thicknessInches}" · {dateStr} {timeStr}
          </div>
        </div>
        <div className="log-entry-right">
          <div className="log-entry-temps">
            <span className="log-temp-pred">~{entry.predictedPeakF?.toFixed(1)}°</span>
            {entry.actualPeakF != null && (
              <span className="log-temp-actual">{entry.actualPeakF?.toFixed(1)}°</span>
            )}
          </div>
          <ErrorBadge errorF={entry.errorF} />
          <span className="log-chevron">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {/* ── Expanded detail ──────────────────────────────────────── */}
      {expanded && (
        <div className="log-entry-detail">
          <div className="log-detail-section">
            <div className="log-detail-section-title">Cook</div>
            <DetailRow label="Category"    value={entry.categoryLabel} />
            <DetailRow label="Cut"         value={entry.itemLabel} />
            <DetailRow label="Doneness"    value={entry.donenessLabel} />
            <DetailRow label="Method"      value={entry.methodLabel} />
            <DetailRow label="Thickness"   value={`${entry.thicknessInches}"`} />
            <DetailRow label="Geometry"    value={entry.geometry} />
            <DetailRow label="Bone-in"     value={entry.boneIn ? 'Yes' : 'No'} />
            <DetailRow label="Wrapped"     value={entry.isWrapped ? 'Yes' : 'No'} />
          </div>

          <div className="log-detail-section">
            <div className="log-detail-section-title">At Pull</div>
            <DetailRow label="Core"    value={entry.pullCoreTempF != null ? `${entry.pullCoreTempF.toFixed(1)}°F` : null} highlight />
            <DetailRow label="Surface" value={entry.pullSurfaceTempF != null ? `${entry.pullSurfaceTempF.toFixed(1)}°F` : null} />
            <DetailRow label="Ambient" value={entry.pullAmbientTempF != null ? `${entry.pullAmbientTempF.toFixed(1)}°F (probe)` : '72°F (assumed)'} />
            {entry.sensorReadingsAtPull && (
              <div className="log-sensor-row">
                {entry.sensorReadingsAtPull.map((t, i) => (
                  <div
                    key={i}
                    className={[
                      'log-sensor-pip',
                      i === entry.virtualCoreIndexAtPull    ? 'log-sensor-pip--core'    : '',
                      i === entry.virtualSurfaceIndexAtPull ? 'log-sensor-pip--surface' : '',
                    ].join(' ')}
                  >
                    <div className="log-sensor-temp">{Math.round(t)}°</div>
                    <div className="log-sensor-label">T{i + 1}</div>
                  </div>
                ))}
              </div>
            )}
            {entry.isDegenerateGradient && (
              <div className="log-note">⚠ Core = surface sensor — full-span gradient used</div>
            )}
          </div>

          <div className="log-detail-section">
            <div className="log-detail-section-title">Prediction</div>
            <DetailRow label="Predicted ΔF"       value={entry.predictedDeltaF != null ? `+${entry.predictedDeltaF.toFixed(1)}°F` : null} highlight />
            <DetailRow label="Predicted peak"     value={entry.predictedPeakF != null ? `${entry.predictedPeakF.toFixed(1)}°F` : null} highlight />
            <DetailRow label="Min to peak"        value={entry.predictedMinutesToPeak != null ? `~${entry.predictedMinutesToPeak} min` : null} />
            <DetailRow label="Surface gradient"   value={entry.surfaceGradientF != null ? `${entry.surfaceGradientF.toFixed(1)}°F` : null} />
            <DetailRow label="Gradient source"    value={entry.surfaceDataSource} />
            <DetailRow label="Fourier number"     value={entry.fourier != null ? entry.fourier.toFixed(3) : null} />
            <DetailRow label="Biot number"        value={entry.biot != null ? entry.biot.toFixed(3) : null} />
            <DetailRow label="Penetration factor" value={entry.penetrationFactor != null ? entry.penetrationFactor.toFixed(3) : null} />
            <DetailRow label="Fraction reached"   value={entry.fractionReached != null ? entry.fractionReached.toFixed(3) : null} />
            <DetailRow
              label="Thermal diffusivity"
              value={entry.thermalDiffusivity != null ? `${entry.thermalDiffusivity.toExponential(2)} m²/s` : null}
            />
          </div>

          <div className="log-detail-section">
            <div className="log-detail-section-title">Actual (measured)</div>
            {entry.hasLiveData ? (
              <>
                <DetailRow label="Actual peak"      value={`${entry.actualPeakF?.toFixed(1)}°F`} highlight />
                <DetailRow label="Time to peak"     value={`~${entry.actualMinutesToPeak?.toFixed(1)} min`} />
                <DetailRow label="Error"            value={entry.errorF != null ? `${entry.errorF >= 0 ? '+' : ''}${entry.errorF.toFixed(1)}°F` : null}
                  highlight={entry.errorF != null && Math.abs(entry.errorF) > 2} />
                <DetailRow label="Data points"      value={`${entry.liveHistoryPoints} readings`} />
              </>
            ) : (
              <div className="log-note">No probe data during rest — prediction only</div>
            )}
          </div>

          <div className="log-entry-footer">
            <button
              className="log-analyze-btn"
              onClick={() => onAnalyze(entry)}
            >
              Analyze with Claude
            </button>
            <button
              className="log-delete-btn"
              onClick={() => { if (window.confirm('Delete this entry?')) onDelete(entry.id); }}
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function LogScreen({ goBack }) {
  const [log, setLog]                   = useState([]);
  const [analyzingEntry, setAnalyzing]  = useState(null);

  useEffect(() => {
    setLog(loadLog());
  }, []);

  const handleDelete = (id) => {
    deleteLogEntry(id);
    setLog(loadLog());
  };

  const handleClear = () => {
    if (window.confirm('Clear all cook history? This cannot be undone.')) {
      clearLog();
      setLog([]);
    }
  };

  // Summary stats
  const withData  = log.filter(e => e.hasLiveData && e.errorF != null);
  const avgError  = withData.length > 0
    ? withData.reduce((s, e) => s + e.errorF, 0) / withData.length
    : null;
  const absErrors = withData.map(e => Math.abs(e.errorF));
  const mae       = absErrors.length > 0
    ? absErrors.reduce((s, v) => s + v, 0) / absErrors.length
    : null;

  return (
    <div className="screen log-screen">
      <NavBar onBack={goBack} title="Cook History" />

      {/* ── Stats bar ─────────────────────────────────────────────── */}
      {withData.length > 0 && (
        <div className="log-stats">
          <div className="log-stat">
            <div className="log-stat-value">{log.length}</div>
            <div className="log-stat-label">Total cooks</div>
          </div>
          <div className="log-stat">
            <div className="log-stat-value">{withData.length}</div>
            <div className="log-stat-label">With probe data</div>
          </div>
          <div className="log-stat">
            <div
              className="log-stat-value"
              style={{ color: Math.abs(avgError) <= 1 ? '#4cde80' : Math.abs(avgError) <= 3 ? '#f5a623' : '#ff6b6b' }}
            >
              {avgError >= 0 ? '+' : ''}{avgError?.toFixed(1)}°F
            </div>
            <div className="log-stat-label">Avg error</div>
          </div>
          <div className="log-stat">
            <div
              className="log-stat-value"
              style={{ color: mae <= 1 ? '#4cde80' : mae <= 3 ? '#f5a623' : '#ff6b6b' }}
            >
              ±{mae?.toFixed(1)}°F
            </div>
            <div className="log-stat-label">Mean abs error</div>
          </div>
        </div>
      )}

      {/* ── Actions ───────────────────────────────────────────────── */}
      {log.length > 0 && (
        <div className="log-actions">
          <button className="log-action-btn" onClick={() => exportCSV(log)}>
            ↓ Export CSV
          </button>
          <button className="log-action-btn log-action-btn--danger" onClick={handleClear}>
            Clear all
          </button>
        </div>
      )}

      {/* ── Entry list ────────────────────────────────────────────── */}
      <div className="log-list">
        {log.length === 0 ? (
          <div className="log-empty">
            <div className="log-empty-icon">📋</div>
            <div className="log-empty-title">No cooks logged yet</div>
            <div className="log-empty-sub">
              Entries are saved automatically when the rest timer completes with an active probe.
            </div>
          </div>
        ) : (
          log.map(entry => (
            <LogEntry key={entry.id} entry={entry} onDelete={handleDelete} onAnalyze={setAnalyzing} />
          ))
        )}
      </div>

      <div style={{ height: 40 }} />

      {analyzingEntry && (
        <ClaudeAnalysisModal
          entry={analyzingEntry}
          onClose={() => setAnalyzing(null)}
        />
      )}
    </div>
  );
}
