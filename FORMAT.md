# Interchange format, version 1

This is the contract between **adapters** (which fetch a provider's data and map
it to OpenStreetMap tags) and **osm-charge-review** (which conflates it with
OpenStreetMap and puts every candidate in front of a human).

- Machine-readable schema: [`schema/candidates.schema.json`](schema/candidates.schema.json)
  (JSON Schema 2020-12). It is the source of truth; the tool's validator and
  TypeScript types are generated from it.
- Example: [`test/fixtures/format/valid.json`](test/fixtures/format/valid.json).
- Failing examples, one per rule: [`test/fixtures/format/invalid/`](test/fixtures/format/invalid)
  and [`warn/`](test/fixtures/format/warn), each named after the issue code it
  produces.

The key design decision: **tags arrive already mapped.** The review tool never
interprets provider fields. An adapter that cannot map a field confidently
leaves it out and explains in `notes` rather than guessing.

## Document

A GeoJSON `FeatureCollection` (RFC 7946) with an additional `metadata` member.
Unknown members are rejected, so typos surface instead of being silently
ignored.

```json
{
  "type": "FeatureCollection",
  "metadata": { … },
  "features": [ … ]
}
```

## `metadata`

| Field            | Required | Notes                                                                                                                   |
| ---------------- | -------- | ----------------------------------------------------------------------------------------------------------------------- |
| `format_version` | yes      | `"1"`. Files with any other value are rejected before anything else is checked.                                         |
| `dataset_id`     | yes      | Lower-case slug (`^[a-z0-9]+(-[a-z0-9]+)*$`, ≤ 64). **Stable across runs**: it scopes every stored decision.            |
| `dataset_name`   | yes      | Shown in the interface.                                                                                                 |
| `source_url`     | yes      | `http(s)` URL. Written to the changeset `source` tag.                                                                   |
| `licence`        | yes      | SPDX identifier, or `LicenseRef-…`. See [Licence](#licence).                                                            |
| `permission_url` | no¹      | Where the licence or explicit permission is documented — usually the import wiki page.                                  |
| `retrieved_at`   | yes      | RFC 3339 date-time of the fetch.                                                                                        |
| `adapter`        | yes      | `{ "name", "version", "url"? }` — recorded in the audit trail. Use `url` to link the adapter's source code.             |
| `ref_key`        | no       | OSM key carrying the provider identifier. Default `ref`. Must match `^ref(:[a-z0-9_]+)*$`; `ref:<network>` recommended. |
| `default_tags`   | no       | Merged into every feature's tags; the feature's own tags win on conflict.                                               |

¹ Required when `licence` is `LicenseRef-permission`.

### Licence

| `licence`                                              | Tool behaviour                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------- |
| `ODbL-1.0`, `CC0-1.0`, `PDDL-1.0`                      | Compatible.                                                               |
| `LicenseRef-permission` + `permission_url`             | Compatible: explicit written permission, documented at the URL.           |
| `LicenseRef-permission` without URL                    | **Rejected.**                                                             |
| Anything else (e.g. `CC-BY-4.0`, `LicenseRef-pending`) | Loads with a prominent warning. Review works; **live upload is refused.** |

Attribution licences such as CC-BY need a waiver before import, which is a
permission — use `LicenseRef-permission` once one is obtained.

## Features

```json
{
  "type": "Feature",
  "geometry": { "type": "Point", "coordinates": [24.685366, 41.654363] },
  "properties": {
    "source_id": "1",
    "ref": "1",
    "tags": { "socket:type2_combo": "1", "charging_station:output": "30 kW" },
    "suggested_tags": { "description": "1x 30kW DC CCS2" },
    "label": "Pamporovo DC Wallbox",
    "address": "864, Стойките 4715, България",
    "status": "operational",
    "updated_at": "2026-09-20T00:00:00Z",
    "position_accuracy_m": 15,
    "notes": "…",
    "source_raw": {}
  }
}
```

| Field                 | Required | Purpose                                                                                                                                            |
| --------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `geometry`            | yes      | `Point`, WGS 84, **`[longitude, latitude]`**.                                                                                                      |
| `source_id`           | yes      | Stable provider identifier, unique within the file.                                                                                                |
| `ref`                 | no       | Value the tool writes under `metadata.ref_key`. Do not also put it in `tags` (an identical copy is tolerated).                                     |
| `tags`                | yes      | Already-mapped OSM tags, all values strings. At least one tag.                                                                                     |
| `suggested_tags`      | no       | Offered only when updating an existing object, each unticked; never written to a new one. Keys in `tags` are ignored. Not part of the change hash. |
| `label`               | no       | Display only. **Never written to OpenStreetMap.**                                                                                                  |
| `address`             | no       | Display only.                                                                                                                                      |
| `status`              | no       | `operational` / `planned` / `closed`. Non-operational rows are flagged, never silently dropped.                                                    |
| `updated_at`          | no       | When the provider last changed the record.                                                                                                         |
| `position_accuracy_m` | no       | Widens the match radius for this row.                                                                                                              |
| `notes`               | no       | Free text from the adapter to the reviewer.                                                                                                        |
| `source_raw`          | no       | The original record, shown on demand for verification.                                                                                             |

A feature's top-level `id`, if present, is ignored.

### Effective tags

What the tool compares against OpenStreetMap — and writes, if the reviewer
chooses — is:

```
default_tags  ⊕  feature tags  ⊕  { <ref_key>: ref }
```

Later entries win. The effective tags must contain `amenity=charging_station`:
this tool reviews charging stations only.

### Change detection

The tool hashes each candidate's position, effective tags and `status`. When a
later file changes any of those for a `source_id`, earlier decisions on it are
marked superseded and must be re-confirmed. `label`, `address`, `notes`,
`updated_at` and `source_raw` do not affect the hash.

## Validation rules

Every finding has a stable **code**, a **severity**, and — for feature-level
problems — the feature index and `source_id`.

- **error** — the file is rejected.
- **confirm** — the file loads only after the operator explicitly confirms.
- **warning** — shown, does not block.

| Code                             | Severity | Rule                                                                                          |
| -------------------------------- | -------- | --------------------------------------------------------------------------------------------- |
| `JSON_SYNTAX`                    | error    | The file is not valid JSON.                                                                   |
| `NOT_AN_OBJECT`                  | error    | The top level is not an object.                                                               |
| `FORMAT_VERSION_UNKNOWN`         | error    | `format_version` is not `"1"`.                                                                |
| `METADATA_FIELD`                 | error    | A metadata field is missing, unknown or malformed.                                            |
| `SCHEMA`                         | error    | Any other structural problem.                                                                 |
| `LICENCE_PERMISSION_URL_MISSING` | error    | `LicenseRef-permission` without `permission_url`.                                             |
| `LICENCE_NOT_KNOWN_COMPATIBLE`   | warning  | Licence not known to be compatible; live upload will be refused.                              |
| `NO_FEATURES`                    | error    | `features` is empty.                                                                          |
| `SOURCE_ID_DUPLICATE`            | error    | Two features share a `source_id`.                                                             |
| `COORD_LAT_OUT_OF_RANGE`         | error    | Latitude beyond ±90° — almost certainly swapped coordinates.                                  |
| `COORD_LON_OUT_OF_RANGE`         | error    | Longitude beyond ±180°.                                                                       |
| `COORD_INVALID`                  | error    | Geometry is not a Point with two numbers.                                                     |
| `COORD_NULL_ISLAND`              | warning  | Within 1° of 0°, 0° (Gulf of Guinea) — usually a missing coordinate.                          |
| `COORD_LOOKS_SWAPPED`            | warning  | > 500 km from the dataset's median, but swapping lat/lon puts it among the rest (≥ 5 points). |
| `TAGS_EMPTY`                     | error    | `tags` is empty.                                                                              |
| `TAG_KEY_EMPTY`                  | error    | A tag key is empty.                                                                           |
| `TAG_VALUE_EMPTY`                | error    | A tag value is empty.                                                                         |
| `TAG_KEY_TOO_LONG`               | error    | A key is over 255 characters.                                                                 |
| `TAG_VALUE_TOO_LONG`             | error    | A value is over 255 characters (the OSM API limit).                                           |
| `TAG_VALUE_NOT_STRING`           | error    | A value is not a string (write `"2"`, not `2`).                                               |
| `TAG_WHITESPACE`                 | warning  | Leading or trailing whitespace in a key or value.                                             |
| `TAG_SOURCE_FORBIDDEN`           | error    | `source` or `source:*` in tags — the source belongs on the changeset.                         |
| `TAG_NAME_PRESENT`               | confirm  | `name` is set. Provider labels are usually not names on the ground.                           |
| `TAG_REF_CONFLICT`               | error    | `tags[ref_key]` disagrees with `ref`.                                                         |
| `NOT_CHARGING_STATION`           | error    | Effective tags lack `amenity=charging_station`.                                               |
| `DUPLICATE_RECORD`               | error    | Two features within 5 m with identical effective tags — a duplicated provider record.         |

The same rules apply to `default_tags` where meaningful.

## Versioning

- Additive, optional fields may be added within version 1 only by updating the
  tool first; since unknown fields are rejected, adapters must not emit a new
  field until the tool that reads it is released.
- Any change to the meaning of an existing field, or a new required field,
  increments `format_version`.
