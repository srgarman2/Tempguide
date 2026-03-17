import { CATEGORIES } from '../data/temperatures';

export default function CategoryScreen({ navigate, SCREENS }) {
  return (
    <div className="screen category-screen">
      {/* Full-screen ambient background */}
      <div
        className="category-bg"
        style={{ background: 'radial-gradient(ellipse at 20% 50%, #1a0808 0%, #0a0404 60%, #050202 100%)' }}
      />

      <div className="category-hero" style={{ position: 'relative', zIndex: 1 }}>
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

      <div style={{ height: 40 }} />
    </div>
  );
}
