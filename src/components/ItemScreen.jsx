import { getCategoryById } from '../data/temperatures';
import { formatTemp } from '../utils/carryover';
import NavBar from './NavBar';

export default function ItemScreen({ selection, navigate, goBack, SCREENS }) {
  const category = getCategoryById(selection.categoryId);
  if (!category) return null;

  const handleItem = (item) => {
    if (item.hasDoneness) {
      navigate(SCREENS.DONENESS, { itemId: item.id });
    } else {
      navigate(SCREENS.METHOD, { itemId: item.id, donenessIndex: null });
    }
  };

  return (
    <div className="screen item-screen" style={{ '--accent': category.accentColor }}>
      <div className="category-bg" style={{ background: category.gradient, opacity: 0.6 }} />

      <NavBar onBack={goBack} title={category.label} />

      <div className="screen-header">
        <h2>{category.icon} {category.label}</h2>
        <p>Select what you're cooking</p>
      </div>

      <div className="item-list">
        {category.items.map(item => {
          const endTempDisplay = item.hasDoneness
            ? `${item.doneness[1]?.endTemp?.min ?? '—'}–${item.doneness[item.doneness.length - 2]?.endTemp?.max ?? '—'}°F`
            : formatTemp(item.endTemp ?? item.endTempRange ?? item.pullTemp);

          return (
            <button
              key={item.id}
              className="item-card"
              onClick={() => handleItem(item)}
            >
              <div className="item-card-text">
                <h3>{item.label}</h3>
                <p>{item.description}</p>
              </div>
              <div className="item-card-meta">
                {item.hasDoneness ? (
                  <>
                    <div className="temp-badge">Multiple</div>
                    <div className="temp-label">doneness levels</div>
                  </>
                ) : (
                  <>
                    <div className="temp-badge">{endTempDisplay}</div>
                    <div className="temp-label">target</div>
                  </>
                )}
              </div>
              <svg className="item-card-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          );
        })}
      </div>
    </div>
  );
}
