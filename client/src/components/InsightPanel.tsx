interface Props {
  insight: string
  onDismiss: () => void
}

export function InsightPanel({ insight, onDismiss }: Props) {
  return (
    <div
      style={{
        margin: '0 12px 12px',
        padding: '12px 14px',
        background: 'var(--accent-light)',
        border: '1px solid var(--border-strong)',
        borderRadius: 8,
        position: 'relative',
        flexShrink: 0,
      }}
    >
      <button
        onClick={onDismiss}
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--ink-faint)',
          fontSize: 16,
          lineHeight: 1,
          padding: '0 2px',
        }}
        aria-label="Dismiss"
      >
        ×
      </button>
      <div
        style={{
          fontFamily: "Helvetica, Arial, sans-serif",
          fontSize: 10,
          color: 'var(--accent)',
          letterSpacing: '0.08em',
          fontWeight: 500,
          marginBottom: 6,
          textTransform: 'uppercase',
        }}
      >
        Pattern Analysis
      </div>
      <p
        style={{
          fontSize: 12,
          color: 'var(--accent-text)',
          lineHeight: 1.6,
          paddingRight: 16,
          maxHeight: 180,
          overflowY: 'auto',
        }}
      >
        {insight}
      </p>
    </div>
  )
}
