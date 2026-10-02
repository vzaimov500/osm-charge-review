# Operator guide

For the person who reviews and uploads. The edits are made with your account.

## 0. Before anything touches the live map

The tool enforces these before it will switch to live. Doing them properly is
still your job:

1. **Permission.** Written permission from the data owner, compatible with the
   ODbL, documented on the wiki. The dataset must say `licence:
LicenseRef-permission` and give `permission_url`, or use a compatible licence.
2. **Import wiki page.** Covers source, accuracy, licence, permission, the
   software and its source link (this repository and the adapter), how data
   is translated (link the adapter's `MAPPING.md`), resulting tags, the
   account name, the changeset tagging scheme, and a progress log.
3. **`Import/Catalogue` entry, and the source on the Contributors page.**
4. **Community review.** A Community Forum post titled "Proposed import of …",
   using the import template and the tags `import` and `import-proposal`, plus
   a message to the local community. **Wait 14 days**
   and resolve raised concerns. The tool computes the waiting period from the
   date you enter.
5. **A dedicated import account** named `<username>_Import`, linked from your
   main account's profile, with a different email address.

## 1. Sandbox first

1. Create a sandbox account at <https://master.apis.dev.openstreetmap.org>.
2. Register an OAuth2 application there: _My Settings → OAuth 2 applications →
   Register new application_.
   - Redirect URI: `land.html` next to the address you open the app at, e.g.
     `https://vzaimov500.github.io/osm-charge-review/land.html`. `localhost`
     and `127.0.0.1` are different addresses.
     OSM accepts only `https` addresses, even for your own machine. To run
     locally, create a self-signed certificate once with `pnpm cert`, then use
     `pnpm dev:https` (opens `https://localhost:5173/`) or
     `pnpm build && pnpm preview:https` (opens `https://127.0.0.1:4173/`), and
     register `https://localhost:5173/land.html` and
     `https://127.0.0.1:4173/land.html` (one per line). Accept the browser's
     certificate warning once.
   - Scopes: _Read user preferences_ and _Modify the map_.
   - Confidential application: **no** (PKCE, no secret).
3. Choose **Sandbox (test)** at the top (it reads and writes the sandbox) and
   sign in. The project's sandbox client id is built in; a copy served from
   another address needs its own app, set at build time with
   `VITE_OSM_SANDBOX_CLIENT_ID`.
4. Follow the sandbox protocol. Seed with
   `OSM_SANDBOX_TOKEN=… npx tsx scripts/seed-sandbox.ts`, load the written
   `sandbox-seed.candidates.json`, fetch the OSM data, and check the classes with
   `npx tsx scripts/check-sandbox-seed.ts`. Then exercise
   every action, create a version conflict on purpose, revert a batch, and read
   every changeset back.

## 2. Reviewing

See the README's _Reviewing_ section. Export your state regularly: the status
line turns orange when decisions have been made since the last export.

## 3. Uploading

1. **Upload · N ready** → **Plan batches from ready decisions**. Batches are grouped by geography, up to 50
   each (10 for the first live batches).
2. **Dry run** each batch and open the `.osc` in JOSM. Run the validator and
   look at it. For live batches this is required before _Upload_ unlocks.
3. _Upload_. Every update target is re-fetched first. Anything that changed
   since you decided is left out and returns to the queue flagged.
4. After each batch the tool reads everything back. The batch becomes
   **verified** only when every object matches. Export your state when prompted.
5. If the tab dies or the connection drops mid-upload, the batch stays _in
   flight_. Press **Recover**: it reads the changeset back and reconciles.
   Nothing is ever re-sent blindly.
6. The tool paces you: a delay between batches and a per-session cap. Use the
   time to watch for reactions to your edits.

## 4. Reverting

_Revert…_ shows the plan first: which objects get their previous tags back,
which created objects are deleted, and which were edited by someone else since
(those are never touched, so handle them by hand). A revert gets its own changeset.

## 5. Reporting

_Export audit log_ downloads a Markdown summary per batch, ready for the
wiki progress section or a forum reply, plus the raw event and network logs.

## First live batch

Ten objects, one city, dry run, checked in JOSM, then **stop and watch** for a
few days before continuing.
