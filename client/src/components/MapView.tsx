import { useCallback, useEffect, useRef } from 'react'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { nodeTrust } from '../types'
import type { Location } from '../types'

type Marker = 'verified' | 'geocoded' | 'unverified'

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

// Marker style reflects trust across both axes (PID R4 coordinate + R8 membership) —
// an unverified pin must never look verified:
//   active     = currently selected (red)
//   verified   = Wikidata structured coordinate + structural membership (solid green)
//   geocoded   = geocoding-service coordinate (solid amber — unverified)
//   unverified = approximate coordinate or model-asserted membership (dashed amber)
function makeIcon(active: boolean, marker: Marker) {
  if (active) {
    return L.divIcon({
      className: '',
      html: `<div style="width:12px;height:12px;border-radius:50%;background:var(--danger);border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.35);"></div>`,
      iconSize: [12, 12], iconAnchor: [6, 6], popupAnchor: [0, -8],
    })
  }
  if (marker === 'verified') {
    return L.divIcon({
      className: '',
      html: `<div style="width:12px;height:12px;border-radius:50%;background:var(--accent);border:2px solid rgba(255,255,255,0.9);box-shadow:0 1px 4px rgba(0,0,0,0.3);"></div>`,
      iconSize: [12, 12], iconAnchor: [6, 6], popupAnchor: [0, -8],
    })
  }
  if (marker === 'geocoded') {
    // Solid amber — located, but not from Wikidata. Unverified.
    return L.divIcon({
      className: '',
      html: `<div style="width:11px;height:11px;border-radius:50%;background:#e8a33d;border:2px solid rgba(255,255,255,0.9);box-shadow:0 1px 4px rgba(0,0,0,0.3);"></div>`,
      iconSize: [11, 11], iconAnchor: [5.5, 5.5], popupAnchor: [0, -8],
    })
  }
  // unverified — hollow dashed amber, clearly provisional
  return L.divIcon({
    className: '',
    html: `<div style="width:11px;height:11px;border-radius:50%;background:transparent;border:2px dashed #e8a33d;box-shadow:0 1px 3px rgba(0,0,0,0.15);"></div>`,
    iconSize: [11, 11], iconAnchor: [5.5, 5.5], popupAnchor: [0, -7],
  })
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function PopupContent({ loc }: { loc: Location }) {
  const meta = [loc.country, loc.year].filter((x): x is string => Boolean(x)).map(esc).join(' · ')
  const unverified = !loc.wiki_url
  const badge = nodeTrust(loc).badge
  // data-wiki is read by the popupopen handler to fetch and inject the lead image
  return `
    <div${loc.wiki_url ? ` data-wiki="${esc(loc.wiki_url)}"` : ''}>
      <div style="padding:12px;font-family:Helvetica,Arial,sans-serif;">
        <div style="font-weight:600;font-size:13px;color:var(--ink);margin-bottom:3px;line-height:1.3;">${esc(loc.name)}</div>
        ${meta ? `<div style="font-family:Helvetica,Arial,sans-serif;font-size:10px;color:var(--ink-faint);margin-bottom:6px;letter-spacing:0.02em;">${meta}</div>` : ''}
        ${badge ? `<div style="display:inline-block;font-family:Helvetica,Arial,sans-serif;font-size:9px;color:#9a6a1a;background:rgba(232,163,61,0.16);border:1px solid rgba(232,163,61,0.5);border-radius:4px;padding:2px 6px;margin-bottom:6px;letter-spacing:0.02em;">⚠ ${esc(badge)}</div>` : ''}
        <p style="font-size:12px;color:var(--ink-muted);line-height:1.55;margin-bottom:8px;">${esc(loc.description)}</p>
        ${loc.wiki_url
          ? `<a href="${esc(loc.wiki_url)}" target="_blank" rel="noopener noreferrer" style="font-family:Helvetica,Arial,sans-serif;font-size:10px;color:var(--accent);text-decoration:none;letter-spacing:0.02em;">Wikipedia →</a>`
          : unverified
            ? `<span style="font-family:Helvetica,Arial,sans-serif;font-size:10px;color:var(--ink-faint);letter-spacing:0.02em;">No source link</span>`
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

// Seamless, ENDLESS east-west wrap without worldCopyJump's snap/flash: each pin is drawn on every
// world copy currently on screen (its longitude ± k·360°), regenerated as you pan/zoom. Scrolling is
// therefore unbounded and an edge pin (e.g. near NZ) is simply already painted on whichever copy you
// move into — nothing jumps, nothing bounces.

// Integer world-copy offsets (units of 360°) whose copy of the world overlaps the current view,
// padded by one copy each side so neighbouring-copy pins are ready before you scroll into them.
function visibleWorldOffsets(map: L.Map): number[] {
  const b = map.getBounds()
  const lo = Math.ceil((b.getWest() - 180) / 360) - 1
  const hi = Math.floor((b.getEast() + 180) / 360) + 1
  const out: number[] = []
  for (let k = lo; k <= hi; k++) out.push(k)
  return out
}

function MapController({ locations, selectedLocation }: MapControllerProps) {
  const map = useMap()
  // name → (world-copy offset k → marker). Copies are added/removed as the visible range changes.
  const markersRef = useRef<Map<string, Map<number, L.Marker>>>(new Map())
  const layerGroupRef = useRef<L.LayerGroup>(L.layerGroup())
  const userFocusedRef = useRef(false)
  // Latest props for the pan/zoom-driven re-sync (which runs outside React's render cycle).
  const locsRef = useRef<Location[]>(locations)
  const selRef = useRef<Location | null>(selectedLocation)
  locsRef.current = locations
  selRef.current = selectedLocation

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

      // NOTE: do not call e.popup.update() here — in Leaflet 1.9 update() runs
      // _updateContent() which resets the content node's innerHTML from the original
      // HTML string, wiping this injected <img>. Reposition once the image has loaded
      // using a pan adjustment that leaves the DOM untouched.
      img.addEventListener('load', () => {
        if (!container.isConnected) return
        const p = e.popup as L.Popup & { _adjustPan?: () => void }
        p._adjustPan?.()
      })
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

  // Reconcile markers: for every location ensure a copy exists at each visible world offset, and drop
  // copies that scrolled out of view. Reads refs so it can also run on pan/zoom (outside render).
  // `updateExisting` is true only when the DATA changed (refresh icon/coord/popup on existing copies);
  // on pure pan/zoom it's false, so we only add copies entering view and drop those leaving it —
  // keeping pans cheap even on large result sets (no per-marker popup rebuild).
  const sync = useCallback((updateExisting = true) => {
    const offsets = visibleWorldOffsets(map)
    const offsetSet = new Set(offsets)
    const nameSet = new Set(locsRef.current.map(l => l.name))

    // Drop all copies for locations no longer in the result set.
    markersRef.current.forEach((copies, name) => {
      if (!nameSet.has(name)) {
        copies.forEach(m => layerGroupRef.current.removeLayer(m))
        markersRef.current.delete(name)
      }
    })

    let addedNew = false
    for (const loc of locsRef.current) {
      const isActive = selRef.current?.name === loc.name
      const tier = nodeTrust(loc).marker
      let html: string | null = null
      const getHtml = () => (html ??= PopupContent({ loc })) // built at most once per loc, only if needed
      let copies = markersRef.current.get(loc.name)
      if (!copies) {
        copies = new Map()
        markersRef.current.set(loc.name, copies)
      }

      for (const k of offsets) {
        const lng = loc.lng + k * 360
        const existing = copies.get(k)
        if (existing) {
          if (updateExisting) {
            existing.setIcon(makeIcon(isActive, tier))
            const pos = existing.getLatLng()
            if (Math.abs(pos.lat - loc.lat) > 1e-4 || Math.abs(pos.lng - lng) > 1e-4) existing.setLatLng([loc.lat, lng])
            existing.setPopupContent(getHtml())
          }
        } else {
          const m = L.marker([loc.lat, lng], { icon: makeIcon(isActive, tier) })
          m.bindPopup(getHtml(), { maxWidth: 260 })
          m.addTo(layerGroupRef.current)
          copies.set(k, m)
          addedNew = true
        }
      }
      // Remove copies that are no longer on screen (keeps the marker count bounded).
      copies.forEach((m, k) => {
        if (!offsetSet.has(k)) {
          layerGroupRef.current.removeLayer(m)
          copies!.delete(k)
        }
      })
    }

    layerGroupRef.current.addTo(map)
    return addedNew
  }, [map])

  // Result set changed → reconcile + auto-frame (using the real, home-copy coordinates).
  useEffect(() => {
    if (locations.length === 0) {
      userFocusedRef.current = false
      layerGroupRef.current.clearLayers()
      markersRef.current.clear()
      return
    }
    const addedNew = sync()
    if (addedNew && !userFocusedRef.current) {
      const bounds = L.latLngBounds(locations.map(loc => [loc.lat, loc.lng]))
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 10 })
    }
  }, [locations, map, sync])

  // Pan / zoom → materialize the on-screen world copies so the wrap stays seamless and endless.
  // `false` = only add/remove copies, don't rebuild existing markers (cheap on large result sets).
  useEffect(() => {
    const onViewChange = () => sync(false)
    map.on('moveend', onViewChange)
    map.on('zoomend', onViewChange)
    return () => {
      map.off('moveend', onViewChange)
      map.off('zoomend', onViewChange)
    }
  }, [map, sync])

  // Update icons and pan when selection changes
  useEffect(() => {
    markersRef.current.forEach((copies, name) => {
      const loc = locations.find(l => l.name === name)
      const isActive = selectedLocation?.name === name
      copies.forEach(m => m.setIcon(makeIcon(isActive, loc ? nodeTrust(loc).marker : 'verified')))
    })

    if (selectedLocation) {
      const copies = markersRef.current.get(selectedLocation.name)
      if (copies && copies.size) {
        // Open the world-copy nearest the current view so we pan minimally, not across the globe.
        const centerLng = map.getCenter().lng
        let nearest: L.Marker | undefined
        let bestD = Infinity
        copies.forEach(m => {
          const d = Math.abs(m.getLatLng().lng - centerLng)
          if (d < bestD) { bestD = d; nearest = m }
        })
        if (nearest) {
          map.panTo(nearest.getLatLng(), { animate: true })
          nearest.openPopup()
        }
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
  loading: boolean
  loadingMessage: string
}

export function MapView({ locations, selectedLocation, isDark, loading, loadingMessage }: Props) {
  const tile = isDark ? TILE_DARK : TILE_LIGHT
  return (
    <div style={{ flex: 1, position: 'relative' }}>
      <MapContainer
        center={[25, 5]}
        zoom={3}
        minZoom={2}
        // Clamp latitude to the world but leave longitude effectively unbounded (±~277 copies), so
        // east-west scrolling never bounces. MapController paints each pin on whatever copies are on
        // screen, so pins follow you across the seam — no worldCopyJump snap/flash.
        maxBounds={[[-85, -100000], [85, 100000]]}
        style={{ height: '100%', width: '100%' }}
        zoomControl={true}
      >
        {/* Repeating tiles (no noWrap) give continuous, endless E↔W scrolling. */}
        <TileLayer key={tile.url} attribution={tile.attribution} url={tile.url} />
        <MapController locations={locations} selectedLocation={selectedLocation} />
      </MapContainer>
      {locations.length > 0 && <Legend />}
      {loading && <LoadingOverlay message={loadingMessage} />}
    </div>
  )
}

// Prominent, centered "what's happening now" indicator over the map during a query — turns a
// blind 20-100s wait into a legible live feed (fed by the streamed pipeline progress).
function LoadingOverlay({ message }: { message: string }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1200,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          background: 'var(--surface-raised)',
          border: '1px solid var(--border-strong)',
          borderRadius: 12,
          padding: '16px 22px',
          boxShadow: '0 10px 40px rgba(0,0,0,0.16)',
          maxWidth: '80%',
        }}
      >
        <svg width="22" height="22" viewBox="0 0 50 50" style={{ flexShrink: 0 }}>
          <circle cx="25" cy="25" r="20" fill="none" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round" strokeDasharray="80 50">
            <animateTransform attributeName="transform" type="rotate" from="0 25 25" to="360 25 25" dur="0.9s" repeatCount="indefinite" />
          </circle>
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontFamily: "Helvetica, Arial, sans-serif", fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
            {message || 'Working…'}
          </span>
          <span style={{ fontFamily: "Helvetica, Arial, sans-serif", fontSize: 10, color: 'var(--ink-faint)', letterSpacing: '0.03em', marginTop: 3 }}>
            building a verified map — this can take a moment
          </span>
        </div>
      </div>
    </div>
  )
}

// Marker-tier key (PID R4/R8). Mirrors makeIcon styling.
function Legend() {
  const rows: { border: string; fill: string; label: string }[] = [
    { border: '2px solid var(--accent)', fill: 'var(--accent)', label: 'Verified' },
    { border: '2px solid #e8a33d', fill: '#e8a33d', label: 'Unverified location' },
    { border: '2px dashed #e8a33d', fill: 'transparent', label: 'Model-suggested' },
  ]
  return (
    <div
      style={{
        position: 'absolute',
        left: 10,
        bottom: 10,
        zIndex: 500,
        background: 'var(--surface-raised)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '8px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        boxShadow: '0 1px 6px rgba(0,0,0,0.12)',
        pointerEvents: 'none',
      }}
    >
      {rows.map(r => (
        <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: r.fill, border: r.border, flexShrink: 0 }} />
          <span style={{ fontFamily: "Helvetica, Arial, sans-serif", fontSize: 10, color: 'var(--ink-muted)', letterSpacing: '0.02em' }}>
            {r.label}
          </span>
        </div>
      ))}
    </div>
  )
}
