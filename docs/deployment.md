# Cloudflare Pages deployment

## Hosting model

Seemoji is deployed as static assets. It does not use Pages Functions, Workers,
KV, D1, R2, or a server-side Node.js runtime. Node is required only while CI
builds and verifies the assets. The repository pins Node 24.13.1 in
`.node-version` and Wrangler 4.127.0 in `package-lock.json`.

`wrangler.jsonc` defines a Direct Upload project named `seemoji` whose output is
`dist/`. The release workflow uploads the exact directory exercised by the
active Chromium gate. Firefox and WebKit remain a separate, manual pre-release
compatibility experiment rather than deployment infrastructure.

## One-time Cloudflare setup

1. Create a Cloudflare Pages **Direct Upload** project named `seemoji` with
   `main` as its production branch. Do not connect Git integration to this
   project.
2. Create a Cloudflare API token with permission to edit Cloudflare Pages for
   the owning account.
3. Create a GitHub environment named `production`. Add these environment
   secrets:
   - `CLOUDFLARE_ACCOUNT_ID`
   - `CLOUDFLARE_API_TOKEN`
4. Add required reviewers to the `production` environment if releases should
   require an approval click.

The project can be created interactively after authenticating Wrangler:

```sh
npm exec wrangler -- pages project create seemoji --production-branch=main
```

Cloudflare Direct Upload projects cannot later be converted to Git-integrated
projects. Moving to Git integration would require a new Pages project.

## Release behavior

`.github/workflows/deploy-pages.yml` can run in two ways:

- Manually through `workflow_dispatch` while the workflow ref is `main`.
- Automatically when a tag matching `v*` is pushed.

The workflow:

1. Installs the pinned Node and npm dependencies.
2. Verifies that its Cloudflare credential can see the `seemoji` Pages project.
3. Installs Chromium.
4. Runs `npm run check`, which builds once and tests the built artifact.
5. Uploads that unchanged `dist/` directory as the `main` production branch.

Overlapping production deployments are serialized and are never cancelled in
progress. Ordinary pull requests and pushes cannot deploy.

## Local verification

Run the complete release gate without deploying:

```sh
npm ci
npx playwright install chromium
npm run check
```

When browser-facing code or the release policy calls for the dormant
compatibility experiment, run `npm run check:compat` separately before
approving production.

Deployment itself intentionally has no dry-run substitute because a successful
Wrangler Pages upload requires a real account, project, and credentials. Verify
those through the protected GitHub environment rather than storing credentials
in the repository.
