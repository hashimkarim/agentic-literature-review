# Shared Provider Panel And Multiple Connections

Application branch: `chat-reliability`. No main publication, auth migration,
provider runtime replacement, real manuscript edits or model generation in this
acceptance. The regular and synthetic shared SDK services were not restarted.

## Immutable Inputs

- Settings candidate source: `3217b8d426e96aa5beb6c87dcf0fc76d7628ebbd`.
- Original archive SHA-256:
  `65b68ebdca8d497e4e175473b55344d2640c136626b3614ffb4540284e9adb3a`.
- `@litagent/driver-panel-sdk` is a metadata-only repack. Tests compare every
  runtime, type, documentation and license file with the supplied archive.
  The package name/version and CLI registration are the only changes.
- Provider execution remains exact registry `@agenticdriver/sdk@0.1.0`.
- App backend: `5fc82a3`, package isolation: `3083ded`, multi-host routing:
  `061587f`, ambiguous-target protection: `ac7da6c`, shared UI:
  `9f61849ef7bb30663617e801eb026d28656bec2d`.

## Automated Checks

`bun run typecheck`, `bun run test --maxWorkers=2`, and `bun run build` pass.
263 tests pass; two opt-in compiler tests are skipped. The build retains the
existing large-chunk warning. Panel/connection fixtures stub only legacy native
CLI discovery; the SDK HTTP services, pairing, persistence and management are real
fixture implementations. No provider account is needed for those tests.

Coverage includes singleton migration, stable host namespaces, credentials kept
private, two app servers paired independently to one driver, one app connected
to two drivers with the same provider ID, host-owned revisioned changes,
separate execution/management grants, rejected stale edits, revocation, restart,
offline routing, unchanged defaults and retained active-run cancellation.
An old singleton mutation without an explicit target is rejected once more than
one connection exists. Removing a device never reroutes its saved selection.

Prometheus evidence:

- [Backend run 36196620513](https://github.com/hashimkarim/agentic-literature-review/actions/runs/36196620513):
  `061587f4e7acc74c8bf193f8ebc0475259b7ade1`, passed.
- [Target-safety run 36230542379](https://github.com/hashimkarim/agentic-literature-review/actions/runs/36230542379):
  `ac7da6cb59dd0adca03e76814c6ea37358016805`, job `108372748516`, passed on
  repository runner 2, `prometheus-literature-01`.
- [Shared UI run 36230888207](https://github.com/hashimkarim/agentic-literature-review/actions/runs/36230888207):
  `9f61849ef7bb30663617e801eb026d28656bec2d`, job `108373703414`, passed on
  the same repository-scoped Prometheus runner.

These are Linux checks, not macOS/Windows packaging or a registry release.

## Native T3 Browser

Disposable research repository:
`/home/hashim/Applications/T3CodeNightly/tmp/litagent-review-ui-2N8x4G/research`.
Web/API used loopback ports 5191/3894, separate from the user's library.
`scripts/dev-driver-panel-fixture.ts` supplied two mock devices with independent
pairing grants; it can reopen its private fixture directory for restart tests.

Observed through native preview interactions:

1. Pair both devices; rename them Desktop driver/desktop-fixture and
   Lab driver/lab-fixture. Switching devices changes the shared panel.
2. Edit a provider display name using the management-enabled fixture. The driver
   config changed, not a duplicate app provider configuration. Execution-only
   connections show settings read-only.
3. Explicitly enable both fixture providers, choose `fast` on Desktop and `demo`
   on Lab. Refresh and reload preserve these independent defaults. Selecting Lab
   and applying `demo` also survives a full page reload as the exact scoped ID.
4. Stop only the Lab fixture. Refresh marks Lab unavailable while Desktop and
   the regular host stay connected. No provider/model substitution occurs.
   Restart Lab and use Retry; the same connection recovers with its default.
5. Dark/light/Comfy changes retain the shared component. At 390px, document width
   is 390px and connection content fits its 276px box; desktop interaction checks
   also ran at 1440px/1920px. The panel remains mounted across offline/retry.
6. Disconnect Lab locally; Desktop remains enabled with `fast`, and both regular
   providers remain disabled. The removed Lab selection remains unavailable
   rather than switching to Desktop. Cleanup then removes Desktop from the
   disposable app and stops only the mock fixture processes.

Earlier desktop screenshot was inspected at
`/home/hashim/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-muhj9ou9-6ba7d248.png`.
After the T3 session restarted, screenshot capture and keyboard press calls
returned preview-client execution errors despite working navigation/click/type/
evaluate. Final responsive checks used DOM geometry and actual interactions;
new final screenshots and a complete keyboard pass are not claimed.

## Regular Host Metadata Only

Settings connected to `http://127.0.0.1:7433` through the supplied private local
credential-file path. Credential contents never entered browser settings or
this receipt. SDK source `23e79543143c9f856978ee4923525942802014ca` is the operator's
activation receipt; the app did not replace the runtime.

After refresh and app restart, `local-codex` reported 9 catalog models and
`local-claude` reported 14. Both host `models` properties were omitted, mapped to
`restrictedModels=false` in LitAgent. Both were still app-disabled, with no
default model. Desktop/Lab fixture defaults and the selected scoped model were
unchanged. The component displayed advisory `unknown` health, not live entitlement.
Management is unavailable through this ordinary app credential. No inference or
real library context was sent; there are no new LitAgent SDK run IDs to reconcile.

## Remaining SDK Contracts

- The app's editable device name is a display label. The reviewed SDK connection
  metadata does not independently attest a remote device name.
- Existing paired provider grants are explicit lists, not auto-expanding
  all-provider grants. App defaults cannot grant additional host permissions.
- Automatic driver-local Usagestat setup and a safe usage-read port remain SDK
  work. LitAgent must not read Usagestat administrative endpoints or create a
  second usage database.

These requirements were coordinated on SDK issues #43 and #46; no sibling SDK
files were modified. Legacy direct adapters stay behind the documented removal
gate rather than being deleted based on catalog visibility alone.
