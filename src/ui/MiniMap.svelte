<script lang="ts" module>
  /** Hard cap on simultaneous Leaflet instances (hundreds would kill the browser and the tile servers). */
  const MAX_LIVE_MAPS = 12
  /** A row must stay visible this long before its map loads, so fast scrolling fetches no tiles. */
  const SETTLE_MS = 400
  /** Deeper than most imagery goes: the last tiles are enlarged, which is enough to place a point. */
  const MAX_ZOOM = 21
  let live = 0
</script>

<script lang="ts">
  import { onDestroy } from 'svelte'
  import type { Map as LeafletMap } from 'leaflet'
  import { osmObjectUrl } from './format'
  import { OSM_TILES, type TileSource } from './imagery'

  interface View {
    lat: number
    lon: number
    zoom: number
  }

  interface Nearby {
    lat: number
    lon: number
    label: string
    type: string
    id: number
    tags: Record<string, string>
    kind: 'target' | 'lifecycle' | 'other'
  }

  let {
    lat,
    lon,
    radiusM,
    nearby,
    big = false,
    web,
    tiles = OSM_TILES,
    view,
    onview,
    place,
    ondragto,
  }: {
    lat: number
    lon: number
    radiusM: number
    nearby: Nearby[]
    /** The detail view's map: fills its box, with zoom controls. */
    big?: boolean
    /** Website the object links open on (sandbox or live). */
    web?: string
    /** The background layer. */
    tiles?: TileSource
    /** Shared with a second map so both show the same spot. */
    view?: View
    onview?: (v: View) => void
    /** Where the station would be created, when not at (lat, lon). */
    place?: { lat: number; lon: number } | undefined
    /** Set: the station marker can be dragged; called with where it was dropped. */
    ondragto?: ((lat: number, lon: number) => void) | undefined
  } = $props()

  let el: HTMLDivElement
  let map: LeafletMap | undefined
  let paused = $state(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  let observer: IntersectionObserver | undefined
  let resized: ResizeObserver | undefined

  const escapeHtml = (s: string) =>
    s.replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
    )

  async function create() {
    if (map || live >= MAX_LIVE_MAPS) {
      paused = !map
      return
    }
    live++
    const L = await import('leaflet')
    await import('leaflet/dist/leaflet.css')
    if (!el) {
      live--
      return
    }
    map = L.map(el, {
      zoomControl: big,
      attributionControl: true,
      scrollWheelZoom: big,
      maxZoom: MAX_ZOOM,
    }).setView(view ? [view.lat, view.lon] : [lat, lon], view?.zoom ?? 18)
    overlays = L.layerGroup().addTo(map)
    leaflet = L
    setTiles()
    draw()
    // Tell the other map where this one went; `applying` stops the echo.
    map.on('move zoomend', () => {
      if (applying || !map) return
      const c = map.getCenter()
      onview?.({ lat: c.lat, lon: c.lng, zoom: map.getZoom() })
    })
    // Leaflet measures its box once; tell it when the window or the layout changes the size.
    resized = new ResizeObserver(() => map?.invalidateSize({ debounceMoveend: true }))
    resized.observe(el)
  }

  let overlays: import('leaflet').LayerGroup | undefined
  let leaflet: typeof import('leaflet') | undefined
  let layer: import('leaflet').TileLayer | undefined
  let applying = false

  function setTiles() {
    const L = leaflet
    if (!L || !map) return
    layer?.remove()
    layer = L.tileLayer(tiles.url, {
      maxZoom: MAX_ZOOM,
      maxNativeZoom: tiles.maxNativeZoom,
      attribution: tiles.attribution,
    }).addTo(map)
    layer.bringToBack()
  }

  /** (Re)draw radius, nearby objects and the candidate; runs again when OSM data arrives. */
  function draw() {
    const L = leaflet
    if (!L || !overlays) return
    overlays.clearLayers()
    L.circle([lat, lon], {
      radius: radiusM,
      color: '#d97706',
      weight: 1,
      fill: false,
      dashArray: '4 4',
    }).addTo(overlays)
    for (const n of nearby) {
      const color = n.kind === 'target' ? '#2563eb' : n.kind === 'lifecycle' ? '#6b7280' : '#9333ea'
      const tags = Object.entries(n.tags)
        .map(([k, v]) => `${escapeHtml(k)}=${escapeHtml(v)}`)
        .join('<br>')
      L.circleMarker([n.lat, n.lon], { radius: 6, color, fillOpacity: 0.7 })
        .bindPopup(
          `<a href="${osmObjectUrl(n.type, n.id, web)}" target="_blank" rel="noopener">${n.type}/${n.id}</a> · ${escapeHtml(n.label)}<br><small>${tags}</small>`,
        )
        .addTo(overlays)
    }
    const at: [number, number] = place ? [place.lat, place.lon] : [lat, lon]
    if (place)
      // Where the provider says it is, once the station has been moved away from there.
      L.circleMarker([lat, lon], { radius: 6, color: '#dc2626', weight: 2, fill: false })
        .bindTooltip('provider position')
        .addTo(overlays)
    if (ondragto) {
      const drop = ondragto
      L.marker(at, {
        draggable: true,
        keyboard: false,
        icon: L.divIcon({ className: 'cand-pin', iconSize: [26, 26], iconAnchor: [13, 13] }),
      })
        .bindTooltip('drag to the chargers')
        .on('dragend', (e) => {
          const p = (e.target as import('leaflet').Marker).getLatLng()
          drop(p.lat, p.lng)
        })
        .addTo(overlays)
    } else {
      L.circleMarker(at, { radius: 7, color: '#dc2626', fillColor: '#dc2626', fillOpacity: 0.9 })
        .bindTooltip('candidate')
        .addTo(overlays)
    }
  }

  $effect(() => {
    // Track the inputs, then redraw (a no-op until the map exists).
    void [lat, lon, radiusM, nearby, place, ondragto]
    draw()
  })

  // One map serves the detail view: follow the selected candidate, or the shared view.
  $effect(() => {
    const v = view ?? { lat, lon, zoom: 18 }
    if (!map) return
    const c = map.getCenter()
    if (
      Math.abs(c.lat - v.lat) < 1e-7 &&
      Math.abs(c.lng - v.lon) < 1e-7 &&
      map.getZoom() === v.zoom
    )
      return
    applying = true
    map.setView([v.lat, v.lon], v.zoom, { animate: false })
    applying = false
  })

  $effect(() => {
    void tiles
    setTiles()
  })

  $effect(() => {
    observer = new IntersectionObserver((entries) => {
      const visible = entries.some((e) => e.isIntersecting)
      clearTimeout(timer)
      if (visible) timer = setTimeout(create, SETTLE_MS)
    })
    observer.observe(el)
    return () => observer?.disconnect()
  })

  onDestroy(() => {
    clearTimeout(timer)
    resized?.disconnect()
    if (map) {
      map.remove()
      live--
    }
  })
</script>

<div class="minimap" class:big bind:this={el} aria-label="map">
  {#if paused}<span class="paused">map paused</span>{/if}
</div>

<style>
  .minimap {
    width: 240px;
    height: 180px;
    background: var(--muted-bg);
    border-radius: 4px;
    position: relative;
    flex: none;
  }
  .minimap.big {
    width: 100%;
    height: 100%;
    min-height: 240px;
    border-radius: 8px;
  }
  /* The draggable station marker (Leaflet creates the element, so the rule is global). */
  /* A ring with a pinpoint: the ground under it stays visible, the centre is the exact spot. */
  .minimap :global(.cand-pin) {
    box-sizing: border-box;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 3px solid #dc2626;
    background: radial-gradient(circle, #dc2626 0 2px, transparent 2.5px);
    box-shadow:
      0 0 0 1.5px #fff,
      inset 0 0 0 1.5px #fff;
    cursor: grab;
  }
  .paused {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-size: 0.8rem;
    opacity: 0.6;
  }
</style>
