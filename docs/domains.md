# Emoji Studio domains

The canonical application URL is `https://emojistud.io`. Domain registration and
renewals remain at Porkbun; authoritative DNS is managed in Cloudflare in the
same account as the `seemoji` Pages project.

## Configuration

All three domains use `dan.ns.cloudflare.com` and `irma.ns.cloudflare.com`.
They were onboarded on the Free plan on 2026-09-20 UTC.

| Zone | Name | Type | Content | Proxy |
| --- | --- | --- | --- | --- |
| emojistud.io | @ | CNAME | seemoji.pages.dev | Proxied |
| emojistud.io | www | A | 192.0.2.1 | Proxied |
| emojistudio.org | @ | A | 192.0.2.1 | Proxied |
| emojistudio.org | www | A | 192.0.2.1 | Proxied |
| emojistudio.art | @ | A | 192.0.2.1 | Proxied |
| emojistudio.art | www | A | 192.0.2.1 | Proxied |

The documentation-only address `192.0.2.1` is a placeholder for hostnames that
redirect at the Cloudflare edge. Keep those records proxied and their redirect
rules enabled; they have no origin web server.

`emojistud.io` is also registered as a custom domain on the Pages project.
DNS alone does not establish a Pages custom domain.

Each alternate zone has an active Single Redirect named
**Canonical Emoji Studio domain**. It matches all requests and returns 301 with
the dynamic destination `concat("https://emojistud.io", http.request.uri.path)`.
Preserve query string is enabled.

The primary zone has an active Single Redirect named **Canonical hostname and
HTTPS**, with the same destination, status code, and query preservation. Its
filter is:

```text
(http.host eq "www.emojistud.io") or starts_with(http.request.full_uri, "http://emojistud.io/")
```

Only the canonical hostname serves the editor. Browser project storage is scoped
to an origin, so serving independent editor copies on every hostname would split
the local project library. The existing `seemoji.pages.dev` deployment remains
available for release verification.

## Verification checkpoint: 2026-09-20 05:28 UTC

- All three Cloudflare zones and the Pages custom domain are active.
- Primary HTTPS serves the editor with a valid certificate. HTTP and HTTPS for
  each alternate apex and `www` redirect directly with 301, preserving paths and
  query strings. Primary HTTP and primary `www` also redirect correctly.
- DNSSEC signing is enabled in all three zones. Matching DS records are saved at
  Porkbun (key tag 2371, algorithm 13, digest type 2):

  | Zone | DS digest |
  | --- | --- |
  | emojistud.io | `0BD509F470B554A778293AE71F58465B1419DABEB22AC78B4941DD2674823C90` |
  | emojistudio.org | `DC8504245452513274E4528C7AA5649F7296FBEB1B9DF314003FF3902F9FD542` |
  | emojistudio.art | `7FC60F616606FD729376B273F99DA53094C07D806FC05B42C062792A1B977463` |

  Cloudflare's public resolver returned authenticated DS and apex A answers for
  all three zones. Quad9 authenticated `www.emojistud.io` too. During migration,
  1.1.1.1 initially returned a stale DNSSEC validation failure for that `www` name;
  both authoritative servers returned signed answers. At 05:36 UTC, 1.1.1.1
  also returned an authenticated answer, resolving the remaining propagation issue. Its HTTP/HTTPS checks
  therefore used `curl --resolve` with an authoritative IP and normal TLS
  verification. Other hostnames passed through normal local resolution.
- Set primary zone **Caching → Configuration → Browser Cache TTL** to
  **Respect Existing Headers**. The default four-hour override changed the
  favicon cache policy and failed release verification.
- The canonical hostname passed the repository's deployed header, hash, content
  type, and manifest verification for release
  `4f285e22bebfd18af943e4ca501290881e449f6d` (24 files).
- Chrome loaded artwork and saved a separate `Domain verification` project with
  a partying emoji and `LIVE` text. The content survived reload and the project could be reopened after switching
  to the original project. PNG download
  produced a valid 128 × 128 PNG (6,179 bytes).
- The original DNS contained only Porkbun parking records; no email or
  verification records required migration. Registration remains at Porkbun.
- No application code or new production release was deployed for this migration.

## Future release checks

Verify Cloudflare shows all three zones active and the Pages
custom domain active. Verify DNSSEC delegation and authenticated resolution for
each zone after publishing its DS record.

Check HTTP and HTTPS for the apex and `www` of each domain. Every noncanonical
request must return 301 directly to `https://emojistud.io` with its path and query
string preserved. Check `/` and a path such as `/check?source=domain-test`.
Use ordinary certificate validation; do not bypass TLS errors.

Run the release verification against the new canonical hostname using the known
production commit and its trusted release manifest:

```sh
node scripts/check-deployed-headers.mjs \
  https://emojistud.io \
  <production-commit> \
  <trusted-production-release-manifest.json>
```

For application releases, open the canonical app and confirm artwork loads, a project can be
saved/reopened, and PNG export works. Record observed verification results.
