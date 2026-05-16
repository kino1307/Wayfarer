import { type KeyboardEvent } from 'react'
import { MODEL_OPTIONS, type ModelId } from '../types'

interface Props {
  value: string
  onChange: (v: string) => void
  onSearch: (query: string) => void
  onCancel: () => void
  loading: boolean
  model: ModelId
  onModelChange: (m: ModelId) => void
}

export function SearchBar({ value, onChange, onSearch, onCancel, loading, model, onModelChange }: Props) {
  const modelInfo = MODEL_OPTIONS.find(o => o.id === model) ?? MODEL_OPTIONS[0]

  function submit() {
    const q = value.trim()
    if (!q || loading) return
    onSearch(q)
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') submit()
    if (e.key === 'Escape' && loading) onCancel()
  }

  return (
    <div
      style={{
        background: 'var(--surface-raised)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}
    >
      {/* Input row */}
      <div style={{ padding: '12px 16px 8px', display: 'flex', gap: 8, alignItems: 'center' }}>
        <div
          style={{
            flex: 1,
            display: 'flex',
            border: '1px solid var(--border-strong)',
            borderRadius: 8,
            overflow: 'hidden',
            background: 'var(--surface)',
          }}
        >
          <input
            type="text"
            value={value}
            onChange={e => onChange(e.target.value)}
            onKeyDown={onKey}
            placeholder="e.g. WWI Western Front battlefields…"
            disabled={loading}
            style={{
              flex: 1,
              padding: '10px 14px',
              border: 'none',
              background: 'transparent',
              fontSize: 14,
              fontFamily: "'DM Sans', sans-serif",
              color: 'var(--ink)',
              outline: 'none',
            }}
          />
        </div>

        <select
          value={model}
          onChange={e => onModelChange(e.target.value as ModelId)}
          disabled={loading}
          style={{
            padding: '9px 10px',
            border: '1px solid var(--border-strong)',
            borderRadius: 8,
            background: 'var(--surface)',
            fontSize: 13,
            fontFamily: "'DM Sans', sans-serif",
            color: 'var(--ink-muted)',
            cursor: 'pointer',
            outline: 'none',
            flexShrink: 0,
          }}
        >
          {MODEL_OPTIONS.map(opt => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>

        {loading ? (
          <button
            onClick={onCancel}
            style={{
              padding: '9px 18px',
              background: 'transparent',
              color: 'var(--ink-muted)',
              border: '1px solid var(--border-strong)',
              borderRadius: 8,
              fontSize: 14,
              fontFamily: "'DM Sans', sans-serif",
              fontWeight: 500,
              cursor: 'pointer',
              flexShrink: 0,
              whiteSpace: 'nowrap',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'var(--danger)'
              e.currentTarget.style.color = 'var(--danger)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--border-strong)'
              e.currentTarget.style.color = 'var(--ink-muted)'
            }}
          >
            Cancel ✕
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={!value.trim()}
            style={{
              padding: '9px 18px',
              background: value.trim() ? 'var(--accent)' : 'var(--ink-faint)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 14,
              fontFamily: "'DM Sans', sans-serif",
              fontWeight: 500,
              cursor: value.trim() ? 'pointer' : 'not-allowed',
              flexShrink: 0,
              letterSpacing: '0.01em',
              transition: 'background 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            Map it →
          </button>
        )}
      </div>

      {/* Model cap disclaimer */}
      <div
        style={{
          padding: '0 16px 8px',
          display: 'flex',
          gap: 12,
          alignItems: 'center',
        }}
      >
        <span
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 10,
            color: 'var(--ink-faint)',
            letterSpacing: '0.03em',
          }}
        >
          {modelInfo.label.split(' — ')[0]}
        </span>
        <span style={{ color: 'var(--border-strong)', fontSize: 10 }}>·</span>
        <span
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 10,
            color: 'var(--ink-faint)',
            letterSpacing: '0.03em',
          }}
        >
          {modelInfo.maxTokens.toLocaleString()} token output cap
        </span>
        <span style={{ color: 'var(--border-strong)', fontSize: 10 }}>·</span>
        <span
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 10,
            color: 'var(--ink-faint)',
            letterSpacing: '0.03em',
          }}
        >
          ~{modelInfo.approxNodes} nodes max
        </span>
      </div>
    </div>
  )
}
