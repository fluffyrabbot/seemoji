# seemoji

Pick an emoji, reshape and restyle it directly on the canvas, and copy or
download the result as a transparent PNG. The web app is intentionally local-first: projects are
autosaved on the device and there are no accounts or backend services.

## Development

Requires Node.js 24 or newer.

```sh
npm install
npm run dev
npm test          # unit and domain tests
npm run test:e2e   # production build in Chromium
npm run build
npm run check     # the active PR/main CI gate
```

The browser tests use deterministic intercepted SVG artwork, so rendering and
layout checks do not depend on the artwork CDN. Playwright serves the built
`dist/` artifact rather than Vite's development transform. The active gate runs
Chromium behavior plus the canvas pixel golden. Install that runtime with:

```sh
npx playwright install chromium
```

Firefox and WebKit compatibility coverage is intentionally dormant rather than
running on every change. Install all engines and invoke it when preparing a
release or changing a browser-facing boundary:

```sh
npx playwright install chromium firefox webkit
npm run test:e2e:compat # Firefox and WebKit behavior
npm run test:e2e:all    # Chromium plus the compatibility matrix
npm run test:persistence-stress # deep repository and controller state-machine runs
```

The complete gate builds production assets and then enforces independent
JavaScript budgets for the document's initial static module graph (at most
169,000 raw bytes and 51,000 gzip-9 bytes) and all deferred or otherwise
unreachable chunks (at most 12,000 raw bytes and 4,000 gzip-9 bytes). It also
reports the informational total. The initial limit is the rounded measured
baseline for the editor experiment seam, assignment runtime, and semantic export
events; the current build emits no deferred JavaScript. See
[JavaScript bundle budget](docs/bundle-budget.md) for the graph classification,
measurements, and policy for changing either ceiling.

See [CI strategy](docs/ci-strategy.md) for the active/dormant split and the
conditions that should wake the compatibility matrix.

See [editor workspace](docs/editor-workspace.md) for project persistence,
keyboard shortcuts, history behavior, and grid/snapping semantics.

## Hosting

