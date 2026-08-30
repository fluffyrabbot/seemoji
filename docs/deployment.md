# Cloudflare Pages deployment

## Hosting model

Seemoji is deployed as static assets. It does not use Pages Functions, Workers,
KV, D1, R2, or a server-side Node.js runtime. Node is required only while CI
builds and verifies the assets. The repository pins Node 24.13.1 in
`.node-version` and Wrangler 4.127.0 in the lockfile; `package.json` declares npm
11.18.0 as the expected package manager.

`wrangler.jsonc` defines a Direct Upload project named `seemoji` whose output is
`dist/`. GitHub Actions builds that directory without deployment credentials,
exercises it in all supported browser engines, and uploads it as an immutable
workflow artifact. The protected deployment job downloads and re-verifies those
same bytes before Cloudflare credentials are made available to individual steps.
All external actions are full-SHA pinned to reviewed Node 24-native releases;
`scripts/workflow-action-policy.test.mjs` prevents a floating tag or unreviewed
action revision from entering any workflow.

## Release invariants

After the explicitly guarded one-time baseline migration below, every production
release must satisfy all of these invariants:

1. The workflow was manually dispatched from `main`. Tags and ordinary pushes
   cannot deploy.
2. The unprivileged verification job passed lint, unit and architecture tests,
   delivery-policy tests, the production build and bundle budget, Chromium,
   Firefox, WebKit, and both 24-seed persistence stress models.
3. `dist/release-manifest.json` names the full Git SHA and SHA-256 digest of every
   public file. Adding or changing a file after the manifest is generated makes
   artifact verification fail.
4. The exact artifact passed commit-bound header and digest verification on an
   immutable Cloudflare preview deployment before production was changed.
5. Production returned that same commit and every expected digest. A stale but
   otherwise healthy deployment cannot satisfy the check.
6. Before production changes, the canonical deployment's full release manifest
   and every listed public file pass exact verification and are persisted as a
   recovery artifact.
7. If production upload is uncertain, verification fails, or the workflow is
   normally cancelled after production starts while its runner remains available,
   the workflow rolls back to that deployment and verifies every listed file.

## One-time Cloudflare and GitHub setup

1. Create a Cloudflare Pages **Direct Upload** project named `seemoji` with
   `main` as its production branch. Do not connect Git integration to it.
2. Create a Cloudflare API token with Pages Write permission for only the owning
   account. Rollback uses the same supported Pages API permission.
3. Create a GitHub environment named `production` with these environment
   secrets:

   - `CLOUDFLARE_ACCOUNT_ID`
   - `CLOUDFLARE_API_TOKEN`

4. Restrict the environment's deployment branches and tags to the selected
   branch `main`. The workflow's own ref assertion is defense in depth; an
   environment rule also protects against a workflow modified on another ref.
5. Require a reviewer for the `production` environment. When another maintainer
   exists, prevent self-review and disable administrator bypass so release
   approval remains independent of the author.
6. Keep Direct Upload as the only Cloudflare write path. Dashboard uploads can
   bypass GitHub verification and should be reserved for incident recovery.

The project can be created interactively after authenticating Wrangler:

```sh
npm exec wrangler -- pages project create seemoji --production-branch=main
```

Cloudflare Direct Upload projects cannot later be converted to Git-integrated
projects. Moving to Git integration requires a new Pages project.

## One-time hardened baseline

The normal release workflow fails closed before production unless the current
canonical production deployment already exposes a valid `release-manifest.json`
whose full commit matches Cloudflare's deployment metadata and whose complete
file set verifies. This is what makes rollback exact rather than an inference
from whichever assets happen to be referenced by HTML.

A legacy deployment created before release manifests therefore requires one
explicit migration. There is no exact automatic rollback manifest during this
one transition, so schedule a reviewed maintenance window and manually dispatch
**Deploy Pages** from `main` with `bootstrap_legacy_baseline` set to `true`.

The workflow still runs the complete unprivileged gate, uploads and exactly
verifies the candidate on an immutable preview, and enters the protected
`production` environment before any Cloudflare write. It additionally requires
`/release-manifest.json` on the current canonical deployment to be the exact HTML
SPA fallback; arbitrary responses are rejected. The canonical legacy deployment
ID and full commit are persisted in a 30-day artifact named
`seemoji-legacy-bootstrap-target-<run-id>-<deployment-id>` before production
changes. If the candidate fails and the runner survives, the workflow rolls the
canonical ID and commit back, but exact legacy byte verification is impossible
because that is the missing metadata being migrated.

Once candidate production verification succeeds, the canonical deployment has a
full manifest. The bootstrap input then refuses to run again. Every later release
must leave `bootstrap_legacy_baseline` false and use exact manifest-backed
recovery.

## Release workflow

Run **Deploy Pages** manually with `main` selected and
`bootstrap_legacy_baseline` false. The workflow is serialized under the
`pages-production` concurrency group and has two jobs.

The `verify` job has no GitHub environment and no Cloudflare credentials. It:

1. Installs the pinned Node version and locked dependencies.
2. Installs Chromium, Firefox, and WebKit.
3. Runs `npm run check:release`.
4. Uploads the resulting `dist/` as an immutable GitHub artifact named with the
   full commit SHA.

After environment approval, the `deploy` job:

