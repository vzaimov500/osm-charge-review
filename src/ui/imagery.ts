/**
 * Map layers for checking a station's position. Addresses and terms come from
 * the OSM editor layer index (the list iD and JOSM use); all three may be used
 * for OpenStreetMap mapping.
 */
export interface TileSource {
  id: string
  name: string
  /** Leaflet URL template; `{token}` is replaced by the reviewer's own access token. */
  url: string
  /** Deepest zoom the server has; deeper zooms enlarge these tiles. */
  maxNativeZoom: number
  /** Trusted HTML (constants in this file only). */
  attribution: string
  needsToken?: boolean
}

export const OSM_TILES: TileSource = {
  id: 'osm',
  name: 'OpenStreetMap',
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  maxNativeZoom: 19,
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}

export const IMAGERY: readonly TileSource[] = [
  {
    id: 'maf',
    name: 'Bulgaria MAF Orthophoto',
    url: 'https://bg-imagery.openstreetmap.org/layer/maf-orthophoto-latest/{z}/{x}/{y}.png',
    maxNativeZoom: 20,
    attribution: '© Ministry of Agriculture and Food of Bulgaria',
  },
  {
    id: 'esri',
    name: 'Esri World Imagery',
    url: 'https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maxNativeZoom: 19,
    attribution:
      '<a href="https://wiki.openstreetmap.org/wiki/Esri">Esri: Terms &amp; Feedback</a>',
  },
  {
    id: 'mapbox',
    name: 'Mapbox Satellite',
    url: 'https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}.jpg?access_token={token}',
    maxNativeZoom: 19,
    attribution: '<a href="https://www.mapbox.com/about/maps">© Mapbox: Terms &amp; Feedback</a>',
    needsToken: true,
  },
]

/** The source with its token filled in; undefined when a needed token is missing. */
export function resolveTiles(source: TileSource, token: string): TileSource | undefined {
  if (!source.needsToken) return source
  const tk = token.trim()
  return tk ? { ...source, url: source.url.replace('{token}', encodeURIComponent(tk)) } : undefined
}

// Per-browser conveniences: which imagery was last used, and the reviewer's own
// Mapbox token. Kept out of the exported state on purpose; storage may be unavailable.
const PREFIX = 'osm-charge-review:'
export function readPref(key: string): string {
  try {
    return localStorage.getItem(PREFIX + key) ?? ''
  } catch {
    return ''
  }
}
export function writePref(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(PREFIX + key, value)
    else localStorage.removeItem(PREFIX + key)
  } catch {
    /* private mode: not remembered */
  }
}
