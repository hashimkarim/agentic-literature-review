# Driver-Only Execution Acceptance

Date: 2026-09-27. Branch: `chat-reliability`.

The user requested full removal of legacy CLI execution and regular-account
acceptance with modest requests. No new mock provider was used for this acceptance.
Existing offline regression tests remain separate from live evidence.

## Changes

- `8e04f4e`: removed native CLI adapters, discovery/login commands, command-path
  settings and duplicate provider UI. SDK execution, normalized events and
  cancellation remain in `packages/agents`.
- `dfa8e6b`: removed heuristic AI workflow execution and vendor-output parsing.
  PDF conversion and bibliography export do not require an AI provider.
- `cdbb9a7`: fixed failures found by real writing acceptance: literal claim-anchor
  instructions, one bounded same-provider/model claim-format correction, a fixed
  validation error, and a fresh request ID after acknowledged generation. A lost
  transport response still reuses its ID to prevent duplicate generation.
- Missing/retired selections and disabled providers fail explicitly. History is
  not rewritten or silently mapped to an account. No legacy runtime fallback.

Dependency remains exact registry `@agenticdriver/sdk@0.2.0-alpha.3` in all three
owning manifests and `bun.lock`; this task did not change the SDK package or host.
No sibling checkout dependency, auth migration, service restart or expanded grant.

## Real Connection And Data

- Regular Driver: `http://127.0.0.1:7433`, subject `litagent-local`.
- Provider/model explicitly selected: `local-claude` / `claude-haiku-4-5-20251001`.
  No Codex requests, model/account fallback, application tools or external browsing.
- Native T3 browser app: `http://127.0.0.1:5217`, API port 3902.
- Disposable repository: `/home/hashim/Applications/T3CodeNightly/tmp/litagent-review-ui-TwIUKn/research`.
- Only a 536-character synthetic latency study and a disposable writing document
  were supplied. No real paper, codebase or manuscript was submitted or edited.
- Credentials were loaded by the backend from the private regular credential
  file. No credential value appears in this receipt or browser settings.

## Observed Results

1. Settings showed only Driver connections. Native browser selection, enablement,
   refresh, reload and application-backend restart preserved explicit Claude Haiku
   selection; Codex stayed disabled. A stored `codex/previous-model` selection
   remained visible as retired until explicitly replaced.
2. Q&A answered 40ms to 30ms (10ms/25%), unchanged 90% accuracy, and synthetic-only
   limitations. Evidence contained separate Results and Limitations passages.
   The answer used three sentences despite a two-sentence request; semantic
   support is separate from exact style compliance.
3. The first real writing draft failed strict validation because claim summaries
   paraphrased the draft. Its source was unchanged. After the fix, a new native
   browser request produced four validated claims, a passing model support review
   and app-generated TeX citation keys. This successful run did not need repair;
   automatic correction itself is not claimed as live-qualified by that run.
4. Generation left `sections/introduction.tex` at revision `1500b2f6...` until
   explicit bibliography insertion and acceptance in the disposable document.
   Acceptance produced revision `c6560ffc...` and history entry
   `version_fbc7e01ccf100f8e` with reason `candidate`; the original history remains.
5. Native browser Stop generation cancelled a further real writing request.
   Driver later reported `CANCELLED`; no text, review or acceptance followed.
   Cancelled usage was not reported and remains unknown, not zero.
6. Relevance produced pending proposal `proposal_b7289eac6bcf4274` with Results
   and Limitations evidence. The project link remained `unreviewed` with its
   original tags. Metadata returned only already-current fields; the app correctly
   created no redundant metadata proposal or canonical update. Refinement saved
   a review artifact recommending no edits, leaving Markdown unchanged.
7. Retired `codex` workflow and `local-heuristic` Q&A requests returned 409 before
   execution. Disabled Claude returned a specific 400 `PROVIDER_UNAVAILABLE` after
   fixing its former generic 500; it was re-enabled explicitly. Local BibTeX
   export completed as provider `local` even with an old saved CLI selection.
