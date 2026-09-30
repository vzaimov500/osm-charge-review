<script lang="ts" module>
  /** Hard cap on simultaneous Leaflet instances (hundreds would kill the browser and the tile servers). */
  const MAX_LIVE_MAPS = 12
  /** A row must stay visible this long before its map loads, so fast scrolling fetches no tiles. */
  const SETTLE_MS = 400
  let live = 0
</script>

<script lang="ts">
  import { onDestroy } from 'svelte'
  import type { Map as LeafletMap } from 'leaflet'
  import { osmObjectUrl } from './format'

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
  }: {
    lat: number
    lon: number
    radiusM: number
    nearby: Nearby[]
    /** The detail view's map: fills its box, with zoom controls. */
    big?: boolean
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
    }).setView([lat, lon], 18)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map)
    overlays = L.layerGroup().addTo(map)
    leaflet = L
    draw()
    // Leaflet measures its box once; tell it when the window or the layout changes the size.
    resized = new ResizeObserver(() => map?.invalidateSize({ debounceMoveend: true }))
    resized.observe(el)
  }

  let overlays: import('leaflet').LayerGroup | undefined
  let leaflet: typeof import('leaflet') | undefined

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
          `<a href="${osmObjectUrl(n.type, n.id)}" target="_blank" rel="noopener">${n.type}/${n.id}</a> · ${escapeHtml(n.label)}<br><small>${tags}</small>`,
        )
        .addTo(overlays)
    }
    L.circleMarker([lat, lon], {
      radius: 7,
      color: '#dc2626',
      fillColor: '#dc2626',
      fillOpacity: 0.9,
    })
      .bindTooltip('candidate')
      .addTo(overlays)
  }

  $effect(() => {
    // Track the inputs, then redraw (a no-op until the map exists).
    void [lat, lon, radiusM, nearby]
    draw()
  })

  // One map serves the detail view: follow the selected candidate.
  $effect(() => {
    const at: [number, number] = [lat, lon]
    map?.setView(at, 18)
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
  .paused {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-size: 0.8rem;
    opacity: 0.6;
  }
</style>
