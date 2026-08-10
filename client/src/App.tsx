import { useState, useEffect } from 'react'
import { Header } from './components/Header'
import { SearchBar } from './components/SearchBar'
import { ChipsRow } from './components/ChipsRow'
import { MapView } from './components/MapView'
import { Sidebar } from './components/Sidebar'
import { DisclaimerModal } from './components/DisclaimerModal'
import { useQuery } from './hooks/useQuery'
import { useHistory } from './hooks/useHistory'
import { nodeTrust, type ModelId, type Provider } from './types'

// Filter pins by trust tier — the only per-node "type" axis that varies within one result
// (query_role is uniform per query). Labels mirror nodeTrust().marker.
const TIER_LABEL: Record<string, string> = { verified: 'Verified', geocoded: 'Geocoded', unverified: 'Unverified' }

function getInitialDark(): boolean {
  const stored = localStorage.getItem('wayfarer_dark')
  return stored === 'true'
}

// One localStorage slot per provider — switching providers shouldn't blow away a key or model
// choice you already made for the other one.
const KEY_STORAGE: Record<Provider, string> = { anthropic: 'wayfarer_api_key', openai: 'wayfarer_api_key_openai' }
const MODEL_STORAGE: Record<Provider, string> = { anthropic: 'wayfarer_model_anthropic', openai: 'wayfarer_model_openai' }
const DEFAULT_MODEL: Record<Provider, ModelId> = { anthropic: 'claude-sonnet-4-6', openai: 'openai:gpt-5.6-terra' }

export default function App() {
  // Provider is the primary choice now — it decides which key is sent AND which models the
  // SearchBar dropdown offers. Model is remembered per-provider, so flipping back to a provider
  // you'd already picked a model for doesn't reset it to the default.
  const [provider, setProvider] = useState<Provider>(
    () => (localStorage.getItem('wayfarer_provider') as Provider) ?? 'anthropic'
  )
  const [modelByProvider, setModelByProvider] = useState<Record<Provider, ModelId>>(() => ({
    anthropic: (localStorage.getItem(MODEL_STORAGE.anthropic) as ModelId) ?? DEFAULT_MODEL.anthropic,
    openai: (localStorage.getItem(MODEL_STORAGE.openai) as ModelId) ?? DEFAULT_MODEL.openai,
  }))
  const model = modelByProvider[provider]
  // BYOK only: keys live in the user's browser (localStorage), never embedded in the build.
  const [apiKeys, setApiKeys] = useState<Record<Provider, string>>(() => ({
    anthropic: localStorage.getItem(KEY_STORAGE.anthropic) ?? '',
    openai: localStorage.getItem(KEY_STORAGE.openai) ?? '',
  }))
  const apiKey = apiKeys[provider]
  const [isDark, setIsDark] = useState<boolean>(getInitialDark)
  const [searchValue, setSearchValue] = useState('')
  const [showDisclaimer, setShowDisclaimer] = useState(true)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
    localStorage.setItem('wayfarer_dark', String(isDark))
  }, [isDark])

  function handleApiKeyChange(p: Provider, key: string) {
    setApiKeys(prev => ({ ...prev, [p]: key }))
    const slot = KEY_STORAGE[p]
    if (key) localStorage.setItem(slot, key)
    else localStorage.removeItem(slot)
  }

  function handleProviderChange(p: Provider) {
    setProvider(p)
    localStorage.setItem('wayfarer_provider', p)
  }

  function handleModelChange(m: ModelId) {
    setModelByProvider(prev => ({ ...prev, [provider]: m }))
    localStorage.setItem(MODEL_STORAGE[provider], m)
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
        provider={provider}
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
          apiKeys={apiKeys}
          provider={provider}
          onProviderChange={handleProviderChange}
          onApiKeyChange={handleApiKeyChange}
        />
      </div>
    </div>
    </>
  )
}
