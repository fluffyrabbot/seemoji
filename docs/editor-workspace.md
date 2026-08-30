# Editor workspace

## Projects and recovery

Every design belongs to a named project. **New** immediately creates and activates
a durable project, and logical edits are autosaved after 250 ms of inactivity.
Writes are serialized within a tab and guarded by a transactional revision compare-and-swap in
IndexedDB. `BrowserWorkspaceSync` uses BroadcastChannel when available and a nonce-bearing
`storage` event otherwise. Both transports carry only changed project IDs and cause peers to reload
committed records from IndexedDB. If both transports are unavailable, revision CAS still prevents
silent overwrite. If two tabs edit the same revision simultaneously, the stale edit becomes a new,
active `(conflict copy)` project; neither design is silently overwritten. Reload opens the active
project directly; there is no competing recovery-draft copy.

Remote refreshes are serialized through the same write chain as local persistence. Delayed,
duplicated, or reordered invalidations therefore cannot refresh across a local write, and a pending
local edit defers the refresh until its save has either committed or become a durable conflict copy.
Disposal starts a best-effort flush before detaching sync listeners.

Conflict lineage is part of the strict project schema and survives reload. The comparison panel
shows both thumbnails, names, and timestamps. **Keep original** removes only the conflict copy.
**Keep conflict edit** promotes its name and design into the original project identity. **Keep
both** clears the lineage and retains two independent projects. Each operation verifies both
current revisions in one IndexedDB transaction; competing resolutions from another tab cannot
partially apply. An original project cannot be deleted while it has unresolved conflicts.

**Save now** and `Cmd/Ctrl+S` flush pending autosave work. Starring a project adds
quick access without copying its design. **Use as template** is the explicit copy
operation and creates a new project with a new identity.

Project JSON exports use a versioned envelope containing identity, name,
timestamps, star metadata, and a strictly decoded `DesignDocumentV2`. Import also
accepts a bare V1 or V2 design recipe and always creates a new project identity.
Projects use IndexedDB. Canvas preferences remain separate device settings and
are intentionally excluded from exported artwork.

## Storage and workspace archives

**Storage & recovery** reports browser storage durability, estimated usage, and quota. When storage
is best-effort, **Request persistent storage** asks the browser to reduce eviction risk; denial does
not disable editing or archives.

The repository owns IndexedDB database version 2 and records `{databaseVersion,
projectSchemaVersion}` metadata alongside workspace control records. Opening the repository runs
every missing database migration in one version-change transaction, validates store names and key
paths, and then verifies the metadata before exposing any project operation. Version 1 projects are
preserved byte-for-byte while the metadata is installed. A failed migration rolls back its database
version and writes; a blocked upgrade tells the user to close other seemoji tabs and retry.

A workspace archive is a strict `seemoji-workspace` version 1 envelope containing every valid
project, the active project, an export timestamp, and structured details for any corrupt records
that IndexedDB isolated. Import is deliberately additive and non-destructive: every archived
project receives a new identity, conflict relationships are remapped to those new identities, and
the archived active project becomes active. The complete batch uses one IndexedDB transaction.
Duplicate archive IDs, invalid projects, missing or cyclic conflict sources, generated-ID
collisions, quota failures, and other write errors leave the existing workspace unchanged.

Isolated records remain in IndexedDB until a person explicitly removes one. **Export raw record**
creates a read-only `seemoji-quarantined-project` envelope with a deterministic structured-JSON
encoding, byte size, and content hash. Export re-reads the record and stops if it changed. A purge
requires browser confirmation and compares both the hash and encoded content inside the same
read-write transaction that deletes the record. Tampering or a competing purge therefore deletes
nothing and refreshes the recovery panel to the latest state.

## History and layer clipboard

Undo history is bounded to 100 scene states. The history row exposes the most
recent eight states and can move directly back to one while retaining the
newer states as redo steps.

Layer copy and paste are internal to the current browser session. Pasted and
duplicated layers receive new IDs, are offset down and right, and become the
active selection. Grouping is a workspace selection aid: selecting any member
recalls the group for shared transforms, while ungrouping leaves the layers and
their ordering unchanged.

## Keyboard map

| Action | Shortcut |
| --- | --- |
| Select, brush, erase, fill, pan | `V`, `B`, `E`, `F`, `H` |
| Restore mask | `Shift+E` |
| Rectangle, ellipse, line, text | `R`, `O`, `L`, `T` |
| Select all layers | `Cmd/Ctrl+A` |
| Copy, paste, duplicate | `Cmd/Ctrl+C`, `Cmd/Ctrl+V`, `Cmd/Ctrl+D` |
| Group / ungroup selection | `Cmd/Ctrl+G`, `Shift+Cmd/Ctrl+G` |
| Flush project autosave | `Cmd/Ctrl+S` |
| Undo / redo | `Cmd/Ctrl+Z`, `Shift+Cmd/Ctrl+Z` |
| Delete selection | `Backspace` or `Delete` |

Tool shortcuts are ignored while typing in an input, textarea, selector, or
editable field. Save-now remains available from a project-name field.

## Grid and snapping

The grid supports 4, 8, 12, 16, 24, or 32 divisions. Grid visibility, snapping,
and guide visibility are independent: snapping can remain active with the grid
hidden, and guides can be hidden without disabling snapping. These preferences
persist on the device but are intentionally excluded from exported artwork.

Move gestures test layer edges and centers against the canvas, grid, and every
non-selected visible layer. Only the closest candidate within the zoom-adjusted
threshold is applied on each axis.
