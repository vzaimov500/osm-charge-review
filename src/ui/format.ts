/** Explicit, locale-independent formatting. */
export const fmtCoord = (n: number): string => n.toFixed(6)
export const fmtDistance = (m: number): string =>
  (m < 10 ? m.toFixed(1) : Math.round(m).toString()) + ' m'
/** ISO 8601 → "2026-09-28 22:32 UTC". */
export const fmtDateTime = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}
export const fmtDate = (iso: string): string => iso.slice(0, 10)
export const osmUrl = (lat: number, lon: number): string =>
  `https://www.openstreetmap.org/?mlat=${fmtCoord(lat)}&mlon=${fmtCoord(lon)}#map=19/${fmtCoord(lat)}/${fmtCoord(lon)}`
export const osmObjectUrl = (type: string, id: number): string =>
  `https://www.openstreetmap.org/${type}/${id}`
export const geoUri = (lat: number, lon: number): string => `geo:${fmtCoord(lat)},${fmtCoord(lon)}`