The application is live at [seemoji.pages.dev](https://seemoji.pages.dev/). It
is a static Cloudflare Pages deployment with no Functions, server runtime,
database, or storage bindings. The protected release workflow runs the complete
Chromium, Firefox, WebKit, and persistence-stress gate without production
credentials, seals that exact `dist/` directory with a commit-and-digest manifest,
verifies it on an isolated preview deployment, and only then promotes it through
Wrangler Direct Upload. Production verification is bound to the manifest and a
failed promotion automatically restores the previously captured deployment.
See [deployment](docs/deployment.md) for the project, credential, approval, and
rollback configuration.

## Architecture

The application is organized around a versioned design recipe and explicit
runtime ports:

```text
UI event
   │
   ▼
EditorWorkspaceStore ────────► WorkspaceController ─────► ProjectRepository
   │                                  │                         │
   └─ editorReducer + history         └──── WorkspaceSync ─────┘
   │
   ▼
DesignDocumentV2 scene
   │
   ▼
RenderCoordinator ◄────────── EmojiAssetSource
   ├────────► preview canvas
   └────────► prepared PNG ──► ClipboardPort / FileExportPort
```

- `src/domain` owns the design document, durable project model, strict decoders,
  emoji identity, and pure render planning.
- `src/ports` describes capabilities the application needs without choosing a
  browser or future native implementation.
- `src/adapters/browser` contains manifest-driven canonical artwork acquisition, Canvas 2D rendering,
  browser clipboard/download behavior, IndexedDB project storage, storage-health inspection,
  and cross-tab invalidation.
  The project repository exclusively owns its database schema, ordered transactional migrations,
  store invariants, and explicit database/project schema metadata.
  `BrowserWorkspaceSync` prefers BroadcastChannel and falls back to storage events; neither
  transport carries project data.
- `src/application` owns the editor state machine, project lifecycle, revision-aware autosave and
  conflict preservation, render coordination, bounded caches, and the service composition contract.
- `src/ui` contains React-compatible components rendered by `preact/compat`.
  `src/main.tsx` is the only composition root and selects the browser adapters.

UI experiments use one typed, versioned assignment runtime and a single
controller-owned export-surface slot. The checked-in experiment is deliberately
A/A and the production event sink is deliberately null, so it validates both
render branches and sticky assignment without collecting data. See
[UI experimentation](docs/ui-experimentation.md) for the lifecycle and event
semantics required before introducing a treatment or collector.

`src/architecture.test.ts` enforces that the domain, ports, application, and
rendering adapters cannot import React, Preact, or the UI layer. A separate
[Preact compatibility experiment](docs/preact-compatibility-experiment.md)
compared the React baseline with `preact/compat` before the compatibility layer
was adopted.

The source deliberately retains React imports and React TypeScript types; the
Preact Vite preset aliases those imports to `preact/compat`. This keeps the
framework choice at the build boundary. Preact's `StrictMode` compatibility
export does not run React's extra development checks, so contributors should
not treat Strict Mode behavior as equivalent between the two runtimes.

## Design and rendering invariants

`DesignDocumentV2` is an ordered scene with transparent canvas metadata and a
common scene-node contract for emoji, pressure strokes, geometric shapes, text,
and bounded run-length raster fills. Every layer owns a
non-destructive mask: erasing and restoration append ordered mask operations
instead of changing source artwork or brush strokes. Paint layers also own an
affine transform, so moving, resizing, and rotating them never rewrites points.
Unknown document versions are rejected. V1 recipes have an explicit one-way
migration into the current scene model.

The editor coalesces pointer and slider gestures into bounded undo history.
Position is stored in output-relative coordinates, so direct canvas movement is
resolution-independent just like blur and outline widths.

Every named project is canonical and autosaved independently in IndexedDB. Each write uses a
transactional revision compare-and-swap, and invalidation messages prompt other open tabs to reload
committed projects. BroadcastChannel is primary, with a nonce-bearing localStorage event fallback
for engines where it is unavailable. These messages contain project IDs only; IndexedDB remains the
sole persistence authority. Simultaneous edits never silently overwrite one another: a stale writer
is preserved with durable source-project and source-revision lineage. A comparison panel can keep
the original, promote the conflict edit into the original identity, or keep both independently.
Resolution verifies both revisions atomically, and unresolved conflicts prevent deletion of their
original project. The active project identity is updated atomically with creation and deletion.
Starred projects are metadata views over that same project
library rather than duplicate design snapshots. JSON import/export uses the project and design
codecs, while the visual history timeline remains session-local. Versioned workspace archives
export every valid project plus structured details for isolated records. Archive import is additive:
all projects receive new identities, conflict lineage is remapped, and one IndexedDB transaction
either commits the entire batch or none of it. The recovery surface also reports quota and whether
the browser granted persistent storage. Isolated records are never auto-deleted: each can be exported
as a deterministic raw recovery envelope, then explicitly purged with confirmation and an atomic
content-hash guard.

Zoom, pan, device-pixel-ratio preview resolution, active tools, and brush feel
are transient workspace state rather than document state. Pointer coordinates
are mapped back through the viewport and the target layer's inverse affine
transform before becoming normalized layer-local stroke points.
The brush applies a selectable pressure curve and stabilizer while sampling,
then runs an iterative pressure-aware path simplifier at commit time.

The render coordinator resolves artwork for every emoji layer and hands an
ordered scene to the browser compositor. Each layer renders into an isolated
surface, receives its mask with `destination-out`, and is then composited at
layer opacity. Content-keyed per-layer caches avoid repainting pixels for
transform-only edits. Preview and PNG export therefore use the same paint pipeline.

Blur and outline widths are stored as output-relative units. The pure render
planner calculates affine bounds plus effect padding and fits extreme supported
combinations inside the export square. Changing from 48px to 256px therefore
changes resolution without changing the intended composition.

Artwork comes from eight write-once snapshots published at
`fluffyrabbot/seemoji-packs`: Twemoji, Noto Emoji, Fluent Emoji Color/Flat/High Contrast,
Unicode-only OpenMoji Color, FxEmoji, EmojiTwo, Blobmoji, and SerenityOS Emoji.
The picker displays the
selected pack's canonical stills, while a manifest-driven `EmojiAssetSource`
validates URL, HTTP response, content type, and per-pack byte cap before decoding.
The footer attributes packs used by the design, the all-packs dialog exposes every
catalog license, and an OpenMoji-derived PNG shows a persistent CC BY-SA 4.0
share-alike notice before copy or download.
A Tauri build can replace this with a bundled asset source without changing the
editor or renderer coordinator; it should bundle these same pinned snapshot
trees and implement the catalog and asset-source ports against local files.

## Clipboard behavior

The preview prepares the current PNG before enabling Copy. Clipboard adapters
return typed outcomes for copied, unsupported, denied, and failed operations.
Download is a separate user action; a denied clipboard write never causes a
surprise file download.

## Current scope

- Web app with responsive desktop, tablet, and mobile layouts
- Static Twemoji artwork
- Direct move, proportional resize, rotate, keyboard nudge, and before/after comparison
- Undo/redo plus editable numeric controls and quick styles
- Pressure-aware brush and non-destructive eraser tools
- Mask restoration without destructive history edits
- Zoomable, pannable, DPR-aware canvas viewport
- Layer selection, transforms, rename, duplicate, opacity, ordering, visibility, and deletion
- Rectangle, ellipse, line, text, and tolerance-aware flood-fill layers
- Shift-click and marquee multi-selection, group transforms, snapping, alignment, and distribution
- Named autosaved IndexedDB projects, atomic multi-tab conflict resolution, starred quick access, template duplication, strict JSON import/export, and workspace archives
- Visual history navigation and keyboard shortcuts for tools, selection, duplication, grouping, and deletion
- Internal layer copy/paste with duplicate-at-offset behavior
- Configurable grids, persistent workspace preferences, snapping, and alignment guides
- Transparent PNG export at 48, 128, and 256 pixels

Planned native shells can provide a global hotkey, always-on-top behavior,
bundled artwork, and a native clipboard by supplying alternate port adapters.
Animated emoji, accounts, synchronization, Discord bots, and automatic client
injection remain out of scope.

## Attribution

Emoji artwork is from [Twemoji](https://github.com/jdecked/twemoji), licensed
under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
