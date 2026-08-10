import { type KeyboardEvent } from 'react'
import { MODEL_OPTIONS, modelsForProvider, type ModelId, type Provider } from '../types'
import { IconSelect } from './IconSelect'
import { ProviderLogo } from './ProviderLogo'

interface Props {
  value: string
  onChange: (v: string) => void
  onSearch: (query: string) => void
  onCancel: () => void
  loading: boolean
  model: ModelId
  onModelChange: (m: ModelId) => void
  provider: Provider
}

export function SearchBar({ value, onChange, onSearch, onCancel, loading, model, onModelChange, provider }: Props) {
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
              fontFamily: "Helvetica, Arial, sans-serif",
              color: 'var(--ink)',
              outline: 'none',
            }}
          />
        </div>

        <IconSelect
          value={model}
          onChange={onModelChange}
          disabled={loading}
          align="right"
          triggerStyle={{ padding: '9px 10px', fontSize: 13 }}
          options={modelsForProvider(provider).map(opt => ({
            value: opt.id,
            label: opt.label,
            icon: <ProviderLogo provider={provider} />,
          }))}
        />

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
              fontFamily: "Helvetica, Arial, sans-serif",
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
              fontFamily: "Helvetica, Arial, sans-serif",
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

      {/* Source line — the model translates the query; Wikidata returns the full set */}
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
            fontFamily: "Helvetica, Arial, sans-serif",
            fontSize: 10,
            color: 'var(--ink-faint)',
            letterSpacing: '0.03em',
          }}
        >
          {modelInfo.label.split(' · ')[0]}
        </span>
        <span style={{ color: 'var(--border-strong)', fontSize: 10 }}>·</span>
        <span
          style={{
            fontFamily: "Helvetica, Arial, sans-serif",
            fontSize: 10,
            color: 'var(--ink-faint)',
            letterSpacing: '0.03em',
          }}
        >
          translates your query → Wikidata
        </span>
      </div>
    </div>
  )
}
