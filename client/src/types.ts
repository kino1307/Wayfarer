export interface Location {
  name: string
  lat: number
  lng: number
  country: string
  description: string
  year: string | null
  wiki_url: string
}

export interface QueryResult {
  locations: Location[]
  mode: 'grounded' | 'memory'
  dropped: number
  wikiSource?: string
}

export type QueryMode = 'idle' | 'loading' | 'success' | 'error'

export type ModelId =
  | 'claude-haiku-4-5-20251001'
  | 'claude-sonnet-4-6'
  | 'claude-opus-4-6'

export const MODEL_OPTIONS: { id: ModelId; label: string; maxTokens: number; approxNodes: number }[] = [
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku — fast',   maxTokens:  8192, approxNodes: 50 },
  { id: 'claude-sonnet-4-6',         label: 'Sonnet — smart', maxTokens: 16000, approxNodes: 50 },
  { id: 'claude-opus-4-6',           label: 'Opus — best',    maxTokens: 16000, approxNodes: 50 },
]

export interface StatusState {
  phase:
    | 'idle'
    | 'titles'
    | 'wiki'
    | 'locations'
    | 'done'
    | 'error'
    | 'analysing'
  message: string
}
