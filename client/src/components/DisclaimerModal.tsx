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
            fontFamily: "Helvetica, Arial, sans-serif",
            fontSize: 10,
            letterSpacing: '0.1em',
            color: 'var(--ink-faint)',
            textTransform: 'uppercase',
          }}>
            Heads up
          </span>
          <h2 style={{
            fontFamily: "Helvetica, Arial, sans-serif",
            fontSize: 20,
            fontWeight: 600,
            color: 'var(--ink)',
            margin: '6px 0 0',
          }}>
            How Wayfarer maps your query
          </h2>
        </div>

        <div style={{
          fontFamily: "Helvetica, Arial, sans-serif",
          fontSize: 14,
          lineHeight: 1.65,
          color: 'var(--ink-muted)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}>
          <p style={{ margin: 0 }}>
            Wayfarer uses an LLM (Claude or GPT — your choice) to translate your query into a <strong style={{ color: 'var(--ink)', fontWeight: 500 }}>Wikidata</strong> query — a
            structured, community-maintained knowledge base — then plots what Wikidata returns.
            For well-modelled topics (capitals, members of a group, battles) the results are precise and grounded.
          </p>
          <p style={{ margin: 0 }}>
            When Wikidata has no data for a query (subjective or very recent topics), Wayfarer falls
            back to <strong style={{ color: 'var(--ink)', fontWeight: 500 }}>the model's own knowledge</strong>. The model can sound confident while being
            completely wrong — inventing places or members that do not exist. Those results are flagged.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 2 }}>
            {[
              { dot: 'solid var(--accent)', fill: 'var(--accent)', label: 'Verified', desc: 'coordinate and membership confirmed by Wikidata' },
              { dot: 'solid #e8a33d', fill: '#e8a33d', label: 'Unverified location', desc: 'real entity, but coordinate is geocoded or estimated' },
              { dot: 'dashed #e8a33d', fill: 'transparent', label: 'Model-suggested', desc: "the model's own guess — treat with scepticism" },
            ].map(row => (
              <div key={row.label} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span style={{
                  width: 11, height: 11, borderRadius: '50%', flexShrink: 0,
                  background: row.fill, border: `2px ${row.dot}`,
                }} />
                <span style={{ fontSize: 13 }}>
                  <strong style={{ color: 'var(--ink)', fontWeight: 500 }}>{row.label}</strong>
                  <span style={{ color: 'var(--ink-faint)' }}> — {row.desc}</span>
                </span>
              </div>
            ))}
          </div>
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
            fontFamily: "Helvetica, Arial, sans-serif",
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
