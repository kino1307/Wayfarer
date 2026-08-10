import { nodeTrust } from '../types'
import type { Location } from '../types'

interface Props {
  location: Location
  selected: boolean
  onClick: () => void
}

export function ResultItem({ location, selected, onClick }: Props) {
  const meta = [location.country, location.year].filter(Boolean).join(' · ')
  const tierLabel = nodeTrust(location).short ?? undefined

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
        {tierLabel && (
          <span
            style={{
              marginLeft: 6,
              fontFamily: "Helvetica, Arial, sans-serif",
              fontSize: 9,
              fontWeight: 400,
              color: '#9a6a1a',
              background: 'rgba(232,163,61,0.16)',
              border: '1px solid rgba(232,163,61,0.5)',
              borderRadius: 4,
              padding: '1px 5px',
              letterSpacing: '0.02em',
              verticalAlign: 'middle',
            }}
          >
            ⚠ {tierLabel}
          </span>
        )}
      </div>
      {meta && (
        <div
          style={{
            fontFamily: "Helvetica, Arial, sans-serif",
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
