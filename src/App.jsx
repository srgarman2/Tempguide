import { useState, useRef, useEffect } from 'react';
import CategoryScreen from './components/CategoryScreen';
import ItemScreen from './components/ItemScreen';
import DonenessScreen from './components/DonenessScreen';
import CookingMethodScreen from './components/CookingMethodScreen';
import CookScreen from './components/CookScreen';
import RestScreen from './components/RestScreen';
import useThermometer from './hooks/useThermometer';
import useMeatNetCloud from './hooks/useMeatNetCloud';
import { THERMOMETER_TRANSPORT } from './constants/thermometer';

const SCREENS = {
  CATEGORY: 'category',
  ITEM:     'item',
  DONENESS: 'doneness',
  METHOD:   'method',
  COOK:     'cook',
  REST:     'rest',
};

const DEFAULT_SELECTION = {
  categoryId:      null,
  itemId:          null,
  donenessIndex:   null, // Index into item.doneness[]
  methodId:        null,
  thicknessInches: 1.0,
};

export default function App() {
  const [screen, setScreen]         = useState(SCREENS.CATEGORY);
  const [prevScreen, setPrevScreen] = useState(null);
  const [exiting, setExiting]       = useState(false);
  const [selection, setSelection]   = useState(DEFAULT_SELECTION);
  const [history, setHistory]       = useState([]);
  const [transport, setTransport]   = useState(THERMOMETER_TRANSPORT.BLUETOOTH);

  const bluetoothThermo = useThermometer();
  const cloudThermo = useMeatNetCloud();

  useEffect(() => {
    if (transport === THERMOMETER_TRANSPORT.CLOUD) {
      bluetoothThermo.disconnect();
    } else {
      cloudThermo.disconnect();
    }
  }, [transport]);

  const thermo = {
    ...(transport === THERMOMETER_TRANSPORT.CLOUD ? cloudThermo : bluetoothThermo),
    transport,
    setTransport,
  };

  // Navigate forward
  const navigate = (nextScreen, updates = {}) => {
    setHistory(h => [...h, screen]);
    setSelection(s => ({ ...s, ...updates }));
    setPrevScreen(screen);
    setExiting(true);
    setTimeout(() => {
      setExiting(false);
      setScreen(nextScreen);
    }, 200);
  };

  // Go back
  const goBack = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory(h => h.slice(0, -1));
    setPrevScreen(screen);
    setExiting(true);
    setTimeout(() => {
      setExiting(false);
      setScreen(prev);
    }, 200);
  };

  // Start a new cook from scratch
  const startOver = () => {
    setHistory([]);
    setSelection(DEFAULT_SELECTION);
    setPrevScreen(screen);
    setExiting(true);
    setTimeout(() => {
      setExiting(false);
      setScreen(SCREENS.CATEGORY);
    }, 200);
  };

  const screenProps = {
    selection,
    thermo,
    navigate,
    goBack,
    startOver,
    SCREENS,
  };

  const screenClass = `screen ${exiting ? 'screen-exit' : 'screen-enter'}`;

  return (
    <div className="app">
      <div key={screen} className={screenClass}>
        {screen === SCREENS.CATEGORY && (
          <CategoryScreen {...screenProps} />
        )}
        {screen === SCREENS.ITEM && (
          <ItemScreen {...screenProps} />
        )}
        {screen === SCREENS.DONENESS && (
          <DonenessScreen {...screenProps} />
        )}
        {screen === SCREENS.METHOD && (
          <CookingMethodScreen {...screenProps} />
        )}
        {screen === SCREENS.COOK && (
          <CookScreen {...screenProps} />
        )}
        {screen === SCREENS.REST && (
          <RestScreen {...screenProps} />
        )}
      </div>
    </div>
  );
}
