export const THERMOMETER_STATE = {
  IDLE: 'idle',
  SCANNING: 'scanning',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  ERROR: 'error',
  UNSUPPORTED: 'unsupported',
};

export const THERMOMETER_TRANSPORT = {
  BLUETOOTH: 'bluetooth',
  CLOUD: 'cloud',
};

export const BRIDGE_SOURCE = {
  WIFI_ACCESSORY: 'wifi-accessory',
  HOME_DEVICE: 'home-device',
};

export const BRIDGE_SOURCE_LABEL = {
  [BRIDGE_SOURCE.WIFI_ACCESSORY]: 'Combustion WiFi accessory',
  [BRIDGE_SOURCE.HOME_DEVICE]: 'Home mobile bridge',
};
