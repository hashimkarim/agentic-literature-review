# AgenticDriver Alpha.3 Adoption

Application branch: `chat-reliability`. This is client/package adoption with
disposable fixtures, not new live-provider qualification or a host upgrade.
Existing app authentication, credentials, regular/synthetic shared services,
Usagestat bindings, saved user choices and real research data were untouched.

## Exact Dependency

- Registry package: `@agenticdriver/sdk@0.2.0-alpha.3` in
  `apps/server/package.json`, `apps/web/package.json` and
  `packages/agents/package.json`.
- SDK source: `d46e2292d0759ea24fed2035945d1ed8297e4357`.
- Archive: <https://registry.npmjs.org/@agenticdriver/sdk/-/sdk-0.2.0-alpha.3.tgz>.
- Independently downloaded SHA-256:
  `5c0cd3fbc471cf0dcf1bfe1798e4c1285ef8ec1e9dc44e419b751109e9f55460`.
- Downloaded SHA-512 and `bun.lock` integrity:
  `sha512-cPpNVFixhrHQxVLvAU4fl4+pZUdtjQRq/+2u3jwOCRyRNGVs9KzSK5AbMGd5f4Wm35LMVJdPxPNKtInZ3KlTsw==`.
- The SDK's `@agenticdriver/provider-icons` dependency is the public
  `v0.1.0-alpha.1` GitHub release archive, separately integrity-locked by Bun.
  Attribution is bundled upstream. No checkout link/private archive is used.
- Installed-package tests verify root/client/panel/ui/connections exports resolve
  from the same alpha.3 package.

## App Checks

Both the working checkout and fresh source copy `/tmp/litagent-alpha3-frozen-JLz8Kh`
passed:

- `bun run typecheck`.
- `bun run test --maxWorkers=1`: 290 passed, two existing opt-in compiler skips,
  41 files.
- `bun run build`: passed with the existing large Vite chunk warning.

The fresh copy first passed `bun install --frozen-lockfile` (524 packages).
Initial two-worker workstation checks exposed remote-adapter fixtures probing
installed native CLIs; those fixtures now stub only inherited legacy discovery.
A subsequent busy-workstation run hit two legacy fake-CLI Q&A startup failures;
the complete serial suites above passed. No production timeout was relaxed and
no production provider code was replaced. Prometheus's normal two-worker run is
reported separately below.

New bridge coverage checks optional account metadata, older-host omission,
`no-store`, absence of email/name in persisted connection/settings/catalog
records, unchanged deny-all permissions and zero generation calls.

## Mounted Native T3 Browser

The actual app Settings screen and same-origin backend bridge ran against
`/home/hashim/Applications/T3CodeNightly/tmp/litagent-review-ui-MxSeAa/research`,
on web/API ports 5197/3957. `scripts/dev-driver-panel-fixture.ts --account-details`
provided synthetic SDK hosts on 17541/17542, with no native provider execution.

Observed in the native T3 browser:

1. Pair the management-enabled fixture through the mounted shared component.
   Runtime/version, sign-in method and subscription are shown as reported data;
   email/name start masked, without raw identity in shadow markup.
2. Keyboard Enter on Reveal/Hide exposes/remasks synthetic identity. Refresh,
   provider changes, reload and Disconnect remask it. Email/name never enter
   localStorage, including after disconnect.
3. Select monochrome and ChatGPT/OpenAI for the Codex instance, and full colour
   and Claude Code for the older fixture. Native arrow-key selection changes
   rendered SVG marks. Preferences remain separate per instance and survive reload.
4. Explicitly choose `fast`, use it in LitAgent and enable the shared instance.
   Refresh, full reload and switching driver connections preserve that scoped
   selection/enablement. Presentation choices do not alter model selection.
5. An older-host fixture omits account metadata: version/sign-in/subscription and
   identity stay unreported; no Reveal button or invented account appears.
6. A deny-all instance reports catalog entries but cannot choose either model;
   LitAgent's enable checkbox is disabled. A second, read-only/no-provider-grant
   connection offers Refresh/Disconnect and access guidance, with no management
   actions or executable providers. Switching back preserves the first device.
7. Disconnect the disposable management connection after Reveal. The panel returns
   to onboarding and no raw identity remains in markup or browser storage.

Final fixture counters: management host 27 inspections / **0 completions**;
no-grant host 0 inspections / **0 completions**. No new SDK generation run IDs.

Screenshots inspected:

- Masked account and persisted icon settings:
  `/home/hashim/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-muju5oys-9ecfbc6e.png`.
- Read-only/no-provider-grant state:
  `/home/hashim/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-muju0uzd-e6756730.png`.

T3 measured the desktop viewport as 2103x1183. Its narrower resize timed out, so
this receipt does not claim a new narrow-screen pass. Native shadow-input typing
also failed; invitation entry used the same T3 browser's DOM input/change events.
Click, keyboard and screenshot checks otherwise used native preview tools; no
alternate browser automation was substituted.

## Boundaries

The existing shared provider component and app panel bridge handle the new
metadata without a parallel account view or provider-management protocol.
Browser/HTTP acceptance does not certify packaged Electron transport, usage UI,
or the legacy-provider consolidation gate. Updating the client does not upgrade
older hosts or add optional metadata they do not report. No regular or synthetic
shared host was restarted, no grant/billing route expanded, and no real manuscript
or library payload was sent.

## Application CI

- Application adoption commit: `6cd6ec4dcb71a2455394b7a63aded787496becb7`.
- [Run 36321592089](https://github.com/hashimkarim/agentic-literature-review/actions/runs/36321592089):
  passed for that exact source, job `108626357356`, repository runner 2,
  `prometheus-literature-01` (`self-hosted`, `linux`, `x64`, `prometheus-ci`).
- Frozen install, typecheck, normal `bun run test --maxWorkers=2` and build all
  passed. CI independently reports 290 passed / two skipped across 41 files.
- Existing warnings remain: SQLite experimental status, the large Vite chunk,
  and checkout's Node 20 action being run on Node 24. No failure was suppressed.

SDK CI is not treated as app acceptance. No hosted-compute workflow is enabled.
Only the four disposable acceptance process groups were stopped after browser
checks; shared and regular services were left running.
