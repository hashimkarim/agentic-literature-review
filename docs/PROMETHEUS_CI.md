# Prometheus CI handoff

Requested 2026-09-25. Repository:
`https://github.com/hashimkarim/agentic-literature-review` (the local remote still
uses GitHub's redirect from `Hashim-K`). The checkout has no `.github` workflows;
`gh run list` returned no hosted runs to cancel for this task.

Do not use hosted runner minutes. Keep task commits local until this repository's
runner registration and intended workflow are confirmed. Proposed labels are
`[self-hosted, linux, x64, prometheus-ci]`; they are **not yet verified here**.
The SDK repository's runner does not establish availability for LitAgent.

## Required tooling

- Linux x64, Bun 1.3.14 (root `packageManager`), Node 24+, Git and Git LFS.
- `bun install --frozen-lockfile` followed by `bun run typecheck`, `bun run test`
  and `bun run build`. Use the immutable registry SDK pin; no sibling checkout,
  live provider credentials, real research repository or auth tenant.
- Ordinary tests use deterministic/disposable fixtures. Native compiler checks
  are opt-in: prepared Tectonic/TeX Live runtimes, bubblewrap with working user
  namespaces, `prlimit` and Poppler `pdftotext`. Do not disguise skipped native
  checks as passed compiler coverage or download large runtimes every run.
- Browser scripts use Playwright Chromium/dependencies in unattended CI. Native
  T3 preview remains the interactive task verification tool on this workstation.

## Runner safety and reporting

No untrusted pull request, `pull_request_target` checkout, arbitrary dispatch ref
or external contribution should execute on the persistent homelab runner.
Restrict initial automation to maintainer-approved immutable revisions/manual
dispatch with repository/actor/ref checks. Give jobs read-only source permission,
no publishing credentials, no production mounts and disposable work directories.
Runner setup must establish its actual isolation and cleanup; a label alone does
not provide either. Publication remains separately authorized.

macOS/Windows packaging coverage is paused, not represented by Linux results.
There is no npm publishing workflow for this private application. Do not add a
long-lived registry token as an OIDC workaround. No workflow is dispatched by
this handoff; record runner registration and actual job evidence before changing
the readiness status.
