import { useState } from 'react';
import { BRIDGE_SOURCE, THERMOMETER_STATE, THERMOMETER_TRANSPORT } from '../constants/thermometer';

const STATE_LABEL = {
  [THERMOMETER_STATE.IDLE]:         'Connect Combustion Thermometer',
  [THERMOMETER_STATE.SCANNING]:     'Scanning for thermometer…',
  [THERMOMETER_STATE.CONNECTING]:   'Connecting…',
  [THERMOMETER_STATE.CONNECTED]:    'Thermometer connected',
  [THERMOMETER_STATE.DISCONNECTED]: 'Disconnected — tap to reconnect',
  [THERMOMETER_STATE.ERROR]:        'Connection error',
  [THERMOMETER_STATE.UNSUPPORTED]:  'Web Bluetooth unavailable (use Chrome)',
};

const CLOUD_STATE_LABEL = {
  [THERMOMETER_STATE.IDLE]:         'Sign in to MeatNet Cloud',
  [THERMOMETER_STATE.CONNECTING]:   'Connecting to MeatNet Cloud…',
  [THERMOMETER_STATE.CONNECTED]:    'Streaming from MeatNet Cloud',
  [THERMOMETER_STATE.DISCONNECTED]: 'Cloud connected — tap to resume stream',
  [THERMOMETER_STATE.ERROR]:        'Cloud connection error',
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
    isAuthenticated,
    authState,
    loginEmail,
    loginGoogle,
    loginApple,
    logout,
    bridgeSource,
    setBridgeSource,
    bridgeDevices,
    selectedBridgeId,
    setSelectedBridgeId,
    supportsAppleSignIn,
    lastUpdateIso,
    setTransport,
  } = thermo;

  const [showCloudControls, setShowCloudControls] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const isConnected = state === THERMOMETER_STATE.CONNECTED;
  const isUnsupported = state === THERMOMETER_STATE.UNSUPPORTED;
  const isCloud = transport === THERMOMETER_TRANSPORT.CLOUD;

  const handleClick = () => {
    if (isCloud) {
      setShowCloudControls(open => !open);
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

  return (
    <>
      <div className="transport-toggle" role="tablist" aria-label="Telemetry transport">
        <button
          type="button"
          className={`transport-toggle-btn ${!isCloud ? 'active' : ''}`}
          onClick={() => setTransport?.(THERMOMETER_TRANSPORT.BLUETOOTH)}
        >
          Bluetooth
        </button>
        <button
          type="button"
          className={`transport-toggle-btn ${isCloud ? 'active' : ''}`}
          onClick={() => setTransport?.(THERMOMETER_TRANSPORT.CLOUD)}
        >
          MeatNet Cloud
        </button>
      </div>

      <div
        className="thermo-bar"
        onClick={handleClick}
        title={errorMsg ?? (isConnected ? 'Click to disconnect' : 'Click to connect thermometer')}
      >
        <div className={`thermo-dot ${dotClass}`} />
        <span className="thermo-label">
          {isCloud
            ? (isConnected && deviceName
                ? `${deviceName} · ${CLOUD_STATE_LABEL[state] ?? 'MeatNet Cloud'}`
                : CLOUD_STATE_LABEL[state] ?? 'MeatNet Cloud')
            : (isConnected && deviceName
                ? deviceName
                : STATE_LABEL[state] ?? 'Thermometer')}
          {!batteryOk && isConnected && ' · low battery'}
        </span>
        {isConnected && coreTemp != null && (
          <span className="thermo-temp" style={{ color: accentColor }}>
            {coreTemp.toFixed(1)}°F
          </span>
        )}
        {!isCloud && !isConnected && !isUnsupported && (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: 0.5 }}>
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        )}
        {isCloud && (
          <button
            className="cloud-inline-action"
            style={{ borderColor: accentColor }}
            onClick={(e) => {
              e.stopPropagation();
              if (isConnected) {
                disconnect();
              } else {
                connect();
              }
            }}
          >
            {isConnected ? 'Pause' : 'Stream'}
          </button>
        )}
      </div>

      {isCloud && showCloudControls && (
        <div className="cloud-controls" onClick={(e) => e.stopPropagation()}>
          <div className="cloud-controls-row">
            <span className="cloud-controls-title">Bridge source</span>
            <select
              value={bridgeSource ?? BRIDGE_SOURCE.WIFI_ACCESSORY}
              onChange={(e) => setBridgeSource?.(e.target.value)}
            >
              <option value={BRIDGE_SOURCE.WIFI_ACCESSORY}>Combustion WiFi accessory</option>
              <option value={BRIDGE_SOURCE.HOME_DEVICE}>Home mobile bridge</option>
            </select>
          </div>

          {isAuthenticated && (
            <div className="cloud-controls-row">
              <span className="cloud-controls-title">Bridge device</span>
              <select
                value={selectedBridgeId ?? ''}
                onChange={(e) => setSelectedBridgeId?.(e.target.value || null)}
              >
                <option value="">Auto-select bridge</option>
                {(bridgeDevices ?? []).map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.name ?? device.id}
                  </option>
                ))}
              </select>
            </div>
          )}

          {!isAuthenticated && (
            <form
              className="cloud-auth-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!loginEmail) return;
                await loginEmail({ email: email.trim(), password });
              }}
            >
              <div className="cloud-auth-heading">MeatNet Cloud sign-in</div>
              <p style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.4 }}>
                Uses your MeatNet Cloud account (separate from the Combustion store).
              </p>
              {errorMsg && (
                <div className="cloud-auth-error">{errorMsg}</div>
              )}
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button type="submit" disabled={authState === 'authenticating'}>
                {authState === 'authenticating' ? 'Signing in...' : 'Sign in with email'}
              </button>
              <div className="cloud-oauth-actions">
                <button type="button" onClick={() => loginGoogle?.()}>Sign in with Google</button>
                {supportsAppleSignIn && (
                  <button type="button" onClick={() => loginApple?.()}>Sign in with Apple</button>
                )}
              </div>
            </form>
          )}

          {isAuthenticated && errorMsg && (
            <div className="cloud-auth-error">{errorMsg}</div>
          )}

          {isAuthenticated && (
            <div className="cloud-controls-footer">
              <span>
                {lastUpdateIso ? `Last cloud update: ${new Date(lastUpdateIso).toLocaleTimeString()}` : 'No cloud samples yet'}
              </span>
              <button type="button" onClick={() => logout?.()}>Sign out</button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
