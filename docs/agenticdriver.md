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
