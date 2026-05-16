import { useState, useEffect } from 'react'
import { Header } from './components/Header'
import { SearchBar } from './components/SearchBar'
import { ChipsRow } from './components/ChipsRow'
import { MapView } from './components/MapView'
import { Sidebar } from './components/Sidebar'
import { DisclaimerModal } from './components/DisclaimerModal'
import { useQuery } from './hooks/useQuery'
import { useHistory } from './hooks/useHistory'
import type { ModelId } from './types'

function getInitialDark(): boolean {
  const stored = localStorage.getItem('terriq_dark')
  return stored === 'true'
}

export default function App() {
  const [apiKey, setApiKey] = useState<string>(
    () => localStorage.getItem('terriq_api_key') ?? import.meta.env.VITE_DEFAULT_API_KEY ?? ''
  )
  const [model, setModel] = useState<ModelId>(
    () => (localStorage.getItem('terriq_model') as ModelId) ?? 'claude-haiku-4-5-20251001'
  )
  const [isDark, setIsDark] = useState<boolean>(getInitialDark)
  const [searchValue, setSearchValue] = useState('')
  const [showDisclaimer, setShowDisclaimer] = useState(true)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
    localStorage.setItem('terriq_dark', String(isDark))
  }, [isDark])

  function handleApiKeyChange(key: string) {
    setApiKey(key)
    if (key) localStorage.setItem('terriq_api_key', key)
    else localStorage.removeItem('terriq_api_key')
  }

  function handleModelChange(m: ModelId) {
    setModel(m)
    localStorage.setItem('terriq_model', m)
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
    runQuery,
    analysePattern,
    cancel,
  } = useQuery(apiKey, model, addToHistory)

  const loading = ['titles', 'wiki', 'locations'].includes(status.phase)

  function handleSearch(query: string) {
    runQuery(query)
  }

  function handleChipClick(chip: string) {
    setSearchValue(chip)
    runQuery(chip)
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

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <MapView
          locations={result?.locations ?? []}
          selectedLocation={selectedLocation}
          isDark={isDark}
        />
        <Sidebar
          result={result}
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
