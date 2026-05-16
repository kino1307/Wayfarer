interface Props {
  onDismiss: () => void
}

export function DisclaimerModal({ onDismiss }: Props) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(26, 26, 24, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 24,
      }}
      onClick={onDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Disclaimer"
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--surface-raised)',
          borderRadius: 12,
          padding: '32px 36px',
          maxWidth: 480,
          width: '100%',
          boxShadow: '0 8px 40px rgba(26,26,24,0.18)',
          border: '1px solid var(--border)',
        }}
      >
        <div style={{ marginBottom: 20 }}>
          <span style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 10,
            letterSpacing: '0.1em',
            color: 'var(--ink-faint)',
            textTransform: 'uppercase',
          }}>
            Heads up
          </span>
          <h2 style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: 20,
            fontWeight: 600,
            color: 'var(--ink)',
            margin: '6px 0 0',
          }}>
            Pins aren't always perfect
          </h2>
        </div>

        <div style={{
          fontFamily: "'DM Sans', sans-serif",
          fontSize: 14,
          lineHeight: 1.65,
          color: 'var(--ink-muted)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}>
          <p style={{ margin: 0 }}>
            Terriq uses Claude to find and map locations, backed up by Wikipedia where possible.
            For well-documented stuff like historical events, established artists, and geography, it tends to do a decent job.
          </p>
          <p style={{ margin: 0 }}>
            For <strong style={{ color: 'var(--ink)', fontWeight: 500 }}>recent or niche topics</strong> (think newly formed groups, emerging artists, or anything from the past year or so),
            the model can sound very confident while being completely wrong. It will sometimes invent birthplaces, members, or locations that do not exist.
            Wikipedia grounding cuts this down significantly, but it is not foolproof.
          </p>
          <p style={{ margin: 0 }}>
            Hollow pins are unverified and worth treating with a bit of scepticism. Filled pins have been cross-checked against Wikipedia and are generally more reliable, though still worth a second look for anything important.
          </p>
        </div>

        <button
          onClick={onDismiss}
          style={{
            marginTop: 28,
            width: '100%',
            padding: '10px 0',
            background: 'var(--accent)',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 14,
            fontFamily: "'DM Sans', sans-serif",
            fontWeight: 500,
            cursor: 'pointer',
            letterSpacing: '0.01em',
          }}
        >
          Got it
        </button>
      </div>
    </div>
  )
}
