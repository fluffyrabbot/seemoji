# UI experimentation

## Current status

The checked-in `export-bar-aa` experiment is an instrumentation-only A/A. Both
variants render the same `EditorLayout`; the only DOM difference is a diagnostic
`data-experiment-variant` attribute. Assignments persist on the device, but the
production composition root uses `NullProductEventSink`, so no experiment or
product events are accepted or leave the browser. This is a scaffolded A/A, not
an operational data-validation run.

This is deliberate staging. It lets CI prove the UI seam, deterministic sticky
assignment, eligible-render wiring, and semantic outcome boundary before a real
treatment or data collector changes product behavior.

## Architecture

```text
EXPERIMENTS definition
        │
        ▼
ExperimentRuntime ──► local installation identity + sticky assignment
        │
        ▼
EditorExperience ───► editor-ready denominator, then accepted exposure
        │
        ▼
experiment-selected export-bar renderer slot (A/A today)
        │
        ▼
EditorLayout + Preview (experiment-agnostic)
        │
        ▼
AssetDelivery ──────► content-free copy/download outcome events
        │
        ▼
ProductEventSink (null in production today)
```

- `src/experimentation/definitions.ts` is the registry. Every experiment has a
  stable key, version, lifecycle status, owner, control, variants, enrollment,
  weights, hypothesis, structured primary metric, guardrails, start, and expiry.
- `src/experimentation/assignment.ts` independently buckets inclusion and
  variant selection. Increasing enrollment adds installations without moving
  already included installations between variants. A version change creates a
  new randomization namespace.
- `src/experimentation/runtime.ts` owns page identity, sticky included
  assignments, durable-identity gating, accepted exact-once in-page exposure,
  lifecycle gating, page sequence, force-control decisions, and post-exposure
  attribution. Before `startsOn` and after `expiresOn`, it forces control and
  emits no exposure.
- `src/ui/experiments/EditorExperience.tsx` is the only editor experiment switch.
  It selects an export-bar renderer slot; `EditorLayout` and `Preview` do not
  know an experiment name or variant.
- `src/application/assetDelivery.ts` turns browser-port results into semantic
  events. Clipboard success means the clipboard write resolved. A browser
  download can only be called `asset_delivery_started`; the page cannot prove
  that the user retained the file.

The event envelope contains a schema version, page sequence, random
installation, page-view, and event identifiers plus experiment attribution.
Events contain no emoji, design, project name, image bytes, filename, clipboard
content, or error message. Collection failures are fail-open and cannot block
editing, copying, or downloading. If experiment identity cannot be durably
written, the runtime forces control and suppresses collection rather than
silently changing the analysis unit across reloads.

The exposure definition is eligible-render intent-to-treat: the editor-ready
view has mounted with the export surface available in its DOM. It is not a
viewport impression. The runtime first requires synchronous acceptance of the
once-per-page `editor_ready` denominator, then requires acceptance of
`experiment_exposed`; later outcomes are attributed only after both succeed.
`ProductEventSink.capture` must return true only after a real sink has durably
queued the event.

At partial or changing enrollment, `editor_ready` remains the total eligible
page denominator. A real sink must stamp the app build and experiment-config
fingerprint when it serializes an envelope so analysis can reproduce the exact
inclusion decision and distinguish exclusion from delivery loss.

The A/A primary metric is explicitly unique-installation clipboard success on
the same page after exposure. Download is a secondary `started` signal because
a browser page cannot prove the user retained the file.

## Experiment lifecycle

For each new UI experiment:

1. Name one falsifiable hypothesis, one primary metric, guardrails, owner, and
   expiry before adding a treatment.
2. Add a typed definition and bump its version whenever weights, variants, or
   eligibility change in a way that requires fresh randomization.
3. Put the branch at the narrowest shared controller/view-model boundary. Both
   branches consume the same model and commands; do not fork the editor
   controller or service composition.
4. Expose only when the eligible treatment is actually rendered. Outcomes that
   occur before exposure remain unattributed.
5. Run A/A first. Before trusting results, verify balanced assignment, one
   exposure per page view, stable identity across reloads, and no unexplained
   metric difference between identical variants.
6. Introduce a real event sink only with an explicit endpoint, retention and
   privacy policy, required consent decision, build/config metadata, bounded
   durable queue, retry/backpressure, idempotency, pagehide flush, and
   delivery-health contract.
   Keep transport behind `ProductEventSink`; do not add an analytics SDK to UI
   components. Do not call A/A operational until this sink accepts observations.
7. Add one treatment, keep an explicit control fallback, and provide an
   operational source for `forceControlOverrides`; the runtime already forces
   control without deleting sticky assignment. A checked-in `paused` status is
   the deploy-time fallback.
8. At expiry, decide, delete the losing branch and dead event fields, remove or
   retire the definition, and remeasure both bundle loading classes.

Enrollment overrides govern only new enrollment; a stored included assignment
stays sticky. Therefore enrollment zero is not a treatment kill switch. Use
`forceControlOverrides` or the definition's `paused` status instead.

## Verification

- Assignment tests pin hash golden values, monotonic ramp behavior, versioned
  randomization, and deterministic population balance.
- Runtime tests prove accepted exposure ordering, denominator/exposure
  deduplication, no pre-exposure or lost-exposure attribution, durable-identity
  gating, sticky assignment, ramp expansion, start/expiry/pause/force-control
  behavior, and fail-open telemetry.
- Browser storage tests strictly decode the versioned local envelope.
- Asset-delivery tests prove honest success/failure semantics, normalize port
  rejection, and isolate collection failures.
- Chromium exercises persistence and forcibly renders both A/A variants across
  reloads. Any first visual treatment must also retain the compatibility matrix
  and add focused accessibility and screenshot assertions.
