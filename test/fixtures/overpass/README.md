# Overpass fixtures

- `recorded-sofia-centre.json` — **real** response from overpass-api.de
  (`nwr["amenity"="charging_station"]` over Bulgaria, `out center tags meta`,
  osm_base 2026-09-28T22:32:46Z), trimmed to central Sofia
  (42.66–42.72 N, 23.28–23.36 E).
- `recorded-lifecycle.json` — **real** response to the tool's full station
  query (live + lifecycle prefixes + `ref:fines`) over Bulgaria, osm_base
  2026-09-29T00:59:51Z: the 4 lifecycle-prefixed stations that exist, plus 6
  live ones.
- `synthetic-sofia.json` — hand-built in the exact `out center tags meta` shape
  (node, way with `center`, lifecycle-prefixed node, `ref:*`-only object),
  covering shapes the recorded responses lack.

In the recordings, usernames and user ids are replaced by placeholders
(`mapper_01`…); everything else is as the server returned it. They contain
OpenStreetMap data © OpenStreetMap contributors,
available under the Open Database License (ODbL).
