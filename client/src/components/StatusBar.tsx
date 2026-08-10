import type { StatusState } from '../types'

interface Props {
  status: StatusState
}

const DOT_COLORS: Record<StatusState['phase'], string> = {
  idle: 'var(--ink-faint)',
  locations: 'var(--loading)',
  analysing: 'var(--loading)',
  done: 'var(--accent)',
  error: 'var(--danger)',
}

export function StatusBar({ status }: Props) {
  const isLoading = ['locations', 'analysing'].includes(status.phase)

  return (
    <div
      style={{
        padding: '8px 16px',
        borderTop: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexShrink: 0,
        minHeight: 36,
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: DOT_COLORS[status.phase],
          flexShrink: 0,
          animation: isLoading ? 'pulse 1.5s ease-in-out infinite' : 'none',
        }}
      />
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
      <span
        style={{
          fontFamily: "Helvetica, Arial, sans-serif",
          fontSize: 11,
          color:
            status.phase === 'error'
              ? 'var(--danger)'
              : status.phase === 'idle'
                ? 'var(--ink-faint)'
                : 'var(--ink-muted)',
          letterSpacing: '0.02em',
        }}
      >
        {status.phase === 'idle' ? 'Ready' : status.message}
      </span>
    </div>
  )
}
