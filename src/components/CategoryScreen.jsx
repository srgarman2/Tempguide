import { useState, useEffect } from 'react';
import { CATEGORIES } from '../data/temperatures';
import { loadLog } from '../utils/cookLog';

export default function CategoryScreen({ navigate, SCREENS, useCelsius, toggleCelsius }) {
  const [logCount, setLogCount] = useState(0);
  useEffect(() => { setLogCount(loadLog().length); }, []);
  return (
    <div className="screen category-screen">
      {/* Full-screen ambient background */}
      <div
        className="category-bg"
        style={{ background: 'radial-gradient(ellipse at 20% 50%, #1a0808 0%, #0a0404 60%, #050202 100%)' }}
      />

      <div className="category-hero" style={{ position: 'relative', zIndex: 1 }}>
        {/* Unit toggle — inline in hero, right-aligned */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button
            onClick={toggleCelsius}
            style={{
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.18)',
              borderRadius: 20,
              color: 'rgba(240,240,240,0.85)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '5px 12px',
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: '0.02em',
            }}
            title={useCelsius ? 'Switch to °F / inches' : 'Switch to °C / cm'}
          >
            <span style={{ opacity: useCelsius ? 0.45 : 1 }}>°F</span>
            <span style={{
              width: 28, height: 16, borderRadius: 8,
              background: useCelsius ? 'rgba(76,222,128,0.7)' : 'rgba(255,255,255,0.2)',
              position: 'relative', display: 'inline-block',
              transition: 'background 0.2s',
            }}>
              <span style={{
                position: 'absolute', top: 2,
                left: useCelsius ? 14 : 2,
                width: 12, height: 12,
                borderRadius: '50%',
                background: '#fff',
                transition: 'left 0.2s',
              }} />
            </span>
            <span style={{ opacity: useCelsius ? 1 : 0.45 }}>°C</span>
          </button>
        </div>
        <h1>What are<br />you cooking?</h1>
        <p>Precision temperatures, rest times &amp; carryover physics.</p>
      </div>

      <div className="category-grid">
        {CATEGORIES.map((cat, i) => {
          const isWide = CATEGORIES.length % 2 !== 0 && i === CATEGORIES.length - 1;
          return (
            <button
              key={cat.id}
              className={`category-card${isWide ? ' wide' : ''}`}
              onClick={() => navigate(SCREENS.ITEM, { categoryId: cat.id })}
            >
              <div className="category-card-bg" style={{ background: cat.gradient }} />
              <div className="category-card-content">
                <span className="category-icon">{cat.icon}</span>
                <h3>{cat.label}</h3>
                <p className="category-card-count">
                  {cat.items.length} item{cat.items.length !== 1 ? 's' : ''}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Cook History link */}
      <div style={{ position: 'relative', zIndex: 1, padding: '0 20px 8px', textAlign: 'center' }}>
        <button
          className="log-history-btn"
          onClick={() => navigate(SCREENS.LOG)}
        >
          📋 Cook History{logCount > 0 ? ` (${logCount})` : ''}
        </button>
      </div>

      <div style={{ height: 40 }} />
    </div>
  );
}