8. A temporary connection to an actually closed loopback port returned
   `DRIVER_UNREACHABLE`. Native Settings showed Unavailable with Retry/Disconnect,
   not a working provider or a fallback. It was removed afterward; the regular
   connection and saved choices were preserved. No shared service was stopped.

## Run Trace

Nine actual SDK requests, including the rejected first draft and one cancellation:

| App operation | SDK run ID | Outcome |
| --- | --- | --- |
| Q&A draft (`run_47468003761d412f`) | `084c7084-1860-4a7b-83fe-edd056082292` | Completed |
| Q&A support review | `714f8fd7-9f46-4255-85ee-69286c043d4a` | Supported |
| First writing draft (`candidate_58a4013131dac4cb`) | `c6902aac-cd59-406d-9bc1-4c85ac589350` | Provider completed; app rejected claim anchors |
| Writing draft (`candidate_c7a19051f09a0a4a`) | `346b580f-d88e-4494-b31f-20e56962ebb9` | Completed |
| Writing support review | `26a8e0cb-f5d7-426f-8a2b-bff8e9e43a76` | Supported; explicitly accepted in disposable document |
| Writing cancellation (`candidate_a46b219d278f53d6`) | `ca718d33-ea68-4b2d-a85d-581ec7fd703c` | Cancelled; usage unknown |
| Relevance (`run_10125e9559814553`) | `49049bfb-fa07-4c01-89dd-91e0a680c3a4` | Pending proposal |
| Metadata (`run_97f0eb14e1a348ed`) | `51142664-8f28-4f41-a68a-a9c4729c5f46` | No changed fields |
| Refinement (`run_91c3281569ef4991`) | `59f6591b-484c-4a7d-873c-da2414df17aa` | Proposal artifact only |

SDK IDs and reported usage persist in normalized app events. Eight completed
requests reported 36,050 input / 18,566 output tokens, with no reported cached
tokens. API-equivalent costs are not subscription charges. This app check did not
read Usagestat administrative records and makes no new backend-ingestion claim.

## Verification

- `bun run typecheck`: pass.
- `bun run test -- --maxWorkers=2`: 300 passed, 2 skipped, 42 files. The new
  validation regression is reduced from the actual rejected response, not a
  simulated successful provider. Existing offline tests remain offline tests.
- `bun run build`: pass; existing large-bundle warning remains.
- Native T3 browser: Settings, selected-source Q&A/evidence, writing context,
  progress, bibliography/acceptance/history, cancellation and offline recovery.
- Prometheus CI passed for `8e04f4e` ([36323477196](https://github.com/hashimkarim/agentic-literature-review/actions/runs/36323477196)),
  `dfa8e6b` ([36324325316](https://github.com/hashimkarim/agentic-literature-review/actions/runs/36324325316)),
  and `cdbb9a7` ([36324894083](https://github.com/hashimkarim/agentic-literature-review/actions/runs/36324894083)).
  Dedicated runner: `prometheus-literature-01` (repository runner 2).

Browser artifacts under `/home/hashim/.t3/userdata/browser-artifacts/`:
- `browser-screenshot-127-0-0-1-mujve6kp-9ffede7c.png`: retired selection.
- `browser-screenshot-127-0-0-1-mujviyhq-dcddc22d.png`: distinct Q&A evidence.
- `browser-screenshot-127-0-0-1-mujw5sys-df9dd972.png`: accepted writing and history.
- `browser-screenshot-127-0-0-1-mujwf8ic-3dce8027.png`: unreachable connection.

## Limits

This verifies this regular Claude route, not every advertised model or account.
Catalog availability, app enablement, host grants and live qualification remain
distinct. Tool-enabled execution stays unavailable on the shared text-only host.
No empty native tool catalog or general OS sandbox is claimed. The native desktop
IPC boundary was not requalified here; these live checks exercised the actual
browser/HTTP application. Local PDF conversion was regression-tested, not rerun
with a heavyweight model download. Historical fixture-only receipts are retained
with their original qualifications.
