import { useState } from 'react';
import { THERMOMETER_STATE, THERMOMETER_TRANSPORT } from '../constants/thermometer';

const BLE_STATE_LABEL = {
  [THERMOMETER_STATE.IDLE]:         'Connect Combustion Thermometer',
  [THERMOMETER_STATE.SCANNING]:     'Scanning for thermometer…',
  [THERMOMETER_STATE.CONNECTING]:   'Connecting…',
  [THERMOMETER_STATE.CONNECTED]:    'Thermometer connected',
  [THERMOMETER_STATE.DISCONNECTED]: 'Disconnected — tap to reconnect',
  [THERMOMETER_STATE.ERROR]:        'Connection error',
  [THERMOMETER_STATE.UNSUPPORTED]:  'Web Bluetooth unavailable (use Chrome)',
};

const WIFI_STATE_LABEL = {
  [THERMOMETER_STATE.IDLE]:         'Enter bridge address to connect',
  [THERMOMETER_STATE.CONNECTING]:   'Connecting to WiFi bridge…',
  [THERMOMETER_STATE.CONNECTED]:    'Streaming from WiFi bridge',
  [THERMOMETER_STATE.DISCONNECTED]: 'Bridge paused — tap to resume',
  [THERMOMETER_STATE.ERROR]:        'WiFi bridge error',
};

export default function ThermoBar({ thermo, accentColor }) {
  const {
    state,
    coreTemp,
    deviceName,
    batteryOk,
    errorMsg,
    connect,
    disconnect,
    transport = THERMOMETER_TRANSPORT.BLUETOOTH,
    bridgeAddress,
    setBridgeAddress,
    bridgePath,
    setBridgePath,
    probeResults,
    lastUpdateIso,
    setTransport,
  } = thermo;

  const [showWifiPanel, setShowWifiPanel] = useState(false);
  const [addressInput, setAddressInput] = useState(bridgeAddress ?? '');
  const [pathInput, setPathInput] = useState(bridgePath ?? '');

  const isConnected = state === THERMOMETER_STATE.CONNECTED;
  const isUnsupported = state === THERMOMETER_STATE.UNSUPPORTED;
  const isWifi = transport === THERMOMETER_TRANSPORT.WIFI;

  const handleClick = () => {
    if (isWifi) {
      setShowWifiPanel(open => !open);
      return;
    }
    if (isConnected) {
      disconnect();
    } else if (!isUnsupported) {
      connect();
    }
  };

  const dotClass = {
    [THERMOMETER_STATE.IDLE]:         'idle',
    [THERMOMETER_STATE.SCANNING]:     'scanning',
    [THERMOMETER_STATE.CONNECTING]:   'connecting',
    [THERMOMETER_STATE.CONNECTED]:    'connected',
    [THERMOMETER_STATE.DISCONNECTED]: 'disconnected',
    [THERMOMETER_STATE.ERROR]:        'error',
    [THERMOMETER_STATE.UNSUPPORTED]:  'idle',
  }[state] ?? 'idle';

  const stateLabels = isWifi ? WIFI_STATE_LABEL : BLE_STATE_LABEL;

  return (
    <>
      <div className="transport-toggle" role="tablist" aria-label="Telemetry transport">
        <button
          type="button"
          className={`transport-toggle-btn ${!isWifi ? 'active' : ''}`}
          onClick={() => setTransport?.(THERMOMETER_TRANSPORT.BLUETOOTH)}
        >
          Bluetooth
        </button>
        <button
          type="button"
          className={`transport-toggle-btn ${isWifi ? 'active' : ''}`}
          onClick={() => setTransport?.(THERMOMETER_TRANSPORT.WIFI)}
        >
          WiFi Bridge
        </button>
      </div>

      <div
        className="thermo-bar"
        onClick={handleClick}
        title={errorMsg ?? (isConnected ? 'Click to disconnect' : 'Click to connect')}
      >
        <div className={`thermo-dot ${dotClass}`} />
        <span className="thermo-label">
          {isConnected && deviceName
            ? deviceName
            : stateLabels[state] ?? 'Thermometer'}
          {!batteryOk && isConnected && ' · low battery'}
        </span>
        {isConnected && coreTemp != null && (
          <span className="thermo-temp" style={{ color: accentColor }}>
            {coreTemp.toFixed(1)}°F
          </span>
        )}
        {!isWifi && !isConnected && !isUnsupported && (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: 0.5 }}>
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        )}
        {isWifi && isConnected && (
          <button
            className="cloud-inline-action"
            style={{ borderColor: accentColor }}
            onClick={(e) => { e.stopPropagation(); disconnect(); }}
          >
            Pause
          </button>
        )}
      </div>

      {isWifi && showWifiPanel && (
        <div className="cloud-controls" onClick={(e) => e.stopPropagation()}>
          <div className="cloud-auth-heading">Combustion WiFi Bridge</div>
          <p style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.4 }}>
            Enter the local IP or hostname of your Combustion WiFi accessory.
            The app will probe the device to find its telemetry endpoint.
          </p>
          {errorMsg && (
            <div className="cloud-auth-error">{errorMsg}</div>
          )}
          <form
            className="cloud-auth-form"
            onSubmit={(e) => {
              e.preventDefault();
              setBridgeAddress?.(addressInput.trim());
              if (pathInput.trim()) setBridgePath?.(pathInput.trim());
              connect();
            }}
          >
            <input
              type="text"
              placeholder="e.g. 192.168.1.42"
              value={addressInput}
              onChange={(e) => setAddressInput(e.target.value)}
              required
            />
            <input
              type="text"
              placeholder="Endpoint path (auto-detected if blank)"
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              style={{ fontSize: 11 }}
            />
            <button type="submit" disabled={state === THERMOMETER_STATE.CONNECTING}>
              {state === THERMOMETER_STATE.CONNECTING ? 'Probing device…'
                : isConnected ? 'Reconnect'
                : 'Connect'}
            </button>
          </form>

          {bridgePath && (
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              Using endpoint: <strong>{bridgePath}</strong>
            </div>
          )}

          {probeResults && !isConnected && (
            <details style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              <summary style={{ cursor: 'pointer' }}>
                Probe results ({probeResults.filter((r) => r.status === 200).length}/{probeResults.length} responsive)
              </summary>
              <div style={{ marginTop: 4, maxHeight: 150, overflow: 'auto', lineHeight: 1.5 }}>
                {probeResults.map((r, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6 }}>
                    <code style={{ minWidth: 140 }}>{r.path}</code>
                    <span>
                      {r.status === 200 && r.isJson ? '✅ JSON' :
                       r.status === 200 ? `✅ ${r.contentType?.split(';')[0] || 'ok'}` :
                       r.status > 0 ? `❌ ${r.status}` :
                       `⚠️ ${r.error?.slice(0, 40) || 'timeout'}`}
                    </span>
                    {r.isJson && (
                      <button
                        type="button"
                        style={{
                          fontSize: 10, padding: '1px 6px', borderRadius: 4,
                          border: '1px solid var(--border)', background: 'rgba(255,255,255,0.06)',
                          color: 'var(--text-primary)', cursor: 'pointer'
                        }}
                        onClick={() => {
                          setPathInput(r.path);
                          setBridgePath?.(r.path);
                        }}
                      >
                        Use
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </details>
          )}

          {isConnected && (
            <div className="cloud-controls-footer">
              <span>
                {lastUpdateIso ? `Last update: ${new Date(lastUpdateIso).toLocaleTimeString()}` : 'No data yet'}
              </span>
              <button type="button" onClick={() => disconnect()}>Disconnect</button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
