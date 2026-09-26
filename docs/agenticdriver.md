# AgenticDriver SDK integration

LitAgent can connect one application server to multiple AgenticDriver devices,
and a driver can serve multiple applications through independent grants.
The integration stays in
`packages/agents`; workflows continue to consume normalized run events.

Install the exact registry SDK and app dependencies from the committed lockfile:

```bash
bun install --frozen-lockfile
```

Open **Settings > Providers > Add connection** and paste a one-use invitation
from a driver. The application backend exchanges it and stores the credential
privately. Existing hosts can instead use the address and local token-file form.
No provider sign-in or model request is started by connecting or refreshing.

Environment configuration is still supported for first-time setup:

```bash
export AGENTICDRIVER_URL=http://127.0.0.1:7433
export AGENTICDRIVER_TOKEN=YOUR_DRIVER_BEARER_TOKEN
bun run dev:server
```

Use HTTPS beyond loopback, reachable from the LitAgent backend. Existing first
connection IDs remain `driver.<instance>`; additional connections use
`driver.<connection UUID>:<instance>`, preventing collisions between devices.
New instances remain disabled until explicitly enabled in LitAgent. Select an
explicit model. Refresh in Settings discovers metadata without a restart or
changing saved choices. A saved connection registry takes precedence over the
environment, including an intentionally disconnected registry.

The adapter implements start/interrupt/stop, normalized events, failure classes,
usage in completion payloads, and local cache artifacts. `AgentHarness` continues
to provide best-effort NDJSON event logging. Results are saved only under
`.litagent/cache/provider-runs/` and then passed to the existing proposal/review
workflow. Truncated or failed output is not marked as a completed artifact.
The SDK adds no default run deadline or inactivity timeout. A host can opt into
`limits.idleTimeoutMs`; model and tool progress reset that timer. Interrupt and
stop continue to cancel the active remote request.

Remote execution receives the prompt/context supplied by the application. It
cannot browse this machine's library files. Direct Q&A already includes indexed
passages; workflows that depend on arbitrary CLI filesystem access should use
the existing local adapters until their context/tool interfaces are made portable.
Citation linking and acceptance of proposed research changes remain application
responsibilities.

Credentials belong in backend secret storage. Provider keys and CLI sessions
stay on the driver device. Multi-user deployments must choose scoped execution
credentials for their tenancy model. Current setup/management routes use the
existing local-only access guard; they do not add application login or enable
remote-browser administration of the LitAgent server.

Run `bun run typecheck` and `bun run test`. New tests cover real host execution,
artifact creation, cancellation, truncated results, and explicit enablement.

## Scoped Package Migration

