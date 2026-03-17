import { getCategoryById, getItemById } from '../data/temperatures';
import { formatTemp } from '../utils/carryover';
import NavBar from './NavBar';

export default function DonenessScreen({ selection, navigate, goBack, SCREENS }) {
  const category = getCategoryById(selection.categoryId);
  const item = getItemById(selection.categoryId, selection.itemId);
  if (!category || !item) return null;

  const handleDoneness = (index) => {
    const d = item.doneness[index];
    if (!d.pullTemp && d.level !== 'Well Done') return;
    navigate(SCREENS.METHOD, { donenessIndex: index });
  };

  return (
    <div className="screen doneness-screen" style={{ '--accent': category.accentColor }}>
      <div className="category-bg" style={{ background: category.gradient, opacity: 0.6 }} />

      <NavBar onBack={goBack} title={item.label} />

      <div className="screen-header">
        <h2>How do you<br />like it done?</h2>
        <p>{item.label} • Choose your doneness</p>
      </div>

      <div className="doneness-list">
        {item.doneness.map((d, i) => {
          const isWellDone = d.level === 'Well Done';
          const endDisplay = isWellDone
            ? '¯\\_(ツ)_/¯'
            : d.endTemp
              ? typeof d.endTemp === 'object'
                ? `${d.endTemp.min}–${d.endTemp.max}°F`
                : `${d.endTemp}°F`
              : '—';

          const pullDisplay = isWellDone
            ? '—'
            : d.pullTemp
              ? typeof d.pullTemp === 'object'
                ? `Pull ${d.pullTemp.min}–${d.pullTemp.max}°F`
                : `Pull ${d.pullTemp}°F`
              : '—';

          return (
            <button
              key={d.level}
              className={`doneness-card ${isWellDone ? 'doneness-card--welldone' : ''}`}
              onClick={() => handleDoneness(i)}
              style={{ opacity: isWellDone ? 0.6 : 1 }}
            >
              <div
                className="doneness-swatch"
                style={{
                  background: d.color ?? '#555',
                  boxShadow: `0 0 0 3px ${d.color}22`,
                }}
              />
              <div className="doneness-info">
                <h3>{d.level}</h3>
                <p>{d.description ?? d.notes?.slice(0, 55) ?? ''}</p>
              </div>
              <div className="doneness-temps">
                <div className="target" style={{ color: d.color ?? 'inherit' }}>
                  {endDisplay}
                </div>
                <div className="pull">{pullDisplay}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
