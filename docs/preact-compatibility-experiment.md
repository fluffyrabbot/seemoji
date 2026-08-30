# Preact compatibility experiment

Date: 2026-08-27

Status: experiment complete; `preact/compat` adopted after automated and manual
compatibility verification.

## Question

Can the existing React UI run through `preact/compat` without changing the
framework-independent domain, ports, application, or rendering foundation, and
what production bundle reduction would result?

## Controls and method

The React baseline was verified first with `npm run check`. An isolated copy of
that exact source was then created outside the repository. The experiment made
only these framework/tooling changes:

- Removed `react@19.2.8`, `react-dom@19.2.8`, and
  `@vitejs/plugin-react@6.1.0`.
- Added `preact@10.29.8` and `@preact/preset-vite@2.10.6`.
- Replaced the React Vite plugin with the Preact preset.
- Kept all source imports and React TypeScript types unchanged. The preset's
  default aliases route `react` and `react-dom` imports through `preact/compat`.

This tests the smallest reversible compatibility switch, not a rewrite to
native `preact` and `preact/hooks` imports. The official Preact switching guide
describes aliasing React imports to `preact/compat`, and the official Vite preset
documents that the React aliases are enabled by default:

- https://preactjs.com/guide/v10/switching-to-preact/
- https://github.com/preactjs/preset-vite

Both variants used Node 24.13.1, npm 11.18.0, Vite 8.2.2, TypeScript 6.0.3,
Vitest 4.1.11, and Playwright 1.62.1. Production JavaScript was measured from
the built asset using raw byte length and Node zlib gzip level 9.

## Results

| Measurement | React baseline | Preact compat | Difference |
| --- | ---: | ---: | ---: |
| Production JS, raw | 214,127 B | 42,659 B | -171,468 B (-80.08%) |
| Production JS, gzip-9 | 66,992 B | 15,678 B | -51,314 B (-76.60%) |
| Production CSS, raw | 5,874 B | 5,874 B | identical |
| Modules transformed | 31 | 26 | -5 |
| Unit/architecture tests | 27 passed | 27 passed | identical |
| Playwright behavior tests | 5 passed | 5 passed | identical |
| Lint, typecheck, build | passed | passed | identical |
| Production dependency audit | 0 findings | 0 findings | identical |

The Playwright suite exercised:

- The deterministic preview pixel golden.
- Maximum transforms, blur, and outline at every export size without clipping.
- Resolution-independent normalized output bounds.
- Unsupported artwork rejection without corrupting editor state.
- Mobile preview-first layout with no horizontal overflow.
- Project autosave, reload, starring, and template-copy behavior.

The same committed pixel golden passed without update under both frameworks.
No production behavior difference was observed inside this test envelope.

## Manual clipboard matrix

After the isolated bundle and behavior comparison passed, the unchanged React
baseline was exercised in each installed browser. In every case, the app's
Copy PNG action reported success and macOS Preview created a new image document
from the system clipboard, proving that the clipboard payload was an image
rather than fallback text.

| Browser | Version | App result | System clipboard validation |
| --- | --- | --- | --- |
| Google Chrome | 152.0.7977.64 | Copied | PNG opened in Preview |
| Safari | 26.5 | Copied | PNG opened in Preview |
| Firefox | 153.0.4 | Copied | PNG opened in Preview |

## Post-adoption verification

After replacing only the production framework dependency and Vite preset in
the repository, the unchanged verification gate passed again. The adopted
production asset is 42,659 B raw and 15,739 B at gzip level 9, a reduction of
171,468 B raw (80.08%) and 51,253 B gzip-9 (76.51%) from the measured React
baseline. The small gzip-only difference from the isolated experiment does not
change the raw asset size or the compatibility decision.

The production dependency audit reports zero findings, and the architecture
guard confirms that domain, ports, application, and browser rendering adapters
still contain no React or Preact imports.

The post-adoption verification suite provides framework-neutral rendering,
persistence, validation, and responsive-layout behavior in Chromium, Firefox,
and WebKit. Chromium runs in the active PR/main gate; Firefox and WebKit remain
manual for day-to-day compatibility checks and are mandatory in the protected
release gate. The
deterministic canvas screenshot remains Chromium-only to avoid treating
engine-specific rasterization as an application regression. At adoption, active
CI enforced a 45,000 B raw and 17,000 B gzip-9 ceiling across all production
JavaScript chunks; current limits live in `scripts/check-bundle-budget.mjs`.

## Compatibility differences and risks

1. Preact compatibility is an approximation rather than React itself. This app
   currently uses only common hooks, JSX, context-free components, and
   `createRoot`, all of which passed through the compatibility layer.
2. Development diagnostics differ: Preact's `StrictMode` is a `Fragment` alias
   and does not perform React's additional development checks. Preact recommends
   its debug tooling for development diagnostics:
   https://preactjs.com/guide/v10/api-reference/#strictmode
3. The experiment deliberately retained React imports and `@types/react`. A
   later native-Preact import rewrite would be a separate migration with a
   different type surface and should not be bundled into the compatibility
   switch.
4. There are currently no third-party React component libraries. Any future UI
   dependency must be checked against `preact/compat` before adoption.
5. The automated comparison covered Chromium. The manual matrix above covers
   native PNG clipboard writes in the installed Chrome, Safari, and Firefox
   versions on macOS; future browser upgrades can still change permission or
   clipboard behavior.

## Decision

The compatibility switch was adopted because the isolated experiment produced
the same unit, golden, persistence, responsive, and production behavior with a
76.60% gzip-9 JavaScript reduction, and the manual clipboard matrix passed. The
adoption changes only the production framework dependency and Vite preset;
source imports continue through `preact/compat`, and the framework-independent
layers remain unchanged.

A native-Preact import rewrite is intentionally deferred. It would widen the
migration into component source and types without improving the architectural
boundary established by this compatibility switch.
