# CI strategy

## Goal

CI should protect Seemoji's architectural boundaries, deterministic rendering,
production bundle, and core browser behavior without spending three-browser
matrix time on every small change. This is a local-first, backend-free utility
with a deliberately narrow browser surface, so compatibility breadth has lower
day-to-day value than fast, deterministic feedback.

## Active gate

The `CI` workflow runs for pull requests and pushes to `main`. It installs only
Chromium and runs `npm run check`, which performs:

- Static linting.
- Unit and architecture tests.
- Six deterministic repository and six controller state-machine seeds covering generated two-tab
  operations, transaction aborts, scheduler interleavings, sync delivery, and invariants after
  every transition.
- Delivery-policy contract tests.
- A production TypeScript and Vite build.
- The aggregate production JavaScript budget.
- Chromium rendering, persistence, validation, responsive-layout, and pixel
  golden tests against the built `dist/` artifact.

These checks stay active because they are inexpensive and directly protect the
application's defining behavior. The workflow does not also run for every
feature-branch push when a pull request already supplies equivalent coverage.

Retries are disabled. The artwork is intercepted, persistence is local, and
the server is local, so a retry would primarily conceal nondeterminism that
should be fixed.

## Dormant compatibility gate

The `Compatibility matrix` workflow has only a manual `workflow_dispatch`
trigger. It runs the active gate and then repeats framework-neutral browser
behavior in Firefox and WebKit. The visual golden is tagged `@visual` and
excluded from those engines because their canvas rasterization is allowed to
differ.

Run the standalone dormant workflow:

- Before merging a browser-facing change when compatibility feedback should not
  wait for the complete release gate.
- After changing Preact, Vite, Playwright, or browser support policy.
- After changing Canvas rendering, image decoding, clipboard/download adapters,
  storage behavior, or responsive CSS.
- When a browser-specific regression is reported.

Do not schedule it merely for activity. Browser-version drift without a pending
release or browser-facing change creates maintenance noise but no immediate
user value. If releases become frequent or browser-specific regressions become
common, promote this workflow to a scheduled or required gate based on that
evidence.

The release workflow always runs the same Firefox and WebKit projects regardless
of whether the standalone compatibility workflow ran earlier.

Cross-tab persistence changes must run this matrix before merge. The browser suite forces
`BroadcastChannel` unavailable in one two-tab scenario so Firefox and WebKit exercise the
storage-event invalidation path as behavior, not merely as a unit-test simulation.
The 2026-08-29 storage-and-recovery run passed 16 Chromium scenarios and all 15
non-visual scenarios in both Firefox and WebKit.

## Local commands

- `npm run check`: active CI-equivalent gate.
- `npm run test:storage-stress`: run 24 seeds with 200 generated transitions each, in addition
  to every seed's fixed abort/race prelude.
- `npm run test:controller-stress`: run 24 seeds with 160 generated controller transitions each,
  in addition to every seed's lifecycle/concurrency prelude.
- `npm run test:persistence-stress`: run both deep persistence models.
- `SEEMOJI_STATE_SEED=<seed> SEEMOJI_STATE_STEPS=<steps> npx vitest run src/adapters/browser/indexedDbProjectRepository.state.test.ts`:
  replay a reported persistence counterexample exactly.
- `SEEMOJI_CONTROLLER_SEED=<seed> SEEMOJI_CONTROLLER_STEPS=<steps> npx vitest run src/application/workspaceController.state.test.ts`:
  replay a reported controller counterexample exactly.
- `npm run test:e2e`: build and run Chromium browser tests.
- `npm run test:e2e:compat`: build and run Firefox/WebKit behavior tests.
- `npm run test:e2e:all`: build and run all configured browser projects.
- `npm run check:compat`: active gate followed by Firefox/WebKit behavior.
- `npm run check:artifact`: verify that `dist/` still exactly matches its release manifest.
- `npm run check:release`: compatibility gate, both deep persistence models, and final artifact
  verification; this is the unprivileged production release gate.

