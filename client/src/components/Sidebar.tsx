import { useState } from 'react'
import type { Location, QueryResult, StatusState } from '../types'
import { ResultItem } from './ResultItem'
import { InsightPanel } from './InsightPanel'
import { StatusBar } from './StatusBar'

interface Props {
  result: QueryResult | null
  selectedLocation: Location | null
  onSelectLocation: (loc: Location) => void
  insight: string | null
  onDismissInsight: () => void
  onAnalyse: () => void
  analysingPattern: boolean
  status: StatusState
  apiKey: string
  onApiKeyChange: (key: string) => void
}

export function Sidebar({
  result,
  selectedLocation,
  onSelectLocation,
  insight,
  onDismissInsight,
  onAnalyse,
  analysingPattern,
  status,
  apiKey,
  onApiKeyChange,
}: Props) {
  const [keyInput, setKeyInput] = useState('')
  const [saved, setSaved] = useState(false)

  function saveKey() {
    const k = keyInput.trim()
    if (!k) return
    onApiKeyChange(k)
    setKeyInput('')
    setSaved(true)
  }

  const showSetup = !apiKey && !saved

  return (
    <div
      style={{
        width: 300,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--surface-raised)',
        borderLeft: '1px solid var(--border)',
        overflow: 'hidden',
      }}
    >
      {/* Setup panel */}
      {showSetup && (
        <div
          style={{
            padding: '16px',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 10,
              color: 'var(--ink-faint)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              marginBottom: 8,
            }}
          >
            Anthropic API Key
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="password"
              value={keyInput}
              onChange={e => setKeyInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveKey()}
              placeholder="sk-ant-…"
              style={{
                flex: 1,
                padding: '8px 10px',
                border: '1px solid var(--border-strong)',
                borderRadius: 6,
                fontSize: 12,
                fontFamily: "'DM Mono', monospace",
                background: 'var(--surface)',
                color: 'var(--ink)',
                outline: 'none',
              }}
            />
            <button
              onClick={saveKey}
              style={{
                padding: '8px 12px',
                background: 'var(--accent)',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: "'DM Sans', sans-serif",
              }}
            >
              Save
            </button>
          </div>
          <p
            style={{
              fontSize: 11,
              color: 'var(--ink-faint)',
              marginTop: 6,
              lineHeight: 1.5,
            }}
          >
            Key sent with each request. Never stored server-side.
          </p>
        </div>
      )}

      {/* Results header */}
      {result && (
        <div
          style={{
            padding: '10px 14px 8px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexShrink: 0,
          }}
        >
          <div>
            <span
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 10,
                color: 'var(--ink-faint)',
                letterSpacing: '0.05em',
              }}
            >
              {result.locations.length} locations
            </span>
            {result.wikiSource && (
              <div
                style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 10,
                  color: 'var(--accent)',
                  marginTop: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: 180,
                }}
                title={result.wikiSource}
              >
                ↗ {result.wikiSource}
              </div>
            )}
          </div>
          <button
            onClick={onAnalyse}
            disabled={analysingPattern || result.locations.length === 0}
            style={{
              padding: '5px 10px',
              border: '1px solid var(--border-strong)',
              borderRadius: 6,
              background: analysingPattern ? 'var(--surface)' : 'var(--surface)',
              fontSize: 11,
              fontFamily: "'DM Sans', sans-serif",
              color: analysingPattern ? 'var(--ink-faint)' : 'var(--ink-muted)',
              cursor: analysingPattern ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {analysingPattern ? '…' : '◎ Analyse pattern'}
          </button>
        </div>
      )}

      {/* Results list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {status.phase === 'error' ? (
          <div
            style={{
              padding: 20,
              margin: 12,
              borderRadius: 8,
              background: 'color-mix(in srgb, var(--danger) 10%, var(--surface))',
              border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)',
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--danger)', marginBottom: 4 }}>
              Error
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-muted)', lineHeight: 1.5 }}>
              {status.message}
            </div>
          </div>
        ) : result ? (
          result.locations.length > 0 ? (
            result.locations.map((loc) => (
              <ResultItem
                key={`${loc.name}::${loc.country}`}
                location={loc}
                selected={selectedLocation?.name === loc.name && selectedLocation?.country === loc.country}
                onClick={() => onSelectLocation(loc)}
              />
            ))
          ) : (
            <div
              style={{
                padding: 24,
                textAlign: 'center',
                color: 'var(--ink-faint)',
                fontSize: 13,
              }}
            >
              No locations found
            </div>
          )
        ) : (
          <div
            style={{
              padding: 24,
              textAlign: 'center',
              color: 'var(--ink-faint)',
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            {apiKey
              ? 'Enter a query and click Map it →'
              : 'Add your API key above to get started'}
          </div>
        )}
      </div>

      {/* Insight panel */}
      {insight && <InsightPanel insight={insight} onDismiss={onDismissInsight} />}

      {/* Status bar */}
      <StatusBar status={status} />
    </div>
  )
}
