# JavaScript bundle budget

## Policy

The production build has separate budgets for JavaScript reachable from the
document roots without crossing a dynamic boundary and all other emitted
JavaScript:

| Loading class | Raw bytes | gzip-9 bytes |
| --- | ---: | ---: |
| Initial | 169,000 | 51,000 |
| Deferred | 12,000 | 4,000 |

Both byte limits are independent hard gates. The check also reports total
JavaScript, but total is informational: the two loading classes already place a
181,000-byte raw and 55,000-byte gzip-9 upper bound on the artifact.

Before experimentation work, the build emitted one 155,429-byte raw /
46,750-byte gzip-9 entry chunk under a 156,000 / 47,000 aggregate ceiling. The
behavior-preserving controller/layout seam first measured 158,472 / 47,470.
The complete audited A/A scaffold then measured 167,930 / 50,262: a
12,501-byte raw / 3,512-byte gzip-9 increase over the historical baseline. The
new 169,000 / 51,000 initial ceiling rounds that observed artifact upward by
1,070 raw bytes and 738 gzip-9 bytes. It is a measured regression guard, not a
forecast.

This code belongs to the initial class because assignment must happen before a
variant is rendered, the shared layout seam is the editor's presentation path,
and the semantic copy/download boundary is needed for the first interactive
export. Moving any of those behind an import triggered immediately after mount
would change bookkeeping without improving startup behavior.

The deferred ceiling starts at 12,000 bytes raw / 4,000 bytes gzip-9. The current
baseline has no deferred chunks, so this is an explicit allowance for a first
genuinely interaction-triggered treatment or a background uploader loaded after
durable local enqueue rather than an upward adjustment copied from an existing
payload. It is about seven percent of the measured initial artifact, large
enough for one narrow slice but small enough to rule out shipping a general
analytics SDK or a duplicated editor implementation unnoticed.

gzip-9 measurements compress each emitted asset independently and sum the
results, matching how separately cached JavaScript files are transferred. CSS,
static pack metadata, and externally hosted artwork are outside this JavaScript
gate and retain their own delivery and caching contracts.

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
explicit dynamic boundary; preserve the 169,000 / 51,000 initial ceiling unless
measured user value and loading impact justify a reviewed new baseline.
