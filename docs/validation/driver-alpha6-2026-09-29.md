# AgenticDriver alpha.6 application acceptance

## Dependency and scope

All three owning manifests pin the npm version `0.2.0-alpha.6`.
The downloaded archive SHA-256 was independently matched to
`b06c67eb847c7806db056351eaea338de5977fcf823212aac0dc27a03395df36`.
`bun.lock` records integrity
`sha512-eWUXwdnCNaLFHbbEkQezLRZvsjKnvlU4C7gnwJkd9ljsrqzKrp9Hh1ktxM6TJjDa2+/9n77Vx6hjKHVyAhLuMA==`.
SDK source: `5ac1e6fdf24dc226177d7167bd1611a2c6c0ae44`.

No shared host was upgraded or restarted. Existing application authentication,
regular credentials, saved choices and grants were not changed. Management
metadata is validated before writes: protocol 1.0 alone does not establish
alpha.6 compatibility. No older management host was exercised live.

## Real application requests

`bun run test:driver-live --generate --keep-open` ran the actual HTTP backend
against the authorized alpha.6 remote connection, with explicit
`prometheus-claude` / `claude-haiku-4-5-20251001`. The profile, provider and model
were supplied through `LITAGENT_LIVE_PROFILE`, `LITAGENT_LIVE_PROVIDER` and
`LITAGENT_LIVE_MODEL`. There was no fallback or automatic model retry.

The disposable repository contained paraphrased public abstract notes from
<https://arxiv.org/abs/2307.03172v3>, not a private library or full-paper extraction.
Q&A answered the positional-context question with source-linked evidence and
preserved the qualification "often". The writing candidate completed with a
passing factual-support review and remained unaccepted. Canonical Markdown and
manuscript contents were checked unchanged.

Exactly four SDK requests completed:

| Operation | SDK run ID |
| --- | --- |
| Q&A draft | `9591dfa1-4e78-4491-8785-063cfd4f033b` |
| Q&A support review | `ec272925-d9b5-4e4c-9ea4-70598ad16c4b` |
| Writing draft | `413cd6d0-117c-47fe-9fb1-2ad00380eb79` |
| Writing support review | `c72d3563-3d3a-458b-a2c6-37ea91cbcacf` |

App Q&A run: `run_e61833399a704407`. Writing candidate:
`candidate_820b57ac200c4cc6`. Native usage was retained in the app event logs;
API-equivalent cost is not a subscription charge. This remote validation host
does not establish automatic Usagestat ingestion. Q&A retained SDK supplied
source manifests; writing still supplies its context through the app prompt.

The private local receipt is under
`/home/hashim/Applications/T3CodeNightly/tmp/litagent-alpha6-live-tiagbv/receipt.json`;
the corresponding disposable repository contains the normalized event logs.
No credentials are included in this document or browser settings.

## Native T3 browser checks

The mounted app was exercised at 1920x1080 and 390x844:

- First screen and Settings loaded without seeded papers/providers.
- Read-only real provider panel reported nine Codex and fourteen Claude models,
  masked account identity, and did not expose management actions.
- Refresh and reload preserved explicitly enabled Claude/Haiku and disabled Codex.
- Empty connection onboarding contained no mock provider definition.
- The writing file and completed, unaccepted candidate were visible on desktop
  and narrow layouts; the narrow page had no horizontal viewport overflow.
- A temporary byte-forwarding TCP relay to the real host was stopped after the
  panel loaded. Refresh hid stale provider/account controls and showed recovery.
  Restarting only that relay and explicitly retrying restored the real panel;
  saved Haiku selection and disabled Codex were unchanged. No model call was
  sent for this check. The disposable relay connection was removed afterward.
- Disabled application execution was rejected before enabling the selected model.

## Local checks and limits

Frozen install, typecheck, build and tests passed: 320 passed, two skipped across
42 files. Build retains the existing large-chunk warning. The SDK-mock dependent
generation tests and simulated provider acceptance scripts were removed, not
reimplemented as another fake provider. Independent schema, policy, persistence
and evidence tests remain. Offline SDK management tests use an explicitly
uninstalled real adapter and do not certify native execution.

This receipt does not qualify all catalog models, full-paper retrieval, tool
execution, management-granted live edits, cancellation, candidate acceptance or
production deployment. No user's real manuscript was accepted or changed.
