interface Props {
  chips: string[]
  loading: boolean
  onChipClick: (chip: string) => void
  onRefresh: () => void
}

export function ChipsRow({ chips, loading, onChipClick, onRefresh }: Props) {
  return (
    <div
      style={{
        padding: '8px 16px',
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexShrink: 0,
        overflowX: 'auto',
        flexWrap: 'nowrap',
        scrollbarWidth: 'none',
      }}
    >
      <span
        style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 11,
          color: 'var(--ink-faint)',
          flexShrink: 0,
          letterSpacing: '0.05em',
        }}
      >
        Try:
      </span>
      <button
        onClick={onRefresh}
        disabled={loading}
        title="Regenerate suggestions"
        style={{
          flexShrink: 0,
          width: 22,
          height: 22,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px solid var(--border-strong)',
          borderRadius: '50%',
          background: 'transparent',
          cursor: loading ? 'not-allowed' : 'pointer',
          padding: 0,
          opacity: loading ? 0.4 : 1,
          transition: 'all 0.1s',
          color: 'var(--ink-faint)',
        }}
        onMouseEnter={e => {
          if (!loading) {
            e.currentTarget.style.borderColor = 'var(--accent)'
            e.currentTarget.style.color = 'var(--accent)'
          }
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderColor = 'var(--border-strong)'
          e.currentTarget.style.color = 'var(--ink-faint)'
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="1 4 1 10 7 10" />
          <path d="M3.51 15a9 9 0 1 0 .49-5.1L1 10" />
        </svg>
      </button>
      {loading ? (
        <span
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 11,
            color: 'var(--ink-faint)',
            fontStyle: 'italic',
          }}
        >
          generating suggestions…
        </span>
      ) : (
        chips.map((chip, i) => (
          <button
            key={i}
            onClick={() => onChipClick(chip)}
            style={{
              padding: '4px 12px',
              border: '1px solid var(--border-strong)',
              borderRadius: 99,
              background: 'var(--surface-raised)',
              fontSize: 12,
              fontFamily: "'DM Sans', sans-serif",
              color: 'var(--ink-muted)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              transition: 'all 0.1s',
            }}
            onMouseEnter={e => {
              const btn = e.currentTarget
              btn.style.borderColor = 'var(--accent)'
              btn.style.color = 'var(--accent-text)'
              btn.style.background = 'var(--accent-light)'
            }}
            onMouseLeave={e => {
              const btn = e.currentTarget
              btn.style.borderColor = 'var(--border-strong)'
              btn.style.color = 'var(--ink-muted)'
              btn.style.background = 'var(--surface-raised)'
            }}
          >
            {chip}
          </button>
        ))
      )}
    </div>
  )
}
