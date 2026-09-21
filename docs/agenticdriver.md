# AgenticDriver SDK integration

LitAgent can discover and execute provider instances exposed by an AgenticDriver
host, alongside its existing local CLI catalog. The integration stays in
`packages/agents`; workflows continue to consume normalized run events.

Build the sibling SDK first, then install dependencies:

```bash
cd ../agenticdriver
npm install
npm run build
cd ../agentic-literature-review
bun install
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

## Scoped Package Migration Preparation

Status: prepared only; dependencies and imports are unchanged. The SDK handoff
identifies organization migration commit
`442ca9c627717f0cdb42ad8260a9692357c79a87` in the public source repository
`https://github.com/agenticdriver/agenticdriver`. npm `@agenticdriver/sdk` 0.1.0
is not published in this handoff. Wait for verified registry version, integrity
and release commit; a development archive is not a registry release.

Two application baselines must be reconciled deliberately:

- Active branch: `packages/agents/package.json` depends on
  `agenticdriver` via `file:../../../agenticdriver`; `bun.lock` retains that
  sibling dependency. Do not refresh the install against a moving checkout as
  a substitute for qualifying the released artifact.
- Unmerged AD-035 branch `agenticdriver-connection-setup`, commit `4f4be92`:
  the same dependency points to
  `vendor/agenticdriver-0.1.0-sdk.dbe847c.tgz`. Preserve that branch and its
  provenance; integration/publication requires separate coordination.

Once the release is verified, use this sequence in a scoped task branch:

1. Coordinate the AD-035 integration baseline. Inspect the exact release's
   `docs/migrations.md`, `docs/quickstart.md` and compatibility matrix. Record
   source commit, registry integrity, package version and license; confirm
   required wire protocol/features instead of assuming them from the rename.
2. Replace the external dependency with the exact verified
   `@agenticdriver/sdk` version and regenerate `bun.lock` with Bun. Change imports
   in `packages/agents/src/agenticdriver.ts` and `agenticdriver.test.ts` from
   `agenticdriver`, `/client`, `/providers` and `/server` to their
   `@agenticdriver/sdk` equivalents. Audit the integrated AD-035 tests/scripts
   for additional imports before changing them.
3. Preserve the internal `@litagent/agents/agenticdriver` export, local filenames,
   CLI command `agenticdriver`, environment variable names, `driver.<instance>`
   IDs, explicit enablement, model selection and host/account/subject bindings.
   This is not an auth, retrieval or durable-job migration. Future auth imports
   use `@agenticdriver/sdk/better-auth` and `/pairing`, subject to the separate
   [authentication plan](AUTH_PLAN.md).
4. Install from the frozen lockfile in a disposable application checkout with
   no sibling SDK dependency or path aliases. Verify typecheck, tests and build
   against the actual installed artifact. Existing adapter fixtures must cover
   event/usage normalization, draft artifact capture, cancellation, truncated
   output, persisted settings and disabled cached adapters without generation
   from a real provider.
5. After AD-035 integration, also run its actual HTTP connection-settings and
   installed workflow fixtures: refresh/failure/recovery, offline disablement,
   secret isolation, reload persistence, source-review evidence/proposals and
   canonical Markdown unchanged. Run `test:chat-ui` at both desktop sizes and
   verify source scope, quote/revision guards and annotation behavior. Do not
   claim those unmerged checks ran on the active branch.

Keep Better Auth plus AuthYard on the explicitly qualified connector contract;
the SDK package rename does not qualify a renamed AuthYard connector. Separate
fixture/install evidence from live-provider acceptance: native Antigravity
tool isolation remains blocked, with no new real-account inference certified.
