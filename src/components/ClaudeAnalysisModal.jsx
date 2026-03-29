import { useState } from 'react';
import {
  analyzeWithClaude,
  getStoredApiKey,
  storeApiKey,
  clearApiKey,
} from '../utils/claudeAnalysis';

/**
 * Modal for analyzing a cook log entry with Claude.
 * Handles API key setup (stored in localStorage) and shows the analysis result.
 */
export default function ClaudeAnalysisModal({ entry, onClose }) {
  const [apiKey, setApiKey]       = useState(getStoredApiKey());
  const [showKey, setShowKey]     = useState(!getStoredApiKey());
  const [status, setStatus]       = useState('idle'); // idle | loading | done | error
  const [result, setResult]       = useState(null);
  const [errorMsg, setErrorMsg]   = useState('');

  const cutLabel = [entry.categoryLabel, entry.itemLabel, entry.donenessLabel]
    .filter(Boolean).join(' · ');

  const errorAbs  = entry.errorF != null ? Math.abs(entry.errorF) : null;
  const errorSign = entry.errorF != null && entry.errorF >= 0 ? '+' : '−';
  const badgeCls  = errorAbs == null
    ? 'log-badge--neutral'
    : errorAbs <= 1 ? 'log-badge--good'
    : errorAbs <= 3 ? 'log-badge--warn'
    : 'log-badge--bad';

  async function handleAnalyze() {
    const key = apiKey.trim();
    if (!key) return;
    storeApiKey(key);
    setShowKey(false);
    setStatus('loading');
    setErrorMsg('');
    try {
      const text = await analyzeWithClaude(entry, key);
      setResult(text);
      setStatus('done');
    } catch (e) {
      setErrorMsg(e.message);
      setStatus('error');
    }
  }

  function handleClearKey() {
    clearApiKey();
    setApiKey('');
    setShowKey(true);
    setStatus('idle');
    setResult(null);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="modal-header">
          <span className="modal-title">Analyze with Claude</span>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="modal-body">

          {/* Cook summary pill */}
          <div className="analysis-summary">
            <span className="analysis-cut">{cutLabel}</span>
            {entry.errorF != null ? (
              <span className={`log-badge ${badgeCls}`}>
                {errorSign}{errorAbs.toFixed(1)}°F error
              </span>
            ) : (
              <span className="log-badge log-badge--neutral">No outcome data</span>
            )}
          </div>

          {/* ── API key input ─────────────────────────────────── */}
          {showKey && (
            <div className="analysis-key-section">
              <p className="analysis-key-desc">
                Enter your Anthropic API key. It's stored only in your browser's localStorage and sent directly to api.anthropic.com — it never touches any other server.
              </p>
              <input
                className="analysis-key-input"
                type="password"
                placeholder="sk-ant-api03-..."
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAnalyze()}
                autoFocus
              />
              <p className="analysis-key-warning">
                ⚠ Don't use this on a shared or public device.
              </p>
            </div>
          )}

          {/* ── Loading ───────────────────────────────────────── */}
          {status === 'loading' && (
            <div className="analysis-loading">
              <div className="analysis-spinner" />
              <span>Analyzing your cook...</span>
            </div>
          )}

          {/* ── Error ────────────────────────────────────────── */}
          {status === 'error' && (
            <div className="analysis-error">
              <div className="analysis-error-title">Analysis failed</div>
              <div className="analysis-error-msg">{errorMsg}</div>
              <button className="log-action-btn" style={{ marginTop: 8 }} onClick={() => setStatus('idle')}>
                Try again
              </button>
            </div>
          )}

          {/* ── Result ───────────────────────────────────────── */}
          {status === 'done' && result && (
            <div className="analysis-result">
              <SimpleMarkdown text={result} />
            </div>
          )}

          {/* ── Footer actions ────────────────────────────────── */}
          <div className="analysis-actions">
            {(status === 'idle' || status === 'error') && (
              <button
                className="action-btn --primary analysis-btn"
                onClick={handleAnalyze}
                disabled={!apiKey.trim()}
              >
                Analyze cook
              </button>
            )}
            {status === 'done' && (
              <button className="action-btn --secondary analysis-btn" onClick={handleAnalyze}>
                Re-analyze
              </button>
            )}
            {!showKey && apiKey && (
              <button
                className="log-action-btn"
                style={{ fontSize: 11, padding: '6px 10px' }}
                onClick={handleClearKey}
              >
                Remove API key
              </button>
            )}
            {showKey && (
              <button className="action-btn --secondary analysis-btn" onClick={onClose}>
                Cancel
              </button>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

// ── Minimal markdown renderer ─────────────────────────────────────────────────
// Handles: ## headers, ### headers, **bold**, - bullet lists, blank lines

function SimpleMarkdown({ text }) {
  const elements = [];
  let listItems  = [];

  function flushList(key) {
    if (listItems.length === 0) return;
    elements.push(<ul key={`ul-${key}`} className="md-ul">{listItems}</ul>);
    listItems = [];
  }

  text.split('\n').forEach((line, i) => {
    if (line.startsWith('### ')) {
      flushList(i);
      elements.push(<h3 key={i} className="md-h3">{renderInline(line.slice(4))}</h3>);
    } else if (line.startsWith('## ')) {
      flushList(i);
      elements.push(<h2 key={i} className="md-h2">{renderInline(line.slice(3))}</h2>);
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      listItems.push(<li key={i} className="md-li">{renderInline(line.slice(2))}</li>);
    } else if (line.trim() === '') {
      flushList(i);
      elements.push(<div key={i} className="md-spacer" />);
    } else {
      flushList(i);
      elements.push(<p key={i} className="md-p">{renderInline(line)}</p>);
    }
  });
  flushList('end');

  return <div className="md-content">{elements}</div>;
}

function renderInline(text) {
  // Split on **bold** markers
  const parts = text.split(/(\*\*[^*]+\*\*)/);
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : part,
  );
}
