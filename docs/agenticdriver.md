# AgenticDriver SDK integration

LitAgent uses the installed AgenticDriver package for provider execution and
scoped discovery. The integration stays in `packages/agents`; workflows consume
the existing normalized events and retain ownership of sources, citation checks,
conversation revisions and acceptance of proposed artifacts.

`bun install` installs the reviewed SDK archive from `vendor/`. Its source commit,
license and checksum are recorded in [vendor/README.md](../vendor/README.md).
There is no sibling SDK checkout dependency and no registry release is implied.

Configure the connection on the **LitAgent server**:

```sh
export AGENTICDRIVER_URL=http://127.0.0.1:7433
export AGENTICDRIVER_TOKEN=YOUR_DRIVER_BEARER_TOKEN
bun run dev:server
```

Use HTTPS beyond loopback. Certificates and hostnames are verified; redirects
are rejected. For a private CA, configure Node's `NODE_EXTRA_CA_CERTS` before
starting the server. Provider API keys and official CLI sessions remain on the
execution host. The browser receives neither the driver token nor provider keys.
This local application uses one operator-configured host/token; changing those
environment values requires restarting the application server. Multi-user
hosting still requires an application authentication and tenant-binding layer.

In **Settings → Providers**, the connection panel shows the configured host,
connection failures and **Refresh driver catalog**. Refresh fetches protocol and
token-scoped inventory, including provider health and configured model limits,
without restarting LitAgent or generating text. A failed connection does not
prevent the rest of the application from starting. Correct the host/network or
credentials and refresh. Configuration errors give fixed instructions without
showing private upstream error bodies.

Instances retain their `driver.<instance>` IDs. Select an exact model and click
**Enable provider**. The model must be in the host allowlist when one is supplied;
otherwise enter an explicit model ID. **Save model**, **Disable** and refresh are
available on each instance. Refresh does not enable instances or pick models.
Settings persist in `.litagent/provider-settings.json`, without credentials.
Provider/account instances are distinguished by host-supplied names and exact
IDs. Account identity is shown as unlinked until a trusted account mapping exists;
Usagestat's catalog helper supplies the neutral icon/name fallback. No account is
inferred from a logo or a provider's reported usage.

A reachable driver is distinct from verified provider authentication. Unsupported
or inconclusive non-generation probes display **Authentication unverified**;
known authentication, availability and unsupported-CLI failures block new work.
Signing into a provider happens on its host using that provider's supported path.
The UI's enable action never initiates an OAuth flow or signs into a vendor.

Cached adapters check current enablement, availability and the model allowlist
when starting each session. Removed instances remain visible as unavailable, so
a selected account cannot silently switch to a CLI provider or heuristic. Refresh
and disablement preserve existing runs and their interrupt/stop handles; they
apply to new work. A model removed by refresh remains selected and fails clearly
until the user selects a permitted replacement.

The adapter implements start/interrupt/stop, normalized events, typed failure
classes, usage on completion and local cache artifacts. `AgentHarness` keeps its
best-effort NDJSON logging. Results are saved only under
`.litagent/cache/provider-runs/`, then pass through the existing proposal/review
workflow. Failed, truncated and incomplete output is never a completed artifact.
The SDK adds no default run deadline or inactivity timeout. An explicit host
inactivity policy uses actual model/tool/context progress, not heartbeat traffic.
Discovery has separate bounded I/O; interrupt/stop close the active remote request.

Remote execution sees the context supplied by LitAgent. It cannot browse local
library files. Cited Q&A already sends scoped source passages; workflows requiring
arbitrary CLI filesystem access need portable context/tools before using this
adapter. The application's existing source hashes, citation validation and
conversation revision checks remain authoritative.

Validation:

```sh
bun run typecheck
bun run test
bun run test:driver-ui
```

The browser check launches isolated application/SDK hosts and a disposable research
repository. It verifies scoped catalog refresh, explicit model selection,
connection failure/recovery, persisted enable/disable settings and secret-free
responses with **zero generation calls**. Screenshots are left in its temporary
directory. A separate mock-provider workflow test runs drafting and source review
through the installed SDK, validates cited source revisions, stores the chat and
checks reported usage without changing source Markdown. Fixtures are not live
provider certification; AD-035's live account/model acceptance check remains open.