1. Downloads and re-hashes the artifact before any credentialed step.
2. Checks that its step-scoped token can see the `seemoji` project.
3. Uploads the artifact to a SHA-named preview branch and resolves its immutable
   deployment URL.
4. Verifies the preview's exact commit, HTML entrypoints, public-file digests,
   MIME types, security policy, document revalidation, and immutable asset cache.
5. Reads the project's canonical production deployment, requires its full
   commit-bound release manifest, verifies every listed public file, and records
   the exact allowlisted document-header policy used by that release. This keeps
   an intentional CSP migration from making the preceding release unverifiable.
   Only the explicitly guarded one-time bootstrap described above can replace
   this step.
6. Persists `recovery.json` and the trusted previous `release-manifest.json` in a
   30-day GitHub artifact named
   `seemoji-production-recovery-<run-id>-<deployment-id>`.
7. Uploads the unchanged directory to the `main` production branch.
8. Repeats the exact release verification at `https://seemoji.pages.dev`.
9. Calls Cloudflare's supported rollback endpoint if production upload or step 8
   fails, polls until that deployment and commit are canonical again, and verifies
   the production hostname against every path in the trusted previous manifest.

The Cloudflare account ID and API token are attached only to the project lookup,
deployment listing, upload, and rollback steps. Build scripts, tests, artifact
actions, and public HTTP verification do not receive them.

`recovery.json` schema 3 names the previous release's document policy. Candidate
preview and production verification always require the current exact policy;
rollback verification requires the exact recorded predecessor policy. This is a
bounded compatibility contract, not a permissive CSP fallback.

## Release manifest and delivery policy

`npm run build` writes `dist/release-manifest.json` after Vite has finished. The
manifest contains the full release commit, the module and stylesheet paths found
in production HTML, and the byte length and SHA-256 digest of every public file.
`_headers` is a deployment control file rather than a public asset, so its live
semantics are verified through response headers instead of pretending it can be
downloaded.

`public/_headers` explicitly assigns HTML, the release manifest, and other
non-fingerprinted files `public, max-age=0, must-revalidate`. The `/assets/*`
rule first removes that broad cache header and then assigns exactly one year plus
`immutable`. Cloudflare combines duplicate matching headers, so the removal is
required rather than cosmetic.

The production Content Security Policy is an exact allowlist. Verification
rejects missing directives and also rejects additions such as `unsafe-inline`,
`unsafe-eval`, wildcard sources, or unexpected directives. Runtime network
access remains limited to the same origin and the pinned Twemoji host.

## Local verification

Run the complete unprivileged release gate without contacting Cloudflare:

```sh
npm ci
npx playwright install chromium firefox webkit
SEEMOJI_RELEASE_COMMIT="$(git rev-parse HEAD)" npm run check:release
```

Verify an existing immutable deployment or the production hostname only when
you know the full expected commit:

```sh
npm run check:deployed -- https://seemoji.pages.dev "$(git rev-parse HEAD)"
```

The command compares the deployed manifest to the locally verified
`dist/release-manifest.json` and intentionally rejects an older healthy release
or different bytes claiming the same commit. It is a release identity check,
not a generic uptime probe.

## Rollback and recovery runbook

When production upload is uncertain, verification fails, or a normal cancellation
occurs after production starts while the runner remains connected, the workflow
posts to Cloudflare's production rollback endpoint using the canonical deployment
ID and commit captured before upload. It then polls until Cloudflare reports that
exact target canonical again and checks every public file against the persisted
trusted release manifest. The release job remains failed after confirmed recovery
so the incident is visible and the candidate cannot be mistaken for production.

If automatic rollback itself fails:

1. Stop additional release runs; production workflows are serialized, but a
   manual dashboard upload is outside that lock.
2. Download the recovery artifact from the failed run. Its name is
   `seemoji-production-recovery-<run-id>-<deployment-id>`:

   ```sh
   gh run download <run-id> \
     --name <recovery-artifact-name> \
     --dir <recovery-directory>
   ```

3. Inspect `recovery.json`, then run the checked-in API client with Pages Write
   credentials in the environment. Use its deployment ID and full commit exactly;
   do not select a target from deployment-list ordering:

   ```sh
   node scripts/rollback-pages-deployment.mjs \
     seemoji \
     <known-good-deployment-id> \
     <known-good-full-git-sha>
   ```

4. Verify the restored production hostname using the trusted manifest downloaded
   from the failed run, not the failed candidate's local `dist/`:

   ```sh
   npm run check:deployed -- \
     https://seemoji.pages.dev \
     <known-good-full-git-sha> \
     <recovery-directory>/release-manifest.json
   node scripts/verify-production-recovery.mjs \
     https://seemoji.pages.dev \
     <recovery-directory>/recovery.json
   ```

5. Preserve the failed workflow and Cloudflare deployment URLs for diagnosis.
   Fix forward through a new reviewed run; do not mutate or reuse the failed
   artifact.

A force-cancel bypasses conditional cleanup, and a destroyed or disconnected
runner cannot execute it. GitHub also forcibly terminates cancellation cleanup
after its platform timeout. Treat any run that stops after production upload
starts without a confirmed-recovery summary as an incident. The recovery artifact
is uploaded before production changes, so use it with the manual steps above
before starting another release.

Cloudflare documents both [instant Pages rollbacks](https://developers.cloudflare.com/pages/configuration/rollbacks/)
and the [production rollback API](https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/deployments/methods/rollback/).
