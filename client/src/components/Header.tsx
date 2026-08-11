interface Props {
  isDark: boolean
  onToggleDark: () => void
}

export function Header({ isDark, onToggleDark }: Props) {
  return (
    <header
      style={{
        background: 'var(--surface-raised)',
        borderBottom: '1px solid var(--border)',
        padding: '0 20px',
        height: 52,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
        zIndex: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
          <path
            d="M12 2C7.58 2 4 5.58 4 10c0 5.25 6.72 11.25 7.32 11.78a1 1 0 0 0 1.36 0C13.28 21.25 20 15.25 20 10c0-4.42-3.58-8-8-8z"
            stroke="var(--accent)"
            strokeWidth="1.6"
            fill="none"
          />
          <path d="M12 6.5l1.4 3.1 3.1 1.4-3.1 1.4-1.4 3.1-1.4-3.1-3.1-1.4 3.1-1.4z" fill="var(--accent)" />
        </svg>
        <span
          style={{
            fontFamily: "Helvetica, Arial, sans-serif",
            fontSize: 22,
            color: 'var(--ink)',
            letterSpacing: '-0.5px',
          }}
        >
          Wayfarer
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={onToggleDark}
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          style={{
            width: 30,
            height: 30,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid var(--border-strong)',
            borderRadius: 8,
            background: 'transparent',
            cursor: 'pointer',
            flexShrink: 0,
            opacity: 1,
            transition: 'border-color 0.15s, opacity 0.15s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = 'var(--accent)'
            e.currentTarget.style.opacity = '0.8'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = 'var(--border-strong)'
            e.currentTarget.style.opacity = '1'
          }}
        >
          {isDark ? (
            // Sun icon — matches the same amber pop used for the site's other dark/light toggle
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f5a623" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            // Moon icon — matches the same indigo pop used for the site's other dark/light toggle
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
      </div>
    </header>
  )
}
