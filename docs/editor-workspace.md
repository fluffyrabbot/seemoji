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

**Save now** and `Cmd/Ctrl+S` flush pending autosave work. **Add favorite** adds
quick access without copying its design. **Make a copy** is the explicit copy
operation and creates a new project with a new identity.

Project JSON exports use a versioned envelope containing identity, name,
timestamps, star metadata, and a strictly decoded `DesignDocumentV3`. Import also
accepts bare V1 recipes or V2 scenes, migrates them with an explicit empty group
collection, and always creates a new project identity. Current V3 scenes require
their group collection and reject invalid membership.
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

Undo history is bounded to 100 scene states. Undo and redo move through those
states; pointer and slider gestures are committed as one logical history step.

Layer copy and paste are internal to the current browser session. Pasted and
duplicated layers receive new IDs, are offset down and right, and become the
active selection. The offset is constrained once for the whole selection so
objects retain their spacing near a canvas limit. Copies retain paint order.

## Named groups

Groups are durable organizational selection units in the design. Each has a
stable ID, an editable name, and at least two member layer IDs. Membership is
flat and non-overlapping. Groups preserve each member's own transform, mask,
opacity, and paint order.

**Group** creates a saved group from the selection. **Saved groups** in Objects
allows selecting, renaming, editing members, and ungrouping it. Selecting or
Shift-toggling any member normally acts on the whole group, including after a project opens. Grouping,
renaming, regrouping, and ungrouping participate in normal undo/redo and autosave.
Regrouping existing groups combines their complete memberships.

**Edit members** enters a temporary selection scope for a saved group. The canvas
shows its name and a **Done** button while preserving the full scene. Canvas clicks,
Shift-selection, marquee selection, and the Objects list can select individual
members; `Cmd/Ctrl+A` selects only that group's members. Source, style, transform,
and layer-property changes affect those selected members and keep their group.
Clicking blank canvas clears the selection within the group; selecting an outside
object exits member editing. **Done** or `Escape` selects the complete group again.

Member editing does not create an undo step or enter saved project data. Undo/redo
retains the scope while that group exists, and exits if a history change dissolves
or removes it. Reopening or switching projects starts with normal group selection.
Adding, pasting, or duplicating objects exits member editing and selects the new
independent objects; a copied complete group still retains its copied membership.

Project reload, editable export/import, workspace archives, and project copies
retain groups. Duplicating or pasting a complete group assigns fresh group and
layer IDs and remaps membership together in one undo step. Duplicating one
member alone creates an independent object. Deleting a member removes its
reference; a group dissolves when fewer than two members remain. Undo restores
the corresponding membership with the objects.

## Emoji picking and selection

Emoji choices explicitly target **Add emoji** or **Replace selected emoji**. Adding validates
the requested artwork before inserting a new object; insertion and selection form one undo
step. Replacement names the selected emoji object and preserves its placement and style.
Changing the artwork pack while browsing Add affects future choices. Changing it while
replacing remaps only the named emoji object.

Asynchronous artwork requests capture their project, editor session, target, and request
generation before loading the catalog. A project switch, session replacement, changed source,
or newer picker request prevents stale artwork from being applied. Validation failures leave
the scene and history unchanged.

The inspector follows the current selection. Transform commands target explicit object IDs,
and emoji appearance commands apply only to the named emoji object. Reset restores transforms
and emoji appearance for the selected objects in one undo step, preserving other objects,
artwork sources, text, drawing strokes, and masks. Deselecting is a valid editor state and does
not change the scene. Documents still contain at least one emoji object.

## Responsive workspace and styles

The compact picker starts with popular emoji and successful session recents. Search accepts
names, keywords, and complete pasted emoji; the full name catalog loads on first search
interaction. **See all** expands the collection, and the **Artwork pack** disclosure exposes
pack/version/style choices. Search failures can be retried without changing the design.

Quick styles render the current canonical artwork. Original restores color and transforms
while preserving position; Squish preserves size while changing aspect; Tilt sets a fixed
angle; Sticker adds a white edge. Styles can be reapplied without accumulating distortion.
Detailed properties load only after **More editing controls** opens.

**Saved styles** opens a separate browser library of up to 64 named emoji looks.
Saving and applying a look requires one selected emoji; backing up or importing
the library is available with any selection. **Export styles** downloads a
`seemoji-styles` version 1 JSON backup with every readable style and an explicit
report of unreadable records that were omitted. Those records remain in browser
storage until explicitly removed. **Delete unreadable style** also works when
the stored identity is invalid. It checks the observed record again in the deletion
transaction; if another tab repaired or replaced it, nothing is deleted and the
library refreshes for review.

**Import styles** validates the entire file before showing the proposed names and
counts. **Keep both (rename)** assigns available numbered names; **Skip matching
names** excludes duplicates, using the same Unicode-normalized name comparison
as saving. Cancel writes nothing. Confirm assigns fresh identities and adds the
whole batch in one transaction. Invalid data, capacity limits, write errors, or a
library changed by another tab cannot partially import; refresh the preview after
resolving the reported problem. Backups are limited to 256 KiB. Style backups and
project/workspace archives are separate so reusable looks travel independently
of individual designs.

On phones, **Emoji**, **Objects**, and **Edit** switch the independently scrolling lower
panel while the canvas and Copy/Download actions remain in view. **Projects** opens local
project actions. **Add text** selects the new text and opens Edit; **Change emoji** opens and
focuses search. **Chat preview** shows the composition at 32 display pixels on light and dark
backgrounds; it does not change the chosen PNG export resolution.

## Keyboard map

| Action | Shortcut |
| --- | --- |
| Select, brush, erase, fill, pan | `V`, `B`, `E`, `F`, `H` |
| Restore mask | `Shift+E` |
| Rectangle, ellipse, line, text | `R`, `O`, `L`, `T` |
| Select all layers (group members while editing a group) | `Cmd/Ctrl+A` |
| Copy, paste, duplicate | `Cmd/Ctrl+C`, `Cmd/Ctrl+V`, `Cmd/Ctrl+D` |
| Group / ungroup selection | `Cmd/Ctrl+G`, `Shift+Cmd/Ctrl+G` |
| Flush project autosave | `Cmd/Ctrl+S` |
| Undo / redo | `Cmd/Ctrl+Z`, `Shift+Cmd/Ctrl+Z` |
| Delete selection | `Backspace` or `Delete` |
| Finish editing a group, otherwise deselect and return to Select | `Escape` |
| Temporarily pan the canvas | Hold `Space` and drag |

Tool shortcuts are ignored while typing in an input, textarea, selector, or
editable field. Save-now remains available from a project-name field.
Tool and object creation shortcuts also ignore command and Alt modifiers.

Two fingers pan and zoom around their midpoint. After a pinch starts, the remaining finger
continues panning until every finger lifts, so ending the pinch cannot accidentally paint or
move an object. Trackpad pinch and command-wheel zoom preserve the canvas point under the
pointer. Zoom remains between 50% and 400%.

## Grid and snapping

The grid supports 4, 8, 12, 16, 24, or 32 divisions. Grid visibility, snapping,
and guide visibility are independent: snapping can remain active with the grid
hidden, and guides can be hidden without disabling snapping. These preferences
persist on the device but are intentionally excluded from exported artwork.

Move gestures test layer edges and centers against the canvas, grid, and every
non-selected visible layer. Only the closest candidate within the zoom-adjusted
threshold is applied on each axis.
