export type OsmType = 'node' | 'way' | 'relation'

/** An existing OpenStreetMap object as fetched from Overpass (`osm_object`). */
export interface OsmObject {
  osmType: OsmType
  osmId: number
  version: number
  /** Node position, or centroid for ways and relations. */
  lat: number
  lon: number
  tags: Record<string, string>
  lastEditUser: string
  lastEditUid: number
  /** ISO 8601. */
  lastEditAt: string
  changeset: number
}

export const osmKey = (o: { osmType: OsmType; osmId: number }): string => `${o.osmType}/${o.osmId}`
