# JavaScript bundle budget

## Policy

The production build has separate hard gates for JavaScript reachable from the
HTML roots through static imports and JavaScript behind dynamic boundaries:

| Loading class | Raw bytes | gzip-9 bytes |
| --- | ---: | ---: |
| Initial | 193,000 | 59,000 |
| Deferred | 38,000 | 13,800 |

Both limits are independent. Total JavaScript is informational; these gates
cap it at 231,000 raw bytes and 72,800 gzip-9 bytes. Each emitted asset is
compressed independently, matching separately cached transfers. CSS, static
pack manifests, and externally hosted artwork are outside this JavaScript gate.

## Contextual editor baseline

The previous A/A editor baseline used initial limits of 169,000 raw / 51,000
gzip-9 and a deferred allowance of 12,000 / 4,000. The exact before and after
artifacts below were built and measured with the same Node.js 24.13.1 runtime;
using a different Node/zlib version can change gzip output even for identical
raw JavaScript.

| Artifact | Initial raw | Initial gzip-9 | Deferred raw | Deferred gzip-9 |
| --- | ---: | ---: | ---: | ---: |
| HEAD before contextual editing | 167,957 | 50,280 | 0 | 0 |
| Contextual editor | 183,034 | 55,566 | 11,062 | 4,330 |

Startup grows by 15,077 raw bytes / 5,286 gzip-9 bytes. The initial class now
includes explicit Add/Replace with stale-request protection, contextual
selection and group transforms, rendered style presets, compact search/paste
and recents, and pointer navigation. These support the first usable editing
flow and must be available before an advanced panel is opened. The existing
A/A assignment and export semantics remain in that same initial graph.

Two genuine interaction boundaries limit the initial cost:

- `AdvancedControls` loads only when **More editing controls** opens:
  4,679 raw / 1,476 gzip-9 bytes. It reuses the initial slider and gesture
  implementation through a typed component contract.
- `emojiSearchCorpus` loads only on search focus/input or **See all**:
  6,383 raw / 2,854 gzip-9 bytes. The compact popular set and exact pasted
  emoji remain usable without it. Failed loading can be retried.

Neither import runs on mount. Splitting the full search catalog reduced the
initial graph by 5,521 raw / 2,579 gzip-9 bytes in an isolated same-snapshot
comparison. The advanced-controls split also avoids fetching detailed fields
for the quick remix flow. Shared rendering, sliders, and scene commands are
reused; the duplicate layer-list properties and implicit first-emoji command
path were removed. Further deferral of the remaining features would delay
selection, typing, style previews, or safe first interaction, so this change
accepts the residual initial increase for those user-visible capabilities.

That round's initial ceiling rounded the measured artifact to 184,000 / 56,000, leaving
966 raw / 434 gzip-9 bytes. The deferred raw ceiling stays at 12,000; its gzip-9
ceiling rounds to 4,500 to cover both measured interaction slices, leaving
170 gzip-9 bytes. Total observed JavaScript is 194,096 raw / 59,896 gzip-9 bytes.
These are measured regression guards, not capacity forecasts.

## Shared geometry, durable groups, and saved styles

The follow-up replaces duplicated canvas/inspector transform math with one domain
implementation and removes emoji auto-fitting. V3 documents persist named group
membership, with strict migration, selection expansion, undoable group commands,
and identity remapping for copies. These rules are required immediately when a
project opens or an object is selected, so they remain in the initial graph.

| Artifact (Node 24.13.1) | Initial raw | Initial gzip-9 | Deferred raw | Deferred gzip-9 |
| --- | ---: | ---: | ---: | ---: |
| Contextual editor | 183,034 | 55,566 | 11,062 | 4,330 |
| Geometry, groups, and saved styles | 189,527 | 58,039 | 22,481 | 9,057 |

This adds 6,493 raw / 2,473 gzip-9 initial bytes. Reusing one constrained transform
implementation removes the duplicated gesture calculations; deferring the remaining
group decoder or selection rules would delay opening and safely editing saved scenes.

The entire saved-style capability loads only after **Saved styles** opens: its UI,
look codec, ordered application service, and transactional IndexedDB adapter total
11,419 raw / 4,729 gzip-9 bytes across four deferred chunks. The composition root
caches an asynchronous loader and the UI imports the component on disclosure;
neither starts on mount. Advanced controls and the search corpus retain their own
interaction boundaries. Shared emoji identity code is emitted as an 813-byte
initial chunk and is counted in the initial subtotal.

