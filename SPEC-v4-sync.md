# Loci v4 — Sync Spec

Oct 30, 2026 · @ANDREW

## Summary

Sync keeps one person's Loci the same on every device they use: edit on the laptop, see it on the phone a moment later. It is Loci's first backend, and it runs on the Cloudflare account that already hosts the app: the same Worker gets a small API and one Durable Object that holds the synced data. No new paid services, nothing to sign up for.

Loci stays **offline-first**. Every device keeps its full copy in IndexedDB and works with no connection, exactly as today. Sync only moves changes between those copies when it can. Turning sync off, or the server being unreachable, never stops the app.

It is for **one person on several devices**, not for sharing with other people and not for two people typing in the same note at once.

Constraints carry over: no AI, no paid APIs. New dependencies are dev-only (`wrangler` and Cloudflare's Worker types).

## What the user sees

### Settings → Sync

A new section on the Settings screen.

**Off (the default).** One line ("Keep this device in step with your other devices") and two buttons:

- **Set up sync** — for the first device. The app makes a **sync key**, uploads everything on this device, and shows the key with a Copy button: "Enter this key on your other devices. Anyone with it can read and change your Loci, so keep it private." The key is 24 letters and digits in groups of four (`K7QF-2M9X-…`), about 120 bits, with look-alike characters (0/O, 1/I/L) left out.
- **Join with a key** — for every other device. A field for the key (spaces, dashes and case are ignored), then the choice below.

**Joining a device that already has data.** If this device has any loci, the join asks:

- **Merge** (default) — "Keep what's on this device and add it to your synced Loci." Both sides are combined by the same rules as backup merge: records only on one side are kept, and for records on both sides the newer one wins.
- **Replace this device** — "Throw away what's on this device and use your synced Loci." Asks again before erasing.

A device with no loci just downloads.

**On.** The section shows:

- A status line: "Synced just now" / "Synced 4 min ago" / "Offline — 3 changes waiting" / "Can't reach the sync server" / "The sync key was changed on another device" (see Reset).
- **Sync now.**
- **Show sync key** — shows it again, with Copy, for adding another device.
- **Stop syncing on this device** — keeps the data here, forgets the key. The device can join again later (Merge).
- **Reset sync key…** — makes a new key; every other device must join again with it. For a key that leaked or a lost phone. The synced data stays.

### Everywhere else

- **A small sync dot** on the home top bar while sync is on: hidden when all is synced, a spinner while syncing, amber when changes are waiting offline, red for an error (tap → Settings → Sync).
- **Changes from other devices appear by themselves.** The screen showing redraws, the way it does today after an edit made in a sheet. Positions of bubbles move to their new place with the existing transition.
- **An open editor is never changed under the user's hands.** If a note, card or problem being edited changes on another device, the editor keeps what the user has, and a bar above it says "Changed on another device · Show their version". Saving here makes this version the newest, so it wins. "Show their version" replaces the editor content (Undo restores).
- **Deleted on another device while open here:** the screen goes back one level and a toast says "Deleted on another device".

### Backups still work

Export and import are unchanged and remain the way to keep a copy outside Cloudflare. With sync on, an import is synced like any other edit: **Replace** replaces the data on every device (the confirm sheet says so), **Merge** merges into every device.

## How it works

### Where the data lives

| Place | What |
| --- | --- |
| Each device, IndexedDB | The full Loci as today, plus two new local-only tables: `syncOutbox` (changes not yet sent) and `syncState` (the key, this device's id, the pull cursor, last sync time). Neither is synced or backed up. |
| Cloudflare, one Durable Object | The latest version of every record, deleted ones as tombstones, and attachment files. A SQLite database inside the Durable Object. |

**Why a Durable Object** (not D1 or R2): one object is a single place where every push is applied in order, so there are no races between devices. It can hold the WebSocket connections used to nudge other devices. It keeps files too, so nothing else has to be enabled on the Cloudflare account, and SQLite-backed Durable Objects are on the Workers free plan.

### Recording changes: a Dexie middleware

Sync must see **every** write, including the cascades in `deleteLocus` and `deleteElementsAndContents`, `clear()` in backup Replace, and future code nobody remembers to update. So changes are recorded below the app code, in a Dexie DBCore middleware, not at each call site.

- The middleware adds `syncOutbox` to every read-write transaction that touches a synced table. Each change is therefore recorded in the same transaction as the write: a crash can't lose one without the other.
- Per changed record it puts one outbox row, keyed `[table+id]`: `{ table, id, op: 'put' | 'delete', changedAt }`. A later change to the same record overwrites the row, so ten edits to a note send one record.
- `changedAt` is the device clock at the time of the write. Records keep their own `updatedAt` for the UI. Sync does not rely on it, so a code path that forgets to bump it can't break sync.
- Range deletes (`deleteRange`, which `clear()` and some `Collection.delete()` calls become) read the affected keys first and record one delete each.
- Writes the sync engine itself makes while applying pulled changes are marked and **not** recorded, or they would echo back.
- With sync off, the middleware records nothing (no outbox growth on devices that never sync).
- **Set up sync** and **Join → Merge** put every existing record in the outbox, with `changedAt` set to the record's own `updatedAt` (not now). Otherwise a device's old data would beat newer synced data just for being uploaded last. Records without an `updatedAt` use 0, so any synced version beats them. **Join → Replace** clears the local tables (unrecorded) and pulls from `seq` 0.

**Synced tables:** all 18 content tables (`tags`, `loci`, `elements`, `cards`, `reviews`, `links`, `attachments`, `blobs`, `notes`, `todos`, `todoCompletions`, `goals`, `goalContributors`, `goalEntries`, `problemTemplates`, `problemAttempts`, `exams`, `recallAttempts`) and `settings`, except a short list of device-only setting keys. The list is decided in S2 by going through every key; a device's screen size or input habits belong on that device.

### The record on the server

```
records(tbl TEXT, id TEXT, data TEXT /* JSON, null when deleted */, deleted INT,
        changedAt INT, device TEXT, seq INT, PRIMARY KEY (tbl, id))
INDEX records_seq ON records(seq)
```

`seq` is a counter the Durable Object increases by one for every record it accepts. A device's pull cursor is the highest `seq` it has seen.

### Push

`POST /api/sync/push` with up to 500 outbox rows and the current value of each put record (read when the batch is made, so the newest content is sent).

For each record, in one transaction:

- **Newer wins.** The server keeps the incoming change if there is no record yet, or if its `changedAt` is greater than the stored one (equal: the larger device id wins, so every device settles on the same answer). A delete is a change like any other: a newer delete removes, a newer edit brings a record back.
- `changedAt` is capped at the server's clock + 5 minutes, so a device with a wildly wrong clock can't win every conflict forever.
- Kept changes get the next `seq`.

The reply lists, per record, accepted or "server has newer". Sent outbox rows are then removed, unless the record changed again while the push was in flight (its outbox `changedAt` is newer than what was sent), in which case they stay for the next push. Rejected ones are left to the next pull, which brings the newer version.

### Pull

`GET /api/sync/pull?since=<seq>` returns up to 500 records with a higher `seq`, in `seq` order, and whether there are more.

The device applies each one in a transaction, unless the same record is waiting in its own outbox with a newer `changedAt` (the local edit wins and will be pushed). Applying means `put` the data, or `delete` the record, and update the cursor in the same transaction. Then (from S3) the app announces a change (`loci:changed`) once per pull, so the screen showing redraws, with the open-editor protection above.

### When sync runs

A round is **push, then pull** (push first, so this device's newer edits are on the server before it compares):

- when the app opens, and when it comes back to the foreground;
- 2 seconds after the last local change (debounced), so typing doesn't send a request per keystroke;
- when the device comes back online;
- when another device's change arrives (below);
- every 5 minutes while the app is visible, as a safety net;
- from **Sync now**.

Only one round runs at a time; a request during a round queues exactly one more. Failures retry with backoff (5 s, 30 s, 2 min, then every 5 min) and show in the status line.

### Live updates

While the app is visible it keeps a WebSocket open to `/api/sync/live`. After every push the Durable Object sends `{ seq }` to the other connected devices, which then pull. The Durable Object uses the WebSocket hibernation API, so idle connections cost nothing. If the socket drops, polling still works and the socket reconnects with the same backoff.

This is what makes the laptop and phone show the same thing within a second or two of each other.

### Attachments (files)

`attachments` rows sync like any record. The files in `blobs` are too large for a JSON push, so a blob record is synced as metadata only (`id`, `mime`, `size`, `updatedAt`) and its bytes travel separately:

- `PUT /api/sync/blobs/<id>`: upload. The Durable Object stores the bytes in 1 MB chunks (SQLite values are capped at 2 MB). The blob's record is pushed only after its upload finishes, so other devices never see a file they can't fetch.
- `GET /api/sync/blobs/<id>`: download. A device that pulls a blob record downloads the file before writing the row. If that fails it retries later, and the attachment shows "Downloading…" until then.
- Blobs never change after they're made (editing a file means a new attachment), so there's no merging of file contents.
- Deleting a blob record deletes its chunks on the server.

The existing "large file" warning now also says the file is uploaded to every device.

### Keeping the data consistent

Two devices editing offline can leave combinations neither made alone. After every pull that brought changes, a **repair pass** fixes them locally (repairs are ordinary writes, so they sync):

- **Same tag name twice.** Tags are unique by name (`&key`). If a pulled tag has the same name as a different local tag, the one with the smaller id is kept, the loci pointing at the other move to it, and the other is deleted. Both devices pick the same survivor. This reuses backup merge's tag rule.
- **Orphans.** A record whose parent is gone (a card whose element was deleted on the other device while this one added the card) is deleted, with its own children. The parent of each table is the one the existing delete cascade follows.
- **Dangling links and dependencies** are removed, and to-dos that waited on a deleted item become due, exactly as when deleting locally (`wakeDependents`, `deleteLinksFor`).

The repair pass reuses the app's own delete functions (`deleteLocus`, `deleteNote`, …), so a repair removes exactly what deleting by hand would. Deleting something already gone records nothing, so two devices' repairs can't bounce deletions back and forth.

**Granularity.** "Newer wins" is per record. Two offline edits to *different fields* of the same note (title on the phone, pin on the laptop) keep only the newer record. For one person this is rare, and the open-editor bar covers the common case. Field-level merging is a non-goal.

### App versions

Every push and pull sends the app's database version (`db.verno`, now 11).

- The server remembers the highest version it has seen.
- A device older than that is told "Update to keep syncing". It stops pushing (its old code might drop fields newer code added) until the app updates. The PWA updates itself on the next open, so in practice this lasts one reload.
- Records keep unknown fields: the engine never rebuilds records field by field, it stores what it got.

## Security and privacy

- **The key is the account.** All `/api/sync/*` requests carry it as `Authorization: Bearer <key>`. The server stores only its SHA-256 hash.
- **Claiming.** The server starts empty. The first **Set up sync** claims it: if no key hash is stored, the hash is stored. After that, Set up sync from another device fails with "Sync is already set up. Use Join with a key." This Worker serves one person, so there is exactly one key.
- **Losing every device and the key** leaves the data unreachable through the app. Recovery is to delete the Durable Object's storage from the Cloudflare dashboard, which the README explains. Regular backups remain the safety net.
- **Brute force** is hopeless at 120 bits; wrong keys still get a 1-second delay and a 401.
- **Transport** is HTTPS / WSS only.
- **At rest**, data on Cloudflare is readable by the account owner and by Cloudflare, like any hosted app's data. End-to-end encryption is listed under open questions.
- The key is kept in `syncState` (IndexedDB), not `localStorage`, and never appears in a URL.

## Server

The Worker that today only serves files gets code:

- `wrangler.jsonc`: `main: "worker/index.ts"`; a `SYNC` Durable Object binding with a `new_sqlite_classes` migration; `assets.run_worker_first: ["/api/*"]` so everything else is still served straight from `dist` without running code.
- `worker/index.ts`: routes `/api/sync/*` to the one Durable Object (`idFromName("main")`), answers 404 for other `/api` paths.
- `worker/sync.ts`: the Durable Object, holding `meta(key, value)` (key hash, highest app version, seq), `records`, `blobs(id, chunk, data)`.
- The merge decision ("does the incoming change win?") is a pure function shared by the server and the client tests.

The service worker precaches only built files and has no runtime caching, so `/api` requests always go to the network. S1 checks this explicitly.

**Local development:** `npm run dev` stays as it is (no sync). `npm run dev:sync` builds and runs `wrangler dev`, which serves the app and a local Durable Object together.

**Free plan fit.** One person with two or three devices makes a few hundred requests a day, plus one live socket per open app. Stored data is the size of a backup. Both are far below the Workers free plan's limits; S4 records the current limits in the README.

## Data model changes

`db.version(11)`:

- `syncOutbox: '[table+id], changedAt'` — `{ table, id, op, changedAt }`.
- `syncState: 'key'` — rows `deviceId`, `syncKey`, `cursor`, `lastSyncAt`, `lastError`, `serverVersionSeen`.

Neither table is included in backups. Existing tables are unchanged.

## Testing

- **Pure functions** (Vitest, as today): the merge decision, key formatting and parsing.
- **Middleware** with `fake-indexeddb`: every write path records the right outbox rows, including the delete cascades, `clear()`, backup Replace and Merge, and that applied pulls record nothing.
- **Server**: the store and API run in Vitest against Node's built-in SQLite (`node:sqlite`), standing in for the Durable Object's: claim, auth, push ordering, newer-wins with ties, clock cap, pagination, blob chunking, version gate. (`@cloudflare/vitest-pool-workers` needs Vitest 4; Loci is on 5.) Each milestone also runs once in the real local runtime (`npm run dev:sync`).
- **Two-device scenarios**: the client engine against the real server code on Node's SQLite, with the other device writing to the server directly: edits and deletes both ways, no echo, newer-wins in both directions, offline then back online, joining with Merge and Replace, wrong and reset keys, the version gate, the same tag created twice (either side surviving), cards added under an element deleted elsewhere and the reverse, dangling links. Then by hand in two browser origins (`localhost` and `127.0.0.1`) against `wrangler dev`.

## Non-goals

- Sharing a locus with another person, or several people's accounts.
- Field-level merging or live co-editing of one note.
- Version history on the server (backups cover this).
- Signing in with email, Google, etc.

## Open questions

1. **End-to-end encryption.** The device could encrypt each record's data with a key derived from the sync key (WebCrypto AES-GCM, no library) before sending it. The server only needs `table`, `id`, `changedAt` and `deleted` to merge, so the design above already allows it. Cost: about one more milestone. Without it, data on Cloudflare is readable by the account owner and Cloudflare, like most apps. Proposed: not now; can be added later without changing the sync rules.
2. **Which settings stay on one device.** Decided in S2 key by key; the rule is "a preference about you syncs, a fact about this device doesn't".

## Build order

One milestone at a time, each committed and reviewed before the next (as for v2 and Coach).

| Milestone | What | Visible to the user |
| --- | --- | --- |
| **S0** | This spec | — |
| **S1** | Server: Worker code, the Durable Object, claim/auth, push, pull, version gate, `wrangler.jsonc`, server tests, `dev:sync`. Deployed, but nothing in the app calls it yet. | Nothing |
| **S2** | Client: `db.version(11)`, the middleware and outbox, the sync engine (push/pull rounds, triggers, backoff), the repair pass, Settings → Sync (set up, join with Merge/Replace, status, stop, reset), the sync dot. Records only: attachments (links and files) wait in the outbox until S4. Pulled changes show the next time a screen opens (no live redraw yet, so an open editor is never redrawn). | Sync works between devices |
| **S3** | Live updates (WebSocket), screen redraws, the open-editor bar and "Deleted on another device". | Changes appear within a second or two; editors are safe |
| **S4** | Attachment files (upload, download, chunks, "Downloading…"), the large-file warning, backup Replace/Merge with sync on, README (setup, limits, recovery). | Files sync; done |
