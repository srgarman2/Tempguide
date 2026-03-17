import { THERMOMETER_STATE } from '../hooks/useThermometer';

const STATE_LABEL = {
  [THERMOMETER_STATE.IDLE]:         'Connect Combustion Thermometer',
  [THERMOMETER_STATE.SCANNING]:     'Scanning for thermometer…',
  [THERMOMETER_STATE.CONNECTING]:   'Connecting…',
  [THERMOMETER_STATE.CONNECTED]:    'Thermometer connected',
  [THERMOMETER_STATE.DISCONNECTED]: 'Disconnected — tap to reconnect',
  [THERMOMETER_STATE.ERROR]:        'Connection error',
  [THERMOMETER_STATE.UNSUPPORTED]:  'Web Bluetooth unavailable (use Chrome)',
};

export default function ThermoBar({ thermo, accentColor }) {
  const { state, coreTemp, deviceName, batteryOk, errorMsg, connect, disconnect } = thermo;
  const isConnected = state === THERMOMETER_STATE.CONNECTED;
  const isUnsupported = state === THERMOMETER_STATE.UNSUPPORTED;

  const handleClick = () => {
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
    <div
      className="thermo-bar"
      onClick={handleClick}
      title={errorMsg ?? (isConnected ? 'Click to disconnect' : 'Click to connect thermometer')}
    >
      <div className={`thermo-dot ${dotClass}`} />
      <span className="thermo-label">
        {isConnected && deviceName
          ? deviceName
          : STATE_LABEL[state] ?? 'Thermometer'}
        {!batteryOk && isConnected && ' · 🔋 Low battery'}
      </span>
      {isConnected && coreTemp != null && (
        <span className="thermo-temp" style={{ color: accentColor }}>
          {coreTemp.toFixed(1)}°F
        </span>
      )}
      {!isConnected && !isUnsupported && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: 0.5 }}>
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      )}
    </div>
  );
}
