# Editor workspace

## Documents and recovery

The active design is automatically written to a separate local recovery draft
after 400 ms of inactivity. A reload restores that draft before editing begins.
Named documents are explicit snapshots: **Save** creates or updates one entry in
the document library, while **New** starts from the default scene without
deleting saved entries.

Document JSON exports use a versioned envelope containing the name, identity,
timestamp, and strictly decoded `DesignDocumentV2`. Import also accepts a bare
V1 or V2 design recipe, so exported documents and lower-level scene fixtures
can both be reopened. Documents, recovery drafts, favorites, and canvas
preferences use separate local-storage keys and cannot overwrite each other.

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
| Save document | `Cmd/Ctrl+S` |
| Undo / redo | `Cmd/Ctrl+Z`, `Shift+Cmd/Ctrl+Z` |
| Delete selection | `Backspace` or `Delete` |

Tool shortcuts are ignored while typing in an input, textarea, selector, or
editable field. Save remains available from a document-name field.

## Grid and snapping

The grid supports 4, 8, 12, 16, 24, or 32 divisions. Grid visibility, snapping,
and guide visibility are independent: snapping can remain active with the grid
hidden, and guides can be hidden without disabling snapping. These preferences
persist on the device but are intentionally excluded from exported artwork.

Move gestures test layer edges and centers against the canvas, grid, and every
non-selected visible layer. Only the closest candidate within the zoom-adjusted
threshold is applied on each axis.
