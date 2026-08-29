# seemoji

Pick an emoji, reshape and restyle it directly on the canvas, and copy or
download the result as a transparent PNG. The web app is intentionally local-first: favorites are saved
on the device and there are no accounts or backend services.

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
layout checks do not depend on the Twemoji CDN. Playwright serves the built
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
```

The complete gate builds production assets and then enforces a JavaScript
budget across all emitted chunks: at most 102,000 raw bytes and 33,000 gzip-9
bytes. This keeps the DPR-aware viewport, pressure-aware paint and structured-node compositor,
history, multi-selection, and V2 scene-model baseline
bounded while preserving the bundle-size reduction that motivated the
`preact/compat` adoption.

See [CI strategy](docs/ci-strategy.md) for the active/dormant split and the
conditions that should wake the compatibility matrix.

See [editor workspace](docs/editor-workspace.md) for document recovery,
keyboard shortcuts, history behavior, and grid/snapping semantics.

## Hosting

The application is live at [seemoji.pages.dev](https://seemoji.pages.dev/). It
is a static Cloudflare Pages deployment with no Functions, server runtime,
database, or storage bindings. The release workflow verifies the production
build with the active Chromium gate and uploads that same `dist/` directory
through Wrangler Direct Upload. Firefox and WebKit remain a separate manual
pre-release experiment. See [deployment](docs/deployment.md) for the project,
credential, and protected-environment configuration.

## Architecture

The application is organized around a versioned design recipe and explicit
runtime ports:

```text
UI event
   │
   ▼
editorReducer + history ─────► FavoritesRepository
   │
   ▼
DesignDocumentV2 scene
   │
   ▼
RenderCoordinator ◄────────── EmojiAssetSource
   ├────────► preview canvas
   └────────► prepared PNG ──► ClipboardPort / FileExportPort
```

- `src/domain` owns the design document, strict decoder, legacy migration,
  emoji identity, favorite model, and pure render planning.
- `src/ports` describes capabilities the application needs without choosing a
  browser or future native implementation.
- `src/adapters/browser` contains Twemoji acquisition, Canvas 2D rendering,
  browser clipboard/download behavior, and local favorites storage.
- `src/application` owns the editor state machine, render coordination, bounded
  caches, and the service composition contract.
- `src/ui` contains React-compatible components rendered by `preact/compat`.
  `src/main.tsx` is the only composition root and selects the browser adapters.

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
Unknown document versions are rejected. V1 recipes and the old prototype
favorite format have explicit one-way migrations into the current scene model.

The editor coalesces pointer and slider gestures into bounded undo history.
Position is stored in output-relative coordinates, so direct canvas movement is
resolution-independent just like blur and outline widths.

Named documents and the current recovery draft are stored separately on the
device. Draft writes are debounced and strictly decoded before recovery. JSON
import/export uses the same document codec, while the visual history timeline
remains session-local and can restore earlier design states without mutating the
saved document library.

Zoom, pan, device-pixel-ratio preview resolution, active tools, and brush feel
are transient workspace state rather than document state. Pointer coordinates
are mapped back through the viewport before becoming normalized stroke points.
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

Artwork currently comes from the pinned `jdecked/twemoji` 15.1.0 SVG set through
an `EmojiAssetSource`. The browser adapter validates HTTP and content-type
responses before decoding. A Tauri build can replace this with a bundled asset
source without changing the editor or renderer coordinator.

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
- Named local documents, automatic crash-recovery drafts, and strict JSON import/export
- Visual history navigation and keyboard shortcuts for tools, selection, duplication, grouping, and deletion
- Internal layer copy/paste with duplicate-at-offset behavior
- Configurable grids, persistent workspace preferences, snapping, and alignment guides
- Local scene favorites
- Transparent PNG export at 48, 128, and 256 pixels

Planned native shells can provide a global hotkey, always-on-top behavior,
bundled artwork, and a native clipboard by supplying alternate port adapters.
Animated emoji, accounts, synchronization, Discord bots, and automatic client
injection remain out of scope.

## Attribution

Emoji artwork is from [Twemoji](https://github.com/jdecked/twemoji), licensed
under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
