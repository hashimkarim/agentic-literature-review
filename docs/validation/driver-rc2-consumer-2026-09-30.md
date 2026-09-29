# AgenticDriver RC.2 consumer acceptance

## Package and scope

LitAgent pins registry `@agenticdriver/sdk@0.2.0-rc.2` in the server, web and
agents manifests and `bun.lock`. SDK source is
`91dc52292c627a6febed102a8198c56f35d3afc9`.

- npm SHA-256: `1e4bc9e639612ecc1d97913fd915d72deb9bbe72c5034aa1e8928a4e06cf9f9a`
- Lock integrity: `sha512-LzXVqr2umXDChhJi2pb1doPSjD/YlpG3qsgTkM5M3PBtE/KLiABwFrdqpXdCzpCiQ3u2cBuxDY7QtagL3ppHgw==`
- SDK CI: https://github.com/agenticdriver/agenticdriver/actions/runs/36640743553

No sibling imports, private archive dependency, application auth change, new
telemetry emitter, model fallback or shared-service restart was introduced.
The GitHub SDK release page was not yet confirmed public at acceptance time.

## One real application request

The existing `scripts/check-driver-live.ts` now has an explicit
`--metered-workflow` mode, mutually exclusive with its wider `--generate` mode.
It uses the real app HTTP routes and a disposable repository, not a simulated
provider. Set `LITAGENT_LIVE_PROFILE`, `LITAGENT_LIVE_PROVIDER`,
`LITAGENT_LIVE_MODEL`, `LITAGENT_LIVE_USAGE_URL`,
`LITAGENT_LIVE_USAGE_TOKEN_FILE`, and `LITAGENT_LIVE_USAGE_IDENTITY` explicitly.
The identity is a JSON object containing hostId/provider/accountId/subject.
No private credentials are stored in this receipt.

Execution used the separate SSH-forwarded validation host at
`http://127.0.0.1:17442/`, not the regular library connection:

- hostId: `prometheus-rc2`
- provider: `prometheus-codex`
- accountId: `prometheus-codex-account`
- subject: `rc2-literature`
- model: `gpt-6-luna`, host-configured medium reasoning, Codex 0.157.0
- app workflow: `run_9a03fd80bc34420b`
- SDK run: `6f79f282-5a27-48bb-82fa-82176d55fc12`
- completed: `2026-09-29T23:04:13.456Z` (September 30 locally)

One key-findings request used the existing public abstract reading notes for
Liu et al., *Lost in the Middle* (arXiv 2307.03172v3). This was **not** another
full-PDF retrieval evaluation. The result correctly retained "often" when
describing better performance near context edges and the substantial drop in
the middle. Its explicit qualification avoided claiming every model fails on
every example. The app linked it to `paper_f1730c5ece755d4e_passage_0003`.
The proposal `proposal_0b9734f8ad694c62` remains pending with no accepted items.
The source Markdown remained unchanged. Model confidence is not independent
evidence-support certification.

## Automatic durable usage

Before any manual submission, `UsageStatClient.run(identity, runId)` read the
automatically captured record from stable Usagestat at port 17443:

- schema: `agenticdriver.usage.v2`; status: `completed`; source: `cli-report`
- delivery: `local`; forwarding attempts: 0; deliveryError: null
- input: 6,634; output: 156; cached input: 0; reasoning: 0 (all reported)
- duration: 6,483 ms; started/completed steps: 1/1
- expiry: `2026-10-29T23:04:13.456Z`

Identity and usage exactly matched the normalized app completion event. No
cost was reported; none was inferred. No capture call, reconciliation replay or
second inference was made. Read-only polling is permitted only for
`USAGESTAT_NOT_FOUND`, to accommodate asynchronous ingestion.

Private detailed receipt:
`/home/hashim/Applications/T3CodeNightly/tmp/litagent-alpha6-live-kBc8QG/receipt.json`.
The historical directory prefix does not describe the installed package version;
the receipt records RC.2 from the actual installed manifest.

## Application checks

- Empty onboarding and real read-only provider panel passed.
- Disabled execution was rejected before generation.
- Explicit model selection survived catalog refresh and backend restart.
- The completed workflow/events survived restart byte-equivalently as decoded
  JSON. No generation was replayed and no proposal was automatically accepted.
- Native T3 browser inspected the pending finding, then Settings, page reload
  and the shared panel's Refresh action. Codex/Luna stayed enabled; Claude stayed
  disabled with no selected model. Nine/fourteen reported models were visible,
  account identity stayed masked and management remained read-only.
- Browser screenshot:
  `/home/hashim/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-munabs5a-0ee9ca31.png`.
- A separate SDK-client metadata-only read of the normal 7433 connection returned
  nine Codex/fourteen Claude entries with omitted model allowlists. Both health
  results remained `unknown/CLI_CATALOG_AVAILABLE`, not live qualification.
  Hash comparison confirmed the normal connection/settings files unchanged;
  `driver.local-codex` remained disabled. This was not another mounted regular
  library workflow or inference request.
- `bun install --frozen-lockfile`, `bun run typecheck`, `bun run test` (347 passed,
  2 skipped), and `bun run build` passed locally. Build retains the existing
  large-chunk warning. App CI uses only its Prometheus runner; the run URL and
  immutable app commit are supplied in the accompanying handback.

## Boundaries

RC.1 full-paper Q&A/writing, candidate acceptance, cancellation/recovery and
security receipts remain historical evidence, not checks rerun for RC.2.
The known TeX-percent editorial issue and support-review limitations in
`driver-rc-consumer-2026-09-29.md` are not resolved by this dependency update.
The new validation grant expires September 30 at 22:56:18.535Z; it is not a
production connection. Shared workers, user libraries/manuscripts, normal
credentials/grants, and application authentication were preserved.
