# AgenticDriver SDK integration

LitAgent can discover and execute provider instances exposed by an AgenticDriver
host, alongside its existing local CLI catalog. The integration stays in
`packages/agents`; workflows continue to consume normalized run events.

Install the exact registry SDK and app dependencies from the committed lockfile:

```bash
bun install --frozen-lockfile
```

Start an SDK host and configure the LitAgent backend:

```bash
export AGENTICDRIVER_URL=http://127.0.0.1:7433
export AGENTICDRIVER_TOKEN=YOUR_DRIVER_BEARER_TOKEN
bun run dev:server
```

Use HTTPS beyond loopback. The backend fetches the token-scoped catalog at startup.
Instances appear as `driver.<instance>`, e.g. `driver.mock`, and are disabled until
enabled in the existing provider settings. Choose an explicit model, such as
`demo` for the mock host. Restart the backend to refresh the remote inventory.
When neither variable is set, the existing provider setup is used.

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

The token belongs in backend environment/secret storage. Provider keys and CLI
sessions stay on the driver host. Multi-user deployments must choose scoped
execution credentials for their tenancy model; the development integration uses
one operator-configured host token.

Run `bun run typecheck` and `bun run test`. New tests cover real host execution,
artifact creation, cancellation, truncated results, and explicit enablement.

## Scoped Package Migration

The active application now pins the published MIT-licensed
`@agenticdriver/sdk` exactly to `0.1.0`; `bun.lock` records registry integrity.
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
