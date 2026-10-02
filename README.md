# osm-charge-review

A browser tool for **reviewing** charging-station data from a provider against
OpenStreetMap, one candidate at a time, and uploading the changes a person has
approved — with their own OpenStreetMap account.

## What it is

- A review queue. It loads a GeoJSON file in the [interchange format](FORMAT.md),
  compares every candidate with the charging stations already in OpenStreetMap,
  and shows the reviewer what matches, what differs and why.
- Provider-agnostic. Provider-specific work (fetching a feed, mapping its fields
  to OpenStreetMap tags) lives in separate _adapter_ tools that emit the
  interchange format.
- A static web application. No backend, no server-side storage, no bundled
  credentials. Your decisions live in your browser (IndexedDB) and in the export
  files you save.

## What it is not

- **Not an automated importer.** Nothing reaches the map without a human choosing
  _Add_, _Update_, _Reject_ or _Skip_ for that specific row. There are no
  bulk-approve actions and no confidence threshold that skips the human, by design.
- Not a substitute for the [OSM import guidelines](https://wiki.openstreetmap.org/wiki/Import/Guidelines):
  community discussion, an import wiki page and a dedicated import account are
  still required before any live upload. The tool refuses live uploads until
  those are recorded.
- Not a mobile tool.

## Requirements

- Current desktop **Chrome, Edge, Firefox or Safari**.
- A **secure context**: the sign-in flow (OAuth 2.0 with PKCE) needs
  `crypto.subtle`, which browsers expose only over HTTPS or on `localhost`.
  Opening `dist/index.html` from `file://` will not work.
- Browser storage that persists. Private windows and blocked site data are
  detected and refused. **Export your working state regularly** — Safari in
  particular may delete site data after a period without visits.

## Reviewing

1. **Load** a candidate file produced by an adapter. Validation problems are
   listed per feature. Files setting `name` need an explicit confirmation.
2. **Fetch OpenStreetMap data**: one Overpass request for the whole area,
   cached for 30 minutes (or, for testing, the sandbox API). If Overpass is busy you get a message. Nothing
   retries by itself.
3. **Decide** each row: _Add_, _Update_, _Reject_ (with a reason) or _Skip_.
   Nothing is pre-selected. For updates, conflicting values on keys a person
   plausibly surveyed need a per-key tick, and existing tags are never removed.
   Keyboard (by key position, so any layout works): `1` Update, `2` Add,
   `3` Reject, `4` Skip, `W`/`S` previous/next, `Q`/`E` previous/next
   undecided, `F` search.
   The map sits next to aerial imagery (Bulgaria MAF Orthophoto, Esri World
   Imagery, or Mapbox Satellite with your own access token). A new station can
   be dragged onto the chargers, at most 300 m, or flagged with a `fixme` when
   the imagery does not show it. Existing stations are never moved this way.
4. Filters (class, decision, action, update-needed vs already-correct,
   warnings, distance, region, text) are kept in the URL, so a view can be
   bookmarked or shared.
5. Re-loading a newer file keeps your decisions. Rows whose source record
   changed are flagged and must be re-confirmed. Records that vanished from the
   feed are kept as a "worth surveying" list and are never deleted.

## Development

Requires Node 24 (see `.node-version`) and pnpm (via `corepack enable`).

```sh
pnpm install
pnpm dev          # local dev server
pnpm verify       # lint + typecheck + unit/component tests + build
pnpm e2e          # Playwright (Chromium, Firefox, WebKit)
```

Architecture rule: `src/format`, `src/match` and `src/osm/build` are pure
functions over plain data — no network, DOM or storage. This is enforced by lint
(see `eslint.config.js` and `test/guardrail`).

Running an import with the tool, from sandbox testing to the first live batch:
[docs/OPERATOR.md](docs/OPERATOR.md).

## Licence

GPL-3.0-or-later. See [LICENSE](LICENSE).

## Trademark notice

This project is not affiliated with or endorsed by the OpenStreetMap Foundation.
OpenStreetMap® is a trademark of the OpenStreetMap Foundation, used here under
the [OSMF Trademark Policy](https://osmfoundation.org/wiki/Trademark_Policy) to
describe software that works with OpenStreetMap data. Map data © OpenStreetMap
contributors, available under the ODbL.
