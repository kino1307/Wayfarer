import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

export interface IconOption<T extends string> {
  value: T
  label: string
  icon?: ReactNode
}

interface Props<T extends string> {
  value: T
  options: IconOption<T>[]
  onChange: (v: T) => void
  disabled?: boolean
  triggerStyle?: CSSProperties
  align?: 'left' | 'right'
}

// A native <select> can't render an icon inside its <option> rows in any browser, so a dropdown
// with per-row logos needs this: a button + a floating list, closed on outside click.
export function IconSelect<T extends string>({ value, options, onChange, disabled, triggerStyle, align = 'left' }: Props<T>) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = options.find(o => o.value === value) ?? options[0]

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          border: '1px solid var(--border-strong)',
          borderRadius: 8,
          background: 'var(--surface)',
          color: 'var(--ink-muted)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontFamily: 'Helvetica, Arial, sans-serif',
          outline: 'none',
          ...triggerStyle,
        }}
      >
        {current?.icon}
        <span>{current?.label}</span>
        <span style={{ opacity: 0.5, fontSize: 9 }}>▾</span>
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            [align]: 0,
            minWidth: '100%',
            background: 'var(--surface-raised)',
            border: '1px solid var(--border-strong)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.14)',
            overflow: 'hidden',
            // Leaflet's own panes/controls run up to z-index 1000 — well above this component's
            // old value of 20, which let the map render on top of an open dropdown. Clear it.
            zIndex: 5000,
          }}
        >
          {options.map(opt => (
            <div
              key={opt.value}
              onClick={() => {
                onChange(opt.value)
                setOpen(false)
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                fontSize: 13,
                fontFamily: 'Helvetica, Arial, sans-serif',
                color: opt.value === value ? 'var(--ink)' : 'var(--ink-muted)',
                background: opt.value === value ? 'var(--accent-light)' : 'transparent',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => {
                if (opt.value !== value) e.currentTarget.style.background = 'var(--surface)'
              }}
              onMouseLeave={e => {
                if (opt.value !== value) e.currentTarget.style.background = 'transparent'
              }}
            >
              {opt.icon}
              <span>{opt.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
