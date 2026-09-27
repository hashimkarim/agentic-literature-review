# AgenticDriver Alpha.4 Adoption

Branch: `chat-reliability`. Date: 2026-09-27. Client adoption, not a host upgrade
or new model qualification. Existing app authentication and all regular/synthetic
shared services, credentials, grants and research data were preserved.

## Immutable Dependency

- Package/import: `@agenticdriver/sdk`, internal version `0.2.0-alpha.4`.
- SDK source: `a8d296e2944dbda7de326c525870c7769d28c4b9`.
- Public archive: <https://github.com/agenticdriver/agenticdriver/releases/download/v0.2.0-alpha.4/agenticdriver-sdk-0.2.0-alpha.4.tgz>.
- Independently downloaded SHA-256:
  `3d5ee438194b28f4ab4c128f0aa7076ac31dba5598d44e92638b6906296cc2e1`.
- Independently computed and lockfile SHA-512:
  `sha512-TR3rntOQ8uPtFUU+LkRPIy6WjcNryQGKca9YZ5mGj2/q5YDGM3/dx+Vr8OsclBixEsSCeX+QfPO5FVt498n0Aw==`.
- Exact public URL in `apps/server/package.json`, `apps/web/package.json`,
  `packages/agents/package.json` and `bun.lock`. No private/source-checkout pin.
- Provider-icons remains `v0.1.0-alpha.1` with its unchanged integrity.
- Installed-package regression checks root/client/panel/ui/connections resolution
  from this alpha.4 package. npm publication is not asserted.

## Mounted App Acceptance

Native T3 browser against the actual Settings UI and HTTP backend, ports 5218/3903,
using disposable repository
`/home/hashim/Applications/T3CodeNightly/tmp/litagent-review-ui-L5diME/research`.

No mock provider was used for these browser checks. A temporary loopback relay on
17548 forwarded only GET `/v1/protocol` and `/v1/providers` to the unchanged regular
7433 host. Every other method/path was denied. The backend loaded the existing
private regular credential file; no token value entered browser settings/logs.
The relay could return an outage without stopping the shared host. No model call,
sign-in, management operation, grant change or billing fallback was performed.

Observed:

1. No connection shows SDK onboarding and no app execution controls. Enter in
   LitAgent's token-file form saved the connection through the real backend.
2. Real catalogs reported nine Codex and fourteen Claude entries. Management
   remained read-only. Older-host account details stayed unreported, not invented.
3. Explicitly selected `claude-haiku-4-5-20251001` and enabled Claude locally;
   Codex stayed disabled. Refresh and full reload preserved connection identity,
   default model, app enablement and browser selection.
4. An actual failed discovery response put the shared panel into recovery, with
   no provider/account/model controls. This exposed an app-owned stale pending
   selection and enablement section. The fix now hides both during failure and
   discards only the pending action, not saved provider/model choices.
5. Explicit Retry after restoring the relay recovered the same connection and
   selected Claude instance, its Models tab, saved Haiku default and enablement.
   No pending action was automatically applied and no model was run.
6. A disabled Codex Q&A request returned 400 `PROVIDER_UNAVAILABLE`; an offline
   Claude request returned the existing 500 connection error. Neither reached a
   model endpoint or began streaming. Existing offline regressions separately
   cover deny-all execution and management grants; no live grant was broadened.
7. Disconnect removed only the disposable app connection and returned to
   onboarding. Shared host/provider setup and the original credential remained
   untouched. The temporary relay was stopped after checks.

Relay totals: 19 metadata requests forwarded, 12 intentional unavailable responses,
zero non-metadata requests received. No new SDK generation run IDs exist.

Screenshots inspected:
- Recovery: `/home/hashim/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-muk9zto1-d03d5c7d.png`.
- Recovered Claude selection: `/home/hashim/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-muka0pog-56469c84.png`.

T3 measured 2103x1183. Both freeform 390x844 and phone-preset resize attempts timed
out without changing the viewport. No narrow-screen pass is claimed, and no
alternative browser automation was substituted.

## Verification

- `bun install --frozen-lockfile` passed in the working checkout and a fresh
  tracked-source copy at `/tmp/litagent-alpha4-frozen-OIusjY` (524 packages).
- `bun run typecheck`: passed, including the fresh copy with the app recovery fix.
- `bun run test -- --maxWorkers=2`: 300 passed, two existing compiler skips,
  42 files, both checkout and fresh copy. Existing offline regression tests do
  not count as live-provider qualification.
- `bun run build`: passed in the checkout and fresh copy. The existing large Vite
  chunk warning remains. App-owned Prometheus evidence is recorded separately.

These checks exercise browser/HTTP integration, not packaged Electron transport,
remote SSH setup, device sign-in or new live model capabilities. The SDK's
`connected:false` recovery contract requires no backend protocol migration.

## Application CI And Registry Follow-Up

The original independent adoption commit is
`65edf8f026b5e9b232b914ad76224bdbab741e93` on `chat-reliability`.
[Application run 36348690606](https://github.com/hashimkarim/agentic-literature-review/actions/runs/36348690606)
passed frozen installation, typecheck, tests and build on
`prometheus-literature-01`, runner 2, job `108702970786`.

On 2026-09-28 the three manifests moved from the GitHub URL to exact npm version
`0.2.0-alpha.4`. The independently downloaded registry archive at
<https://registry.npmjs.org/@agenticdriver/sdk/-/sdk-0.2.0-alpha.4.tgz>
matches both hashes above; the lock retains that integrity. Earlier archive-pin
and npm-unavailable statements describe the original acceptance date.
The Settings save/reload, catalog, denied-execution and offline recovery checks
above remain the application acceptance for these identical bytes; they were not
replayed or represented as new browser checks. No shared service, credential,
grant or saved user selection was changed, and no model call was made.