The new limits round this measured artifact to 190,000 / 58,500 initial and
23,000 / 9,300 deferred, leaving 473 / 461 initial and 519 / 243 deferred bytes.
The deferred increase buys a new persistent capability without fetching its
storage implementation for the quick remix flow. Total measured JavaScript is
212,008 raw / 67,096 gzip-9 bytes. The limits remain tight regression guards.

## Group member editing and portable style backups

| Artifact (Node 24.13.1) | Initial raw | Initial gzip-9 | Deferred raw | Deferred gzip-9 |
| --- | ---: | ---: | ---: | ---: |
| Geometry, groups, and saved styles | 189,527 | 58,039 | 22,481 | 9,057 |
| Member editing and style backups | 192,130 | 58,723 | 37,526 | 13,637 |

The initial increase is 2,603 raw / 684 gzip-9 bytes. Temporary group scope,
selection normalization, gesture cancellation, and the stable canvas toolbar
support direct member editing and preserve group identity through undo and
project switches. These extend the existing selection and command paths; delaying
them until a panel opens would leave canvas selection and keyboard behavior
inconsistent with the current mode.

The deferred increase is 15,045 raw / 4,580 gzip-9 bytes. All style archive code
remains behind the Saved styles disclosure: strict bounded decoding, duplicate
name planning, review and confirmation UI, fresh identities, transactional
snapshot checks, and guarded recovery for unreadable records. The shared archive
module contains the look codec and import planning once; UI, service, and adapter
reuse it. Recovery compares the observed stored graph inside the deletion
transaction so an old recovery action cannot delete a repaired or replaced record.

Neither storage nor archive parsing starts on mount. A narrower backup-only split
would move bytes between deferred chunks without reducing this deferred total;
the library must retain its transactional validation and recovery capability.
The added transfer enables portable, reviewable backups with atomic import and
an actionable recovery path, while the quick remix flow does not fetch it.

The ceilings round the measured artifact to 193,000 / 59,000 initial and
38,000 / 13,800 deferred, leaving 870 / 277 initial and 474 / 163 deferred bytes.
Total measured JavaScript is 229,656 raw / 72,360 gzip-9 bytes. These remain
measured regression guards rather than speculative capacity allowances.

## Classification

`npm run check:bundle` roots the graph in the built `dist/index.html` rather
than trusting source-level conventions or chunk names:

1. JavaScript module scripts and `modulepreload` links in the document are
   initial roots. A modulepreload is initial because the browser may fetch it as
   part of document startup even if execution happens later.
2. Every literal static import and re-export reachable from those roots is
   initial.
3. Every other emitted `.js` asset is deferred. This includes literal dynamic
   import targets, their otherwise-unreached static dependencies, worker-like
   chunks, and orphan chunks. Orphans consume the deferred allowance so stale
   build output cannot become free bytes; they should normally be deleted.
4. The classifier parses every emitted JavaScript asset, including orphans. It
   fails closed on missing targets, external or bare module specifiers, parent
   traversal, encoded/query aliases, non-JavaScript module targets, computed
   dynamic imports, inline module scripts, non-module script sources, HTML
   character references, `<base>`, and classic script preloads.

This distinction protects startup cost while making deliberate code splitting
possible. “Deferred” describes graph reachability from the document, not a
guarantee that an interaction will wait before requesting the chunk. A feature
that invokes `import()` immediately after mount still passes the deferred gate
but should be treated as startup work in performance review.

## Changing a ceiling

Do not raise a limit merely to make CI green. Record all of the following in the
change that adjusts it:

- The exact before-and-after raw and gzip-9 output from `npm run check:bundle`.
- Which loading class changed and why that code belongs there.
- The user-visible capability that justifies the transfer cost.
- Why removal, reuse, or a narrower boundary was insufficient.

When a deferred experiment concludes, delete the losing branch and lower the
deferred ceiling if its measured steady-state payload leaves durable unused
capacity. When startup code grows, first move interaction-only work behind an
explicit dynamic boundary; preserve the 184,000 / 56,000 initial ceiling unless
measured user value and loading impact justify a reviewed new baseline.
