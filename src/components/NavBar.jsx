export default function NavBar({ onBack, title, right }) {
  return (
    <div className="nav-bar">
      {onBack ? (
        <button className="nav-back" onClick={onBack}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Back
        </button>
      ) : <div className="nav-spacer" />}

      {title && <span className="nav-title">{title}</span>}

      {right ?? <div className="nav-spacer" />}
    </div>
  );
}
