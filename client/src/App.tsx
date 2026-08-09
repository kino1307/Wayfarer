import { useState, useEffect } from 'react'
import { Header } from './components/Header'
import { SearchBar } from './components/SearchBar'
import { ChipsRow } from './components/ChipsRow'
import { MapView } from './components/MapView'
import { Sidebar } from './components/Sidebar'
import { DisclaimerModal } from './components/DisclaimerModal'
import { useQuery } from './hooks/useQuery'
import { useHistory } from './hooks/useHistory'
import { nodeTrust, type ModelId } from './types'

// Filter pins by trust tier — the only per-node "type" axis that varies within one result
// (query_role is uniform per query). Labels mirror nodeTrust().marker.
const TIER_LABEL: Record<string, string> = { verified: 'Verified', geocoded: 'Geocoded', unverified: 'Unverified' }

function getInitialDark(): boolean {
  const stored = localStorage.getItem('wayfarer_dark')
  return stored === 'true'
}

export default function App() {
  // BYOK only: the key lives in the user's browser (localStorage), never embedded in the build.
  const [apiKey, setApiKey] = useState<string>(
    () => localStorage.getItem('wayfarer_api_key') ?? ''
  )
  const [model, setModel] = useState<ModelId>(
    () => (localStorage.getItem('wayfarer_model') as ModelId) ?? 'claude-sonnet-4-6'
  )
  const [isDark, setIsDark] = useState<boolean>(getInitialDark)
  const [searchValue, setSearchValue] = useState('')
  const [showDisclaimer, setShowDisclaimer] = useState(true)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
    localStorage.setItem('wayfarer_dark', String(isDark))
  }, [isDark])

  function handleApiKeyChange(key: string) {
    setApiKey(key)
    if (key) localStorage.setItem('wayfarer_api_key', key)
    else localStorage.removeItem('wayfarer_api_key')
  }

  function handleModelChange(m: ModelId) {
    setModel(m)
    localStorage.setItem('wayfarer_model', m)
  }

  const { history: _history, chips, chipsLoading, addToHistory, refreshChips } = useHistory(model, apiKey)

  const {
    result,
    selectedLocation,
    setSelectedLocation,
    insight,
    setInsight,
    status,
    analysingPattern,
    runStructured,
    analysePattern,
    cancel,
  } = useQuery(apiKey, model, addToHistory)

  const loading = status.phase === 'locations'

  // Tier filter (client-only). hidden = markers the user toggled off.
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const allLocations = result?.locations ?? []
  const presentTiers = [...new Set(allLocations.map(l => nodeTrust(l).marker))]
  const visibleLocations = allLocations.filter(l => !hidden.has(nodeTrust(l).marker))
  const filteredResult = result ? { ...result, locations: visibleLocations } : result
  function toggleTier(tier: string) {
    setHidden(prev => {
      const next = new Set(prev)
      next.has(tier) ? next.delete(tier) : next.add(tier)
      return next
    })
  }

  function handleSearch(query: string) {
    runStructured(query)
  }

  function handleChipClick(chip: string) {
    setSearchValue(chip)
    runStructured(chip)
  }

  function handleCancel() {
    cancel()
    setSearchValue('')
  }

  return (
    <>
    {showDisclaimer && <DisclaimerModal onDismiss={() => setShowDisclaimer(false)} />}
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <Header isDark={isDark} onToggleDark={() => setIsDark(d => !d)} />
      <SearchBar
        value={searchValue}
        onChange={setSearchValue}
        onSearch={handleSearch}
        onCancel={handleCancel}
        loading={loading}
        model={model}
        onModelChange={handleModelChange}
      />
      <ChipsRow chips={chips} loading={chipsLoading} onChipClick={handleChipClick} onRefresh={refreshChips} />

      {presentTiers.length > 1 && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '6px 16px', fontSize: 13, flexWrap: 'wrap' }}>
          <span style={{ opacity: 0.6 }}>Show:</span>
          {presentTiers.map(tier => (
            <label key={tier} style={{ display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={!hidden.has(tier)} onChange={() => toggleTier(tier)} />
              {TIER_LABEL[tier] ?? tier}
              <span style={{ opacity: 0.5 }}>
                ({allLocations.filter(l => nodeTrust(l).marker === tier).length})
              </span>
            </label>
          ))}
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <MapView
          locations={visibleLocations}
          selectedLocation={selectedLocation}
          isDark={isDark}
          loading={loading}
          loadingMessage={status.message}
        />
        <Sidebar
          result={filteredResult}
          selectedLocation={selectedLocation}
          onSelectLocation={setSelectedLocation}
          insight={insight}
          onDismissInsight={() => setInsight(null)}
          onAnalyse={analysePattern}
          analysingPattern={analysingPattern}
          status={status}
          apiKey={apiKey}
          onApiKeyChange={handleApiKeyChange}
        />
      </div>
    </div>
    </>
  )
}
