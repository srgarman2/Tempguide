import { useState, useCallback } from 'react';
import { getItemById } from './data/temperatures';
import { loadSession, updateSession, clearSession } from './utils/cookSession';
import CategoryScreen from './components/CategoryScreen';
import ItemScreen from './components/ItemScreen';
import DonenessScreen from './components/DonenessScreen';
import CookingMethodScreen from './components/CookingMethodScreen';
import CookScreen from './components/CookScreen';
import RestScreen from './components/RestScreen';
import LogScreen from './components/LogScreen';
import useThermometer from './hooks/useThermometer';

const SCREENS = {
  CATEGORY: 'category',
  ITEM:     'item',
  DONENESS: 'doneness',
  METHOD:   'method',
  COOK:     'cook',
  REST:     'rest',
  LOG:      'log',
};

const DEFAULT_SELECTION = {
  categoryId:      null,
  itemId:          null,
  donenessIndex:   null, // Index into item.doneness[]
  methodId:        null,
  thicknessInches: 1.0,
  geometry:        'slab', // Cut shape: 'slab' | 'tapered' | 'cylinder'
  boneIn:          false,  // Bone-in cut (reduces carryover)
  isWrapped:       false,  // Foil / butcher paper rest (increases carryover)
};

export default function App() {
  const [screen, setScreen]         = useState(SCREENS.CATEGORY);
  const [prevScreen, setPrevScreen] = useState(null);
  const [exiting, setExiting]       = useState(false);
  const [selection, setSelection]   = useState(DEFAULT_SELECTION);
  const [history, setHistory]       = useState([]);
  const [useCelsius, setUseCelsius] = useState(() => {
    try { return localStorage.getItem('tempguide_celsius') === 'true'; } catch { return false; }
  });
  // A persisted mid-cook session from a previous page load — offered for resume.
  const [resumable, setResumable] = useState(() => {
    const s = loadSession();
    const validScreen = s?.screen
      && Object.values(SCREENS).includes(s.screen)
      && s.screen !== SCREENS.CATEGORY
      && s.screen !== SCREENS.LOG;
    return validScreen ? s : null;
  });
  const thermo = useThermometer();

  const toggleCelsius = useCallback(() => {
    setUseCelsius(prev => {
      const next = !prev;
      try { localStorage.setItem('tempguide_celsius', String(next)); } catch {}
      return next;
    });
  }, []);

  // Navigate forward
  const navigate = (nextScreen, updates = {}) => {
    const nextSelection  = { ...selection, ...updates };
    const nextNavHistory = [...history, screen];
    setHistory(nextNavHistory);
    setSelection(nextSelection);
    setResumable(null);   // user is navigating — stop offering the old session
    updateSession({
      screen: nextScreen,
      selection: nextSelection,
      navHistory: nextNavHistory,
      // A forward arrival is a fresh start for the data recorded on that
      // screen: new cook → clear the old curve and rest; new pull → new rest.
      ...(nextScreen === SCREENS.COOK ? { cook: null, rest: null } : {}),
      ...(nextScreen === SCREENS.REST ? { rest: null } : {}),
    });
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
    const nextNavHistory = history.slice(0, -1);
    setHistory(nextNavHistory);
    updateSession({ screen: prev, selection, navHistory: nextNavHistory });
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
    setResumable(null);
    clearSession();
    setPrevScreen(screen);
    setExiting(true);
    setTimeout(() => {
      setExiting(false);
      setScreen(SCREENS.CATEGORY);
    }, 200);
  };

  // Restore a persisted session (after reload / browser restart)
  const resumeSession = () => {
    const s = resumable;
    setResumable(null);
    if (!s?.screen) return;
    setSelection({ ...DEFAULT_SELECTION, ...(s.selection ?? {}) });
    setHistory(Array.isArray(s.navHistory) ? s.navHistory : []);
    setScreen(s.screen);
  };

  const discardSession = () => {
    clearSession();
    setResumable(null);
  };

  const screenProps = {
    selection,
    thermo,
    navigate,
    goBack,
    startOver,
    SCREENS,
    useCelsius,
    toggleCelsius,
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
        {screen === SCREENS.LOG && (
          <LogScreen goBack={goBack} useCelsius={useCelsius} />
        )}
      </div>

      {/* Resume prompt — shown when a mid-cook session survived a reload */}
      {resumable && (() => {
        const item = getItemById(resumable.selection?.categoryId, resumable.selection?.itemId);
        const agoMin = Math.max(1, Math.round((Date.now() - resumable.savedAt) / 60000));
        const ago = agoMin < 60 ? `${agoMin} min ago` : `${Math.round(agoMin / 60)} h ago`;
        const resting = resumable.screen === SCREENS.REST;
        return (
          <div style={{
            position: 'fixed', left: 16, right: 16, bottom: 20, zIndex: 100,
            background: '#1c1714', border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: 14, padding: '14px 16px', maxWidth: 480, margin: '0 auto',
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>
              {resting ? '⏱ Resume your rest timer?' : '🔥 Resume your cook?'}
            </div>
            <div style={{ fontSize: 12, color: 'rgba(240,240,240,0.55)', marginBottom: 10 }}>
              {item?.label ?? 'A cook'} · last active {ago}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={resumeSession}
                style={{
                  flex: 1, padding: '10px 0', borderRadius: 10, border: 'none',
                  background: '#4cde80', color: '#0a0a0a', fontWeight: 700,
                  fontSize: 13, cursor: 'pointer',
                }}
              >
                Resume
              </button>
              <button
                onClick={discardSession}
                style={{
                  flex: 1, padding: '10px 0', borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.2)', background: 'transparent',
                  color: 'rgba(240,240,240,0.8)', fontWeight: 600,
                  fontSize: 13, cursor: 'pointer',
                }}
              >
                Start fresh
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
