# AgenticDriver Alpha.5 Adoption

## Package

- Exact registry pin: `@agenticdriver/sdk@0.2.0-alpha.5` in server, web and agents.
- SDK source: `2d4d7c22c74e0a1dbd355398ee39f589ed4fbb76`.
- Downloaded archive SHA-256: `f8fbe71aaeb515aed1f082e8c463fbb23bd62ac6fca23133415bb1962902d9dd`.
- Independently computed SHA-512 and Bun lock integrity: `sha512-Sgjuhmcg1RlTOOueBZtVBL5IvVUvWL0UNVDxsVSsr5zF5DojcW/tjuHX1rSn20nLOtgDFjBDNVifokxk7Q5vlA==`.
- Provider-icons unchanged. No sibling/private archive dependency.

## Local Checks

`bun install --frozen-lockfile`, `bun run typecheck`, `bun run test` and
`bun run build` passed. Tests: 300 passed, two skipped across 42 files.
Existing large-bundle warning remains. Installed-package regression asserts
alpha.5 and that client/panel/ui/connections resolve from the same package.
Adapter tests assert denied models never call `client.stream`; panel tests cover
read-only permissions, revision checks, secret redaction and older-host fallback.

## Mounted Browser Acceptance

Native T3 tab `tab_y`, actual app at `http://127.0.0.1:5220`, backend 3904,
disposable repository `litagent-review-ui-urigwx`. Existing metadata fixture
script ran on 17549 with persisted state `litagent-driver-panel-ui-7IIqMF`.
No real provider/account or manuscript was used.

- Initial library screen and Settings onboarding loaded.
- One-use invitation connected through the mounted shared panel/backend bridge.
  The invitation was populated with a native T3 DOM input event, then Connect
  was clicked; keyboard invitation entry was not separately tested.
- Selected `shared/fast`, clicked Use in LitAgent, enabled it, refreshed and
  reloaded. Connection, model and enablement persisted; other providers stayed off.
- `legacy` omitted account metadata: version/subscription/account remained
  not reported, sign-in not confirmed. No account identity was invented.
- `denied` retained catalog inventory but an empty execution allowlist and
  disabled LitAgent enablement. Actual `/api/qa` request returned HTTP 400
  `PROVIDER_UNAVAILABLE`, before streaming.
- Stopped only the fixture process; refresh returned the expected 502 and
  displayed Driver unavailable/Retry connection. Stale provider/account and
  app enablement controls were hidden, while saved `driver.shared/fast` remained.
- Restarted that fixture with the same directory/port. Explicit Retry restored
  connection and the enabled `fast` choice, without enabling other providers.
- Fixture counters: six inspections/zero completions before restart, three
  inspections/zero completions after recovery and the denied request.
- Desktop screenshot reviewed at measured 1920x1080:
  `/home/hashim/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mulbttq7-b3870062.png`.
  An earlier immediate screenshot was stale/blank; the subsequent capture
  rendered Settings correctly. No narrow-layout acceptance is claimed here.

Shared regular/synthetic hosts, credentials, auth, grants and real saved app
choices were untouched. This is migration acceptance, not live-model or desktop
SSH-route qualification. Prometheus results are recorded in the adoption handoff.
