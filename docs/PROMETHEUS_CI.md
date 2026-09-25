# Prometheus CI

## Provisioned Runner (2026-09-25)

Repository `hashimkarim/agentic-literature-review` now has dedicated runner
**prometheus-literature-01**, GitHub runner ID **2**, verified online with
`self-hosted`, `Linux`, `X64`, `prometheus-ci` labels before workflow activation.
Real job results will be recorded after execution.

- Stack `/var/docker/literature-review-ci`, Compose project `literature-review-ci`.
  Reproducible source: `deploy/ci-runner/`.
- Standalone Ubuntu 24.04 image; checksummed runner 2.337.0, Node 24.14.0 and
  Bun 1.3.14. No dependency on or changes to the SDK runner image/stack.
- UID 1001, all capabilities dropped, no-new-privileges, 2 GiB RAM, 2 CPUs,
  private bridge, unique volumes. No host Docker socket, production mounts,
  provider credentials, PATs or SSH keys.
- Short-lived registration token supplied on stdin through
  `ACTIONS_RUNNER_INPUT_TOKEN`; never persisted in Compose/source control.
- Root-owned `.sh` wrapper and TypeScript policy admit only this repository's
  `refs/heads/chat-reliability` and push/manual events. PR and main-ref rejection
  were tested. Repository approval policy is `all_external_contributors`.
- `RUNNER_MANUALLY_TRAP_SIG=1` and `stop_grace_period: 2m` use the official
  listener's signal forwarding. Neither adds a model execution timeout.

The workflow independently enforces the same source restrictions. This is a
persistent trusted-source runner, not a sandbox for untrusted PRs. Review branch
and workflow changes before publishing. Build/run only this stack; preserve
existing registration and unrelated stacks. No host-wide prune/volume deletion.

`.github/workflows/ci.yml` runs exact-lockfile install, typecheck, tests with two
workers, and build. Its 20-minute CI job limit is unrelated to agent runs.
Only deterministic/disposable fixtures are used. Native compiler checks remain
opt-in; skipped checks are not compiler validation. Interactive UI verification
uses native T3 on the workstation. macOS/Windows coverage stays paused. No
hosted compute, publishing workflow or production deployment is configured.

## Original Handoff (Superseded Readiness)

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
