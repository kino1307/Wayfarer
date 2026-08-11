import { useEffect, useState } from 'react'
import type { Location, Provider, QueryResult, StatusState } from '../types'
import { ResultItem } from './ResultItem'
import { InsightPanel } from './InsightPanel'
import { StatusBar } from './StatusBar'
import { IconSelect } from './IconSelect'
import { ProviderLogo } from './ProviderLogo'

const KEY_COPY: Record<Provider, { label: string; placeholder: string }> = {
  anthropic: { label: 'Anthropic', placeholder: 'sk-ant-…' },
  openai: { label: 'OpenAI', placeholder: 'sk-…' },
}

interface Props {
  result: QueryResult | null
  selectedLocation: Location | null
  onSelectLocation: (loc: Location) => void
  insight: string | null
  onDismissInsight: () => void
  onAnalyse: () => void
  analysingPattern: boolean
  status: StatusState
  apiKeys: Record<Provider, string>
  provider: Provider
  onProviderChange: (provider: Provider) => void
  onApiKeyChange: (provider: Provider, key: string) => void
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
  apiKeys,
  provider,
  onProviderChange,
  onApiKeyChange,
}: Props) {
  // Reflects whatever's saved for the selected provider, not a blank scratch pad — switching
  // provider or reopening the app shows the existing key (masked by type="password") instead of
  // silently going empty and looking like nothing was ever entered.
  const [keyInput, setKeyInput] = useState(apiKeys[provider] ?? '')
  useEffect(() => setKeyInput(apiKeys[provider] ?? ''), [provider])

  function saveKey() {
    const k = keyInput.trim()
    if (!k) return
    onApiKeyChange(provider, k)
  }

  const activeKey = apiKeys[provider]
  const hasKey = !!activeKey

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
      {/* Key setup — always available so both providers' keys can be managed/hot-swapped */}
      <div
        style={{
          padding: '16px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <IconSelect
            value={provider}
            onChange={onProviderChange}
            triggerStyle={{ padding: '6px 8px', fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase' }}
            options={(Object.keys(KEY_COPY) as Provider[]).map(p => ({
              value: p,
              label: KEY_COPY[p].label,
              icon: <ProviderLogo provider={p} />,
            }))}
          />
          <span
            style={{
              fontFamily: "Helvetica, Arial, sans-serif",
              fontSize: 10,
              color: hasKey ? 'var(--accent)' : 'var(--ink-faint)',
              display: 'flex',
              alignItems: 'center',
              whiteSpace: 'nowrap',
            }}
          >
            {hasKey ? 'key saved' : 'no key yet'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="password"
              value={keyInput}
              onChange={e => setKeyInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveKey()}
              placeholder={KEY_COPY[provider].placeholder}
              style={{
                flex: 1,
                padding: '8px 10px',
                border: '1px solid var(--border-strong)',
                borderRadius: 6,
                fontSize: 12,
                fontFamily: "Helvetica, Arial, sans-serif",
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
                fontFamily: "Helvetica, Arial, sans-serif",
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
                fontFamily: "Helvetica, Arial, sans-serif",
                fontSize: 10,
                color: 'var(--ink-faint)',
                letterSpacing: '0.05em',
              }}
            >
              {result.locations.length} nodes
            </span>
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
              fontFamily: "Helvetica, Arial, sans-serif",
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
          <>
          {result.enumerator === 'asserted' && result.locations.length > 0 && (
            <div
              style={{
                margin: '10px 12px',
                padding: '8px 10px',
                borderRadius: 6,
                background: 'rgba(232,163,61,0.10)',
                border: '1px solid rgba(232,163,61,0.4)',
              }}
            >
              <div
                style={{
                  fontFamily: "Helvetica, Arial, sans-serif",
                  fontSize: 10,
                  color: '#9a6a1a',
                  letterSpacing: '0.04em',
                  marginBottom: 4,
                }}
              >
                ⚠ Model-suggested results
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-muted)', lineHeight: 1.5 }}>
                Wikidata had no structured data for this query, so these were generated from
                the model's knowledge. Treat them — and their coordinates — with scepticism.
              </div>
            </div>
          )}
          {result.verification && (result.verification.status === 'flagged' || result.repaired) && (
            <div
              style={{
                margin: '10px 12px',
                padding: '8px 10px',
                borderRadius: 6,
                background: 'rgba(91,124,217,0.10)',
                border: '1px solid rgba(91,124,217,0.4)',
              }}
            >
              <div
                style={{
                  fontFamily: "Helvetica, Arial, sans-serif",
                  fontSize: 10,
                  color: '#3f5bbf',
                  letterSpacing: '0.04em',
                  marginBottom: 4,
                }}
              >
                {result.verification.status === 'flagged' ? '⚖ Verification flagged this result' : '✓ Verified'}
                {result.repaired ? ' · ↻ query auto-repaired' : ''}
              </div>
              {result.verification.notes.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, color: 'var(--ink-muted)', lineHeight: 1.55 }}>
                  {result.verification.notes.map((note, i) => (
                    <li key={i}>{note}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {result.unresolved && result.unresolved.length > 0 && (
            <div
              style={{
                margin: '10px 12px',
                padding: '8px 10px',
                borderRadius: 6,
                background: 'rgba(232,163,61,0.10)',
                border: '1px solid rgba(232,163,61,0.4)',
              }}
            >
              <div
                style={{
                  fontFamily: "Helvetica, Arial, sans-serif",
                  fontSize: 10,
                  color: '#9a6a1a',
                  letterSpacing: '0.04em',
                  marginBottom: 4,
                }}
              >
                ⚠ {result.unresolved.length} unresolved — no coordinate found
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-muted)', lineHeight: 1.5 }}>
                {result.unresolved.slice(0, 12).map(u => u.name).join(', ')}
                {result.unresolved.length > 12 ? `, +${result.unresolved.length - 12} more` : ''}
              </div>
            </div>
          )}
          {result.locations.length > 0 ? (
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
          )}
          </>
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
            {activeKey
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