The persistence model is independent of IndexedDB: it predicts complete projects, active identity,
quarantined records, conflict resolution, and atomic import results. After every generated action,
the harness also checks monotonic revisions, active-project validity, conflict-lineage acyclicity,
unchanged schema metadata, and exact store topology. Failed import, stale delete, stale save,
tampered purge, concurrent purge, and concurrent conflict-resolution paths must leave the model and
database aligned. Failures print the seed, step count, and recent actions for deterministic replay.

The controller model adds a deterministic timer/microtask scheduler and a sync bus that can reorder,
duplicate, or drop invalidations. It drives two controllers through debounced and explicit saves,
concurrent edits, remote changes while an edit is pending, conflict resolution, project creation,
reload, and disposal. After a guaranteed final invalidation, both controller snapshots must exactly
match the independent model and repository. Every edit accepted during the transition must exist as
the canonical project or a durable conflict/recovered copy. External refreshes share the controller's
write chain, so `flush()` is also a reliable quiescence boundary.

## Release gate

The `Deploy Pages` workflow is separate from ordinary CI and can run only by
manual dispatch from `main`. Tags, pull requests, and pushes cannot deploy.
Release frequency is low enough that this boundary favors certainty over the
dormant day-to-day compatibility optimization.

Its unprivileged `verify` job runs `npm run check:release`, which includes the
active gate, Firefox and WebKit compatibility, both 24-seed persistence stress
models, and a final immutable-artifact check. `npm run build` writes a release
manifest containing the full Git SHA and every public file's SHA-256 digest.
The verified `dist/` directory is uploaded as an immutable GitHub artifact; no
Cloudflare secret is available to this job.

Every external workflow action is pinned to a reviewed full commit SHA from a
Node 24-native release, with the human-readable release beside the pin. The
delivery-policy suite rejects floating tags, unknown actions, stale pins, and
workflow-specific Node versions; all jobs consume the repository's exact
`.node-version` instead. Every job also names the Ubuntu 24.04 runner family;
`ubuntu-latest` is forbidden so an operating-system family migration cannot
arrive implicitly.

The read-only `Workflow platform audit` runs every Monday and on manual dispatch.
It resolves each approved action's latest official GitHub release and commit,
reads both the approved and latest `action.yml`, and fails when a pin is stale or
either runtime is outside the reviewed Node 24 action runtime. It never edits a
workflow or opens a pull request; adoption remains an explicit reviewed change.

Only the dependent `deploy` job enters the protected `production` environment.
It downloads and re-verifies the artifact, and Cloudflare credentials are scoped
to only the steps that require them. The artifact is first uploaded to a unique
preview branch. Its immutable deployment URL must return the expected commit,
digests, exact CSP, exact document revalidation policy, and exact fingerprinted
asset cache policy before production can change.

Immediately before production upload, the workflow reads the project's canonical
production deployment and fails closed unless its full commit-bound release
manifest and every listed public file verify. It persists that known-good recovery
bundle as a 30-day GitHub artifact before production changes. The production
hostname must then return the locally verified candidate manifest and file
digests; a stale healthy release or different payload claiming the same commit
therefore fails.

If upload is uncertain, verification fails, or a normal cancellation occurs while
the runner remains available, the workflow calls Cloudflare's supported rollback
API, polls until the captured deployment and commit are canonical again, verifies
every live file against the persisted previous manifest, and remains red for
investigation. Force-cancel and runner loss cannot execute in-job cleanup; use the
persisted recovery artifact and the manual procedure in [deployment](deployment.md).

The sole migration exception is the reviewed `bootstrap_legacy_baseline` dispatch
input. It is accepted only while canonical production returns the exact HTML SPA
fallback at `/release-manifest.json`, persists the legacy deployment identity
before writing, and refuses to run after the first manifest-bearing production
release. It does not weaken the full-manifest invariant for subsequent releases.

Keep deployment dormant until the Pages project, environment protection, and
Cloudflare secrets described in [deployment](deployment.md) exist. Do not add a
second Pages build through Git integration or a dashboard upload path; either
would bypass the verified-artifact and serialized-rollback boundary.
