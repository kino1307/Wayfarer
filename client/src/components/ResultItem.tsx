import type { Location } from '../types'

interface Props {
  location: Location
  selected: boolean
  onClick: () => void
}

export function ResultItem({ location, selected, onClick }: Props) {
  const meta = [location.country, location.year].filter(Boolean).join(' · ')

  return (
    <button
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        padding: '10px 14px',
        textAlign: 'left',
        border: 'none',
        background: selected ? 'var(--accent-light)' : 'transparent',
        borderLeft: selected ? '2px solid var(--accent)' : '2px solid transparent',
        cursor: 'pointer',
        transition: 'all 0.1s',
      }}
      onMouseEnter={e => {
        if (!selected) {
          e.currentTarget.style.background = 'var(--border)'
        }
      }}
      onMouseLeave={e => {
        if (!selected) {
          e.currentTarget.style.background = 'transparent'
        }
      }}
    >
      <div
        style={{
          fontWeight: 500,
          color: selected ? 'var(--accent-text)' : 'var(--ink)',
          fontSize: 13,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          marginBottom: 2,
        }}
      >
        {location.name}
      </div>
      {meta && (
        <div
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 10,
            color: 'var(--ink-faint)',
            marginBottom: 4,
            letterSpacing: '0.02em',
          }}
        >
          {meta}
        </div>
      )}
      <div
        style={{
          fontSize: 12,
          color: 'var(--ink-muted)',
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          lineHeight: '1.5',
        }}
      >
        {location.description}
      </div>
    </button>
  )
}
