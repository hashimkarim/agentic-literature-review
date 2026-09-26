# Public AgenticDriver Alpha.2 Adoption

Application integration: `aa5b365d94beba19f9109be4fe2f1e98ccb62d23` on
`chat-reliability`. No main publication or PR. Earlier PDF/workspace changes
are preserved; the integration replaces only the SDK dependency and panel
compatibility surface.

## Package Identity

- SDK source: `02d2e3a6d7a9a9a4a893debc8e8a6d971d1dcaf5`.
- Package: `@agenticdriver/sdk`, internal version `0.2.0-alpha.2`.
- Public archive: <https://github.com/agenticdriver/agenticdriver/releases/download/v0.2.0-alpha.2/agenticdriver-sdk-0.2.0-alpha.2.tgz>.
- Independently downloaded SHA-256: `a49dcc4c7d146d1f91fae58638d8b901f4ef6f51c873dd227070de54e4c2ebee`.
- Verified archive and Bun lock integrity: `sha512-JSeVyraqRvcHbBVDfQzx9QnNuZ7xqi7dGSPuzBvbKvzsO4EUSOyF2rX5GhvsIRs5YpEAC0KNjBwgeUwUHxVa2Q==`.

All three owning manifests (web, server, agents) use that exact public URL.
No npm registry publication is claimed. The renamed panel package, both vendor
archives and repack script are removed. Installed-package tests resolve client,
panel, UI and connections exports from the same SDK directory. No sibling
checkout, private archive, local type shim or manual profile parser remains.

## Application Checks

- Real checkout: typecheck, 276 tests (2 existing optional compiler skips), and
  all-workspace build pass.
- Fresh source copy `/tmp/litagent-public-alpha2-T8onGH/app` with no preexisting
  node_modules: `bun install --frozen-lockfile` passes, followed by typecheck,
  `bun run test --maxWorkers=2` (276 pass, 2 skipped) and build.
- The initial fresh-copy default-worker test run overlapped a build and failed
  one legacy fake-CLI completion assertion and one 20-second registry test
  timeout. The complete two-worker rerun passed; no production timeout was
  changed. The existing Vite large-chunk warning remains.
- Fixtures cover management/removal permissions, stale revisions,
  `PROVIDER_IN_USE` with safe public errors, legacy read-only hosts, private
  pairing, reload, independent device namespaces and retained cancellation.

## Mounted Native T3 Browser

Actual source checkout backend and built web UI used port 3957 with disposable
research data, not the user's library. Mock SDK hosts used ports 17541/17542.

1. Pair management-enabled host through Settings and a one-use invitation.
2. Explicitly choose `fast` and enable the provider in LitAgent. SDK refresh and
   full page reload preserve both choices; no catalog-driven enablement.
3. Confirm removal of the last provider. The panel offers management onboarding;
   LitAgent retains `fast` as unavailable rather than selecting a replacement.
4. Pair another host with providers=[] and management=false. The panel explains
   missing provider access, exposing only Refresh and Disconnect, no management
   or invitation actions.

Screenshot:
`/home/hashim/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-muit1dwc-4d18871c.png`.
Earlier exact-final-archive checks also confirmed management onboarding survives
reload; previous alpha.2 preflight results remain historical evidence only.

The actual `/api/settings/driver/panel` route is mounted behind existing local
access checks; the browser component calls it through same-origin transport.
Long-lived credentials remain backend-private. No auth migration, shared host
restart, real model/account calls, grant changes or real manuscript edits were
performed. All owned test servers were stopped.

## CI And Remaining Boundaries

Application CI: <https://github.com/hashimkarim/agentic-literature-review/actions/runs/36267498278>.
Job `108474858593`, repository runner 2 `prometheus-literature-01`.
Passed on the exact integration commit: frozen install, typecheck, tests and
build are green. No GitHub-hosted compute was used. SDK CI is not substituted
for app CI. The runner reported the existing checkout action's Node 20
deprecation annotation (executed with Node 24); the job still passed.

Packaged Electron is not certified by this browser/HTTP acceptance. Its wrapper
still starts a Bun workspace backend and defaults to a development web URL;
production resource/startup packaging remains separate. App-scoped usage UI and
the documented legacy-provider removal gate remain product work. Newer client
metadata does not upgrade the operator's running host or imply model entitlement.