The original scoped-package migration pinned the published MIT-licensed
`@agenticdriver/sdk` exactly to `0.1.0`. This historical receipt is superseded
for the active dependency by [alpha.2 adoption](#public-alpha2-adoption).
No sibling SDK build, checkout-relative dependency or TypeScript alias is needed.
The external root/client/providers/server imports use the scoped package.

Verified release provenance:

- Source/release commit: `442ca9c627717f0cdb42ad8260a9692357c79a87` in
  `https://github.com/agenticdriver/agenticdriver` (per SDK handoff).
- Archive: `https://registry.npmjs.org/@agenticdriver/sdk/-/sdk-0.1.0.tgz`.
- Downloaded archive SHA-256:
  `bb606cb0a78d5129c2ce341639f4528fedcbb0827c7986bfe362244f27ac4c68`.
- Downloaded archive and registry/lockfile integrity:
  `sha512-GuJ+fENsGqF82jPs5/nlnA413/l8y06OiZpd7v1Y2AGI/qa7j3pZFtnhIVUGEooG/IdPzMvdY7nIi7QU594lPA==`.

The SDK requires Node >=22.13; the separate planned Better Auth/AuthYard host
requires Node 24+. Package migration does not implement application login.
The internal `@litagent/agents/agenticdriver` export, CLI command `agenticdriver`,
environment names, `driver.<instance>` IDs, settings and account bindings are
unchanged. It does not adopt new retrieval, session or job APIs.

Verification uses actual installed registry bytes, synthetic providers and
temporary repositories, never selected real provider accounts:

- Typecheck and all 117 tests pass, including the five adapter tests for remote
  event/usage/artifact normalization, cancellation, truncation, explicit
  enablement and persisted settings/disabled cached adapters.
- A fresh disposable source copy installs with `bun install --frozen-lockfile`,
  resolves `/node_modules/@agenticdriver/sdk/dist/client.js` locally (not a
  sibling symlink), and passes typecheck, all 117 tests and the workspace build.
- Chat browser checks pass at 1440px and 1920px with scoped conversations,
  evidence selection, stale/out-of-order citation protection and reading position.
- The initial suite run concurrent with the build hit three fake-CLI discovery
  failures; the serial rerun and independent clean-install suite pass. Builds
  retain the existing Vite large-chunk warning.

The unmerged AD-035 `agenticdriver-connection-setup` branch at `4f4be92` still
pins `vendor/agenticdriver-0.1.0-sdk.dbe847c.tgz`. It is preserved unchanged and
not part of this migration. During coordinated integration, retain this registry
pin, audit its additional imports/scripts and run its HTTP settings/workflow
fixtures (refresh/failure/recovery, offline disablement, secret isolation,
reload persistence, reviewed proposals and canonical Markdown unchanged).
Those unmerged tests have not been run as active-branch migration evidence.

Desktop packaging and packaged-runtime checks remain separate from TypeScript
builds. Development still needs Bun/Node and a configured SDK host for remote
execution; no SDK source checkout or bundled auth server is required. See the
[authentication plan](AUTH_PLAN.md) for pairing and credential migration.

Keep Better Auth plus AuthYard on the explicitly qualified connector contract;
the SDK package rename does not qualify a renamed AuthYard connector. Separate
fixture/install evidence from live-provider acceptance: native Antigravity
tool isolation remains blocked, with no new real-account inference certified.

## Authorized Codex Check (2026-09-25)

The published client was exercised through the actual writing UI against the
user-selected local Codex host, model `gpt-6-luna`, medium effort. Synthetic-only
generation, selected-source evidence navigation and cancellation during review
were observed; no manuscript edit was accepted. This supersedes the earlier
absence of live evidence for this selected route, not the separate Antigravity
isolation status. Startup-only catalog discovery still blocks full connection
refresh acceptance on this branch. See the [run IDs, checks and remaining gaps](validation/writing-live-2026-09-25.md).

## AD-035 Reconciliation (2026-09-25)

Completed live application acceptance is recorded in the
[AD-035 receipt](validation/ad-035-live-2026-09-25.md), superseding the earlier
startup-only discovery and pending-live limitations above. It includes exact
SDK run IDs, cited Q&A, synthetic-only writing acceptance, offline recovery,
error/retry, host-confirmed interruption and diagnostic usage reconciliation.
Usagestat backend ingestion and packaged-desktop certification remain separate.

The connection implementation from `agenticdriver-connection-setup` commit
`4f4be9240080c776d0b7161501e038577e9b6202` is now reconciled into the current
workspace. Its catalog, settings UI/routes, adapter lifecycle/error handling,
installed-SDK workflow tests and browser regression script are reused. The
published `@agenticdriver/sdk@0.1.0` pin and recent writing/view preferences are
preserved; the old vendor archive and sibling-source configuration are not used.

Native T3 preview verified explicit model selection/enablement, actual catalog
refresh, offline status, disabling while offline, reload persistence and recovery
without re-enablement. A disposable loopback fault proxy targets the authorized
host without stopping it: `scripts/live-driver-proxy.ts` requires explicit opt-in;
SIGUSR1 simulates offline discovery, SIGUSR2 rejects new runs, SIGHUP restores
transport. These are injected failures, not an actual provider outage. It forwards
no alternate account/model and records no credentials or prompt bodies.

Typecheck, 207 tests (two opt-in compiler tests skipped), and build pass. The
ported standalone browser script is retained for regression use; this session
uses native T3 preview instead. Remaining live Q&A/usage and writing-review
checks are tracked in issue #5 before final acceptance.

## Catalog-Only Regular Connection (2026-09-25)

The separately provisioned regular local host at `http://127.0.0.1:7433` is now
connected through Settings using its private local credential file. Credential
contents never enter browser settings, receipts or the source repository. The
existing synthetic validation host and its credentials remain unchanged.

The host uses SDK source `2ddb90206dc5052ed7d668bf947b3ca4292cb593`, not a new
registry release. LitAgent retains `@agenticdriver/sdk@0.1.0`. At this check the
SDK's successor example assertion fix/Prometheus rerun was pending; app checks
are independent of that SDK CI outcome.

`driver.modelCatalog` preserves the host-reported inventory, source and
pagination completeness. `AgentProvider.models` remains the execution allowlist.
Settings displays the inventory separately with permission labels, and an empty
allowlist is explicitly catalog-only. It cannot enable a provider or start a
run, even when a previously saved selection remains. Refresh retains explicit
app enablement/model preferences without granting newly discovered entries.
Complete inventory is not proof of account entitlement or live qualification.

Native T3 browser checks at 1920x1080 and 390x844 verified Settings, saving the
connection by file path, refresh and reload persistence: nine reported Codex
models, zero permitted models, disabled model selection and enable controls.
Narrow Settings content has no horizontal overflow. No generation was attempted
and no research content was sent. Execution rejection is tested using fixtures,
not requests against the regular host. Typecheck and 237 tests pass (two optional
compiler tests skipped).

## Shared Panel And Multiple Devices (2026-09-26)

Settings embeds the SDK-owned provider component and same-origin backend bridge.
The initial integration used the explicitly handed-off source candidate `3217b8d`
under a metadata-only alias. [Alpha.2 adoption](#public-alpha2-adoption) replaces
that temporary alias and the execution dependency with one public SDK archive.
There is no sibling checkout dependency or second provider runtime.

Each connection has a stable local ID, editable connection/device names and its
own private credential. Names are app-owned display labels, not verified remote
device identities. The application server has a persisted client ID and device
name. Existing singleton files migrate without changing historical provider IDs.
Removing a connection never reuses its namespace or selects another account.

Host provider settings are changed through the SDK's revision-checked management
API and remain canonical on the driver. Ordinary execution credentials cannot
manage providers. Management-only grants cannot execute. LitAgent stores only
its connection details and app-specific enablement/defaults; browser preferences
retain the selected connection and exact provider/model. SDK model favorites and
visibility stay device-local, scoped by connection and instance. Refresh never
broadens grants, enables a provider, or chooses a model.

Omitted host `models` means unrestricted explicit selection; `[]` means deny all;
a nonempty list restricts execution. `modelCatalog` is independent advisory
inventory. Local disconnect forgets that app connection and disables new work;
host revocation is separate. Existing streams retain their cancellation client.
Offline status has Retry and local Disconnect without switching providers.

The regular host's SDK-owned activation at `23e7954` supersedes the historical
catalog-only scope above. App metadata checks observed nine Codex and fourteen
Claude catalog entries, both with omitted model restrictions. The disposable
app kept both disabled with no selected model across refresh and restart. These
checks sent no model prompts or research data. The SDK's separate live smoke and
metering receipt is not a new LitAgent generation certification.

Still SDK-owned: automatic Usagestat provisioning, safe app-scoped usage reads,
verified device metadata, and a policy for future providers on existing paired
grants. The reviewed pairing contract grants an explicit provider list; LitAgent
does not silently expand it. No Usagestat administrative credential is consumed.
Legacy direct providers remain until the [consolidation gate](ROADMAP.md#provider-consolidation)
passes. See the [application validation receipt](validation/driver-panel-2026-09-26.md).

## Public Alpha.2 Adoption

Server, browser panel and execution adapter now share `@agenticdriver/sdk`
version `0.2.0-alpha.2`, pinned to the exact public GitHub release archive in
all three owning manifests and `bun.lock`. npm registry publication remains
pending; this is a public release-asset dependency, not a registry semver pin.
There is no private archive path, sibling SDK link, renamed panel package or
local managedHost type workaround. The obsolete vendor archives and repack
script have been removed.

- Source: `02d2e3a6d7a9a9a4a893debc8e8a6d971d1dcaf5`.
- Release: <https://github.com/agenticdriver/agenticdriver/releases/tag/v0.2.0-alpha.2>.
- Archive: <https://github.com/agenticdriver/agenticdriver/releases/download/v0.2.0-alpha.2/agenticdriver-sdk-0.2.0-alpha.2.tgz>.
- SHA-256: `a49dcc4c7d146d1f91fae58638d8b901f4ef6f51c873dd227070de54e4c2ebee`.
- Lock integrity: `sha512-JSeVyraqRvcHbBVDfQzx9QnNuZ7xqi7dGSPuzBvbKvzsO4EUSOyF2rX5GhvsIRs5YpEAC0KNjBwgeUwUHxVa2Q==`.

The actual Settings screen mounts `@agenticdriver/sdk/ui`; its transport uses
the existing `/api/settings/driver/panel` backend route and SDK panel adapter.
Existing local-access/origin checks remain in place and credentials remain
backend-private. Pairing uses `connectClient`; no hand-written profile parser
is needed. Old hosts stay read-only when management is unavailable. Removal
requires the host capability, management permission, confirmation and current
revision; referenced static grants produce a recoverable `PROVIDER_IN_USE`.
Empty management hosts offer onboarding; empty read-only connections explain
provider access without exposing management controls.

No host restart, grant expansion, account/model substitution, auth migration or
real generation is part of this adoption. Browser/HTTP acceptance does not
certify packaged Electron: the current wrapper still launches a Bun workspace
backend and defaults to the development web URL; production resource/startup
packaging remains separate. App-scoped usage presentation and the legacy-provider
consolidation gate also remain separate product work.
