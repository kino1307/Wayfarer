import { useEffect, useRef } from 'react'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Location } from '../types'

// Fix default icon issue
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

// Module-level cache so images survive popup close/reopen within a session
const imageCache = new Map<string, string>()

async function fetchWikiThumbnail(wikiUrl: string): Promise<string | null> {
  if (imageCache.has(wikiUrl)) return imageCache.get(wikiUrl) || null
  const match = wikiUrl.match(/\/wiki\/(.+)$/)
  if (!match) return null
  const params = new URLSearchParams({
    action: 'query',
    titles: decodeURIComponent(match[1]),
    prop: 'pageimages',
    pithumbsize: '480',
    format: 'json',
    formatversion: '2',
    origin: '*',
  })
  try {
    const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`)
    const data = await res.json() as {
      query: { pages: Array<{ thumbnail?: { source: string } }> }
    }
    const src = data?.query?.pages?.[0]?.thumbnail?.source ?? null
    imageCache.set(wikiUrl, src ?? '')
    return src
  } catch {
    imageCache.set(wikiUrl, '')
    return null
  }
}

// active   = currently selected (red)
// verified = grounded/Wikipedia-sourced (solid green)
// default  = memory-mode/unverified (hollow grey — clearly provisional)
function makeIcon(active: boolean, verified: boolean) {
  if (active) {
    return L.divIcon({
      className: '',
      html: `<div style="width:12px;height:12px;border-radius:50%;background:var(--danger);border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.35);"></div>`,
      iconSize: [12, 12], iconAnchor: [6, 6], popupAnchor: [0, -8],
    })
  }
  if (verified) {
    return L.divIcon({
      className: '',
      html: `<div style="width:12px;height:12px;border-radius:50%;background:var(--accent);border:2px solid rgba(255,255,255,0.9);box-shadow:0 1px 4px rgba(0,0,0,0.3);"></div>`,
      iconSize: [12, 12], iconAnchor: [6, 6], popupAnchor: [0, -8],
    })
  }
  // Unverified memory pin — hollow, muted, clearly provisional
  return L.divIcon({
    className: '',
    html: `<div style="width:10px;height:10px;border-radius:50%;background:transparent;border:2px solid var(--ink-muted);box-shadow:0 1px 3px rgba(0,0,0,0.15);opacity:0.65;"></div>`,
    iconSize: [10, 10], iconAnchor: [5, 5], popupAnchor: [0, -7],
  })
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function PopupContent({ loc }: { loc: Location }) {
  const meta = [loc.country, loc.year].filter(Boolean).map(esc).join(' · ')
  const unverified = !loc.wiki_url
  // data-wiki is read by the popupopen handler to fetch and inject the lead image
  return `
    <div${loc.wiki_url ? ` data-wiki="${esc(loc.wiki_url)}"` : ''}>
      <div style="padding:12px;font-family:'DM Sans',sans-serif;">
        <div style="font-weight:600;font-size:13px;color:var(--ink);margin-bottom:3px;line-height:1.3;">${esc(loc.name)}</div>
        ${meta ? `<div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--ink-faint);margin-bottom:6px;letter-spacing:0.02em;">${meta}</div>` : ''}
        <p style="font-size:12px;color:var(--ink-muted);line-height:1.55;margin-bottom:8px;">${esc(loc.description)}</p>
        ${loc.wiki_url
          ? `<a href="${esc(loc.wiki_url)}" target="_blank" rel="noopener noreferrer" style="font-family:'DM Mono',monospace;font-size:10px;color:var(--accent);text-decoration:none;letter-spacing:0.02em;">Wikipedia →</a>`
          : unverified
            ? `<span style="font-family:'DM Mono',monospace;font-size:10px;color:var(--ink-faint);letter-spacing:0.02em;">Unverified · awaiting Wikipedia</span>`
            : ''
        }
      </div>
    </div>
  `
}

interface MapControllerProps {
  locations: Location[]
  selectedLocation: Location | null
}

function MapController({ locations, selectedLocation }: MapControllerProps) {
  const map = useMap()
  // Keyed by name — allows updates (icon, coords, popup) when grounded phase replaces memory pins
  const markersRef = useRef<Map<string, L.Marker>>(new Map())
  const layerGroupRef = useRef<L.LayerGroup>(L.layerGroup())
  const userFocusedRef = useRef(false)

  useEffect(() => {
    const onDragStart = () => { userFocusedRef.current = true }
    const onPopupClose = () => { userFocusedRef.current = false }

    async function onPopupOpen(e: L.PopupEvent) {
      userFocusedRef.current = true
      const container = e.popup.getElement()
      if (!container) return
      const wikiEl = container.querySelector<HTMLElement>('[data-wiki]')
      if (!wikiEl) return
      // Don't inject twice if popup is reopened
      if (wikiEl.querySelector('img')) return
      const wikiUrl = wikiEl.getAttribute('data-wiki')
      if (!wikiUrl) return

      const imgSrc = await fetchWikiThumbnail(wikiUrl)
      if (!imgSrc || !container.isConnected) return
      // Popup may have closed and reopened on a different location while we were fetching
      if (wikiEl.getAttribute('data-wiki') !== wikiUrl) return

      const img = document.createElement('img')
      img.src = imgSrc
      img.style.cssText = 'width:100%;height:130px;object-fit:cover;display:block;'
      wikiEl.insertBefore(img, wikiEl.firstChild)

      // Nudge the popup to recalculate its position after the image shifts content
      e.popup.update()
    }

    map.on('popupopen', onPopupOpen)
    map.on('popupclose', onPopupClose)
    map.on('dragstart', onDragStart)
    return () => {
      map.off('popupopen', onPopupOpen as L.LeafletEventHandlerFn)
      map.off('popupclose', onPopupClose)
      map.off('dragstart', onDragStart)
    }
  }, [map])

  useEffect(() => {
    if (locations.length === 0) {
      userFocusedRef.current = false
      layerGroupRef.current.clearLayers()
      markersRef.current.clear()
      return
    }

    const nameSet = new Set(locations.map(l => l.name))

    // Remove markers for locations that were filtered out (e.g. hallucinations removed by grounded phase)
    markersRef.current.forEach((marker, name) => {
      if (!nameSet.has(name)) {
        layerGroupRef.current.removeLayer(marker)
        markersRef.current.delete(name)
      }
    })

    let addedNew = false

    locations.forEach(loc => {
      const isActive = selectedLocation?.name === loc.name
      const verified = !!loc.wiki_url
      const existing = markersRef.current.get(loc.name)

      if (existing) {
        // Update icon in case verified status changed (memory → grounded)
        existing.setIcon(makeIcon(isActive, verified))
        // Update position if grounded gave more precise coordinates
        const pos = existing.getLatLng()
        if (Math.abs(pos.lat - loc.lat) > 0.0001 || Math.abs(pos.lng - loc.lng) > 0.0001) {
          existing.setLatLng([loc.lat, loc.lng])
        }
        // Refresh popup with latest data (wiki_url, description may have changed)
        existing.setPopupContent(PopupContent({ loc }), { maxWidth: 260 })
      } else {
        const marker = L.marker([loc.lat, loc.lng], { icon: makeIcon(isActive, verified) })
        marker.bindPopup(PopupContent({ loc }), { maxWidth: 260 })
        marker.addTo(layerGroupRef.current)
        markersRef.current.set(loc.name, marker)
        addedNew = true
      }
    })

    layerGroupRef.current.addTo(map)

    if (addedNew && !userFocusedRef.current) {
      const bounds = L.latLngBounds(locations.map(loc => [loc.lat, loc.lng]))
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 10 })
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locations, map])

  // Update icons and pan when selection changes
  useEffect(() => {
    markersRef.current.forEach((marker, name) => {
      const loc = locations.find(l => l.name === name)
      const isActive = selectedLocation?.name === name
      const verified = !!loc?.wiki_url
      marker.setIcon(makeIcon(isActive, verified))
    })

    if (selectedLocation) {
      const marker = markersRef.current.get(selectedLocation.name)
      if (marker) {
        map.panTo([selectedLocation.lat, selectedLocation.lng], { animate: true })
        marker.openPopup()
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLocation, locations, map])

  return null
}

const TILE_LIGHT = {
  url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}

const TILE_DARK = {
  url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
}

interface Props {
  locations: Location[]
  selectedLocation: Location | null
  isDark: boolean
}

export function MapView({ locations, selectedLocation, isDark }: Props) {
  const tile = isDark ? TILE_DARK : TILE_LIGHT
  return (
    <div style={{ flex: 1, position: 'relative' }}>
      <MapContainer
        center={[20, 0]}
        zoom={2}
        style={{ height: '100%', width: '100%' }}
        zoomControl={true}
      >
        <TileLayer key={tile.url} attribution={tile.attribution} url={tile.url} />
        <MapController locations={locations} selectedLocation={selectedLocation} />
      </MapContainer>
    </div>
  )
}
