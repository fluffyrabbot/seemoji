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

Run the dormant workflow:

- Before a release.
- After changing Preact, Vite, Playwright, or browser support policy.
- After changing Canvas rendering, image decoding, clipboard/download adapters,
  storage behavior, or responsive CSS.
- When a browser-specific regression is reported.

Do not schedule it merely for activity. Browser-version drift without a pending
release or browser-facing change creates maintenance noise but no immediate
user value. If releases become frequent or browser-specific regressions become
common, promote this workflow to a scheduled or required gate based on that
evidence.

## Local commands

- `npm run check`: active CI-equivalent gate.
- `npm run test:e2e`: build and run Chromium browser tests.
- `npm run test:e2e:compat`: build and run Firefox/WebKit behavior tests.
- `npm run test:e2e:all`: build and run all configured browser projects.
- `npm run check:compat`: active gate followed by Firefox/WebKit behavior.

## Release gate

The `Deploy Pages` workflow is separate from ordinary CI. It runs manually from
`main` or automatically for `v*` tags, enters the protected `production`
environment, runs the active `npm run check` gate, and uploads the resulting
`dist/` directory to Cloudflare Pages. The tests and deployment therefore
consume the same production artifact rather than independent rebuilds.
Cloudflare project access is checked immediately after dependency installation,
before browser installation or test work, so a missing, expired, or malformed
deployment credential fails cheaply.

After upload, the workflow checks the live production document and its current
fingerprinted JavaScript asset. Missing CSP, permissions restrictions, defensive
headers, or immutable asset caching fails the deployment job even when Wrangler
accepted the upload. This production-only assertion is not duplicated in the
ordinary CI workflow because local Vite preview does not interpret Cloudflare's
`_headers` file.

The deploy job deliberately does not reinstall Firefox and WebKit or repeat
`check:compat`. Run the dormant compatibility workflow before a release when
the policy above calls for it, then use the protected-environment approval as
the human release boundary. Keeping the compatibility matrix out of the deploy
job prevents every retry or credential-only redeploy from paying the broad
browser cost again.

Keep deployment dormant until the Pages project, environment protection, and
Cloudflare secrets described in [deployment](deployment.md) exist. Do not add a
second Pages build through Git integration; that would weaken the verified
artifact boundary and duplicate CI.
