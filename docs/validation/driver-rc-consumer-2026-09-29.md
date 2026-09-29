# RC consumer gate: public full text and restart recovery

This is application evidence against published AgenticDriver alpha.6, not
certification of a future release candidate. The exact dependency remains
`@agenticdriver/sdk@0.2.0-alpha.6`. No SDK checkout, host, grant, sign-in,
authentication stack or real user repository was modified.

## Source and retrieval

Selected public source: Liu et al., [Lost in the Middle, v3](https://arxiv.org/html/2307.03172v3).
The original 18-page [PDF](https://arxiv.org/pdf/2307.03172v3) was downloaded
alongside the complete HTML-derived Markdown. Pandoc parsed the HTML into its
JSON AST; blocks preceding the first article H1 were removed, then converted
with `gfm-raw_html`. The reading copy retains article references, appendices and
the site's trailing footer. This is not a Marker/PDF conversion test.

- PDF SHA-256: `653b29619eae2ae4b361d7bdcdc06db4bedcb1b0eabe31814036beca8c1af0b1`.
- Markdown SHA-256: `e4053f7ea9c6f144860df5ed613bc1a5689f66e65b847b5a0581d434573ada07`.
- 73,754 Markdown characters, all included in the writing context; 111 passages.
- Disposable project: `project_830b8d9073e94cc9`.
- Disposable manuscript: `manuscript_30849c74e5fb703f`.
- Paper: `paper_f1730c5ece755d4e`.

The actual `/api/search` route found selected-project passages for "retriever
recall". The Q&A question concerned section 5's open-domain QA experiment,
not merely the abstract. Citation targets resolved to the selected Markdown
and attached PDF. The numerical findings were also checked against PDF text.
This is app-owned SQLite FTS and full-text context, not an embedding/vector test.

## Real provider results

Every request explicitly used `prometheus-claude` /
`claude-haiku-4-5-20251001` through the separately authorized alpha.6 profile.
No private paper, mock provider, simulated response, model/account fallback or
stress loop was used. Seven requests completed; two distinct requests were
interrupted for the recovery checks.

| Operation | SDK run ID | Input / output tokens |
| --- | --- | --- |
| Q&A draft | `49e10ecc-9e2c-4b11-9ade-ec291a2946ae` | 30,732 / 1,331 |
| Q&A review 1 | `b6b1ae75-1626-43d3-b125-8a18822afc8d` | 31,327 / 4,111 |
| Q&A repair | `4fc425ab-8bf9-4d99-936e-471ca3704c55` | 31,336 / 3,717 |
| Q&A review 2 | `ac3fbed4-cdf1-4daa-ba35-5538968352f5` | 31,322 / 7,526 |
| First writing draft, rejected locally | `16caf4de-7995-40ce-9902-fb547421af8a` | 32,650 / 4,686 |
| Explicit new writing attempt | `d7ce1349-2154-45f3-a203-564fbe8cafd6` | 32,650 / 6,037 |
| Writing support review | `7c2d9eec-f655-4b9a-88a1-e49d73150184` | 32,844 / 1,379 |
| Explicit cancellation | `28cc2800-4025-47d5-aab5-142061dcd75e` | unknown |
| Backend disconnect | `8e8b4c41-0ecb-45e1-9c2e-7c8515520300` | unknown |

Completed-run totals: 222,861 input / 28,787 output tokens, zero reported cached
input. Reported API-equivalent cost totals USD 0.589587, not a subscription
charge. Unknown interrupted usage is not counted as zero. No Usagestat ingestion
claim is made for this remote validation host.

The first Q&A review rejected introduction-only evidence for the section-5
question. Its single bounded repair cited the section-5 passage instead. The
final answer gave the saturation result and qualified performance gains, using
"more than 20" rather than the question's explicit 20-to-50 formulation. That
answer is grounded but does not fully reproduce every requested detail.

The initial writing draft failed exact source validation: a quote existed
elsewhere in the paper but not in the cited chunk. It was retained as failed
and never accepted. The completed Q&A was not repeated. A new, explicitly
requested writing attempt passed exact quote checks and factual support review.
Candidate `candidate_ba14f1ac6f9afd39` was accepted, with its references, only
into the disposable document. Citation existence and factual support remained
separate checks; editorial preferences did not override either.

## Acceptance and recovery

`test:driver-live --generate --rc --keep-open` exercises the actual HTTP server.
The explicit failed-writing resume option retained the first attempt in the
receipt. No accepted effect or uncertain generation was retried as a new run.

- Accepted file revision: `de9479de960462b6a1ba480406e06af91e0a027d6b6188a707b2c662b71e87e5`.
- After backend restart, repeating the same acceptance returned the same file
  and left history unchanged. Reposting the generation request returned the
  existing batch, not another model call.
- A separate editing request was cancelled after a real SDK run ID arrived.
  The normalized terminal event was `run.failed`, `failureClass=cancelled`,
  code `CANCELLED`; local candidate state remained cancelled after restart.
- A separate two-candidate batch was interrupted by stopping only the
  disposable application backend after its first SDK run began. On restart,
  active and queued candidates became interrupted. Reposting the same request
  did not dispatch either again. The second candidate has no provider log.
- Repeated reads/reposts left the interrupted event logs unchanged and the
  accepted content and candidate-history entries unduplicated.
- The disconnected call has no terminal app event. The SDK's subsequent
  host-log reconciliation is recorded below; the app receipt does not infer
  remote completion from a stopped application process.

Native T3 browser checks covered the actual PDF, full Markdown, saved Q&A,
writing file with accepted text, and both interrupted candidates after restart.
API acceptance was operator-authorized; this run did not click Accept in the UI.

## Fixes and remaining boundaries

The checks exposed two app-owned defects:

1. Markdown passage parsing invented PDF pages from paragraph counts. New
   parsing leaves pages unknown unless explicit zero-based Marker anchors
   provide coordinates. Readers no longer substitute page 1 for an unmapped
   highlight. After explicitly regenerating passages in the disposable repo
   with identical Markdown bytes, the native browser citation showed "Page
   unmapped" and Markdown L172, without an invented PDF highlight. Existing
   saved evidence badges are historical snapshots; this change does not
   silently rewrite them or reindex users' existing libraries.
2. Writing's one-shot repair handled claim-text mismatches but not an exact
   quote attached to the wrong source. It now includes that validation failure,
   still requires exact revalidation plus support review, and stops after one
   repair. Regression checks retain rejection when the repair is invalid. The
   successful new real attempt did not need repair, so it does not certify the
   live repair branch itself.

Local typecheck, standalone acceptance-script typecheck, build and 322 tests
passed (two skipped). The build retains its existing large-chunk warning.
Immutable application source `80381237f0d87c83c8042535785b7f98ee7e4386` passed
[Prometheus run 36557934097](https://github.com/hashimkarim/agentic-literature-review/actions/runs/36557934097),
job `109371505005` (frozen install, typecheck, tests and build).

## SDK cancellation reconciliation

The authorized SDK thread reported a readback of only the two original run IDs
from the existing alpha.6 host JSONL on 2026-09-29. No inference was replayed:

| SDK run ID | Host terminal status | UTC timestamp |
| --- | --- | --- |
| `28cc2800-4025-47d5-aab5-142061dcd75e` | cancelled | `2026-09-29T10:44:42.316Z` |
| `8e8b4c41-0ecb-45e1-9c2e-7c8515520300` | cancelled | `2026-09-29T10:44:45.026Z` |

Both host usage objects were empty: usage is **unreported, not zero**. The
completed-run totals above are unchanged. Terminal cancellation is now confirmed
by the SDK's host receipt, but this reconciliation does not independently prove
native process reaping or automatic Usagestat ingestion. The original app logs
and interruption/restart outcomes remain unchanged.

## Remaining gates

Remaining gates are not SDK failures: vector retrieval is untested; a current
PDF-to-Markdown page map is required for precise PDF navigation; general
multi-stage ReviewStages orchestration is not mounted in the HTTP UI; the future
RC artifact needs its own compatibility check. The tested restart recovery is
the app-owned writing workflow, not a durable SDK job or an exactly-once remote
tool effect. No management/tools/jobs grants were available or expanded.

Private local receipt and logs:
`/home/hashim/Applications/T3CodeNightly/tmp/litagent-alpha6-live-9vZP06/receipt.json`
and its `research/.litagent/cache/provider-runs/` directory. These contain the
original failures and successful attempts; no credential contents are included
in this committed handoff.

## Superseded RC preflight

On 2026-09-29, an isolated vanilla clone of application commit
`1528f61d6692bec9a857bb06b896aa5d851d1dce` checked the exact SDK RC archive
from source `d2d91ad4b89a585257cf1eec75c0d6de0b60412b`, SHA-256
`18f75e863af6c0dc1a8e13e7ee433d65ffede47810bf7271da28e1e5e356bacc`.
The clone is `/tmp/litagent-rc1-final-20260929`; its temporary local dependency
is not committed. The main checkout remains pinned to registry alpha.6.

- Fresh install and frozen-lock install passed.
- Typecheck and full build passed (existing bundle-size warning).
- Tests passed: 347 passed, 2 skipped, 45 files. The isolated package-identity
  assertion was updated from alpha.6 to rc.1. One intermediate test run raced
  the frozen install and observed temporarily missing modules; rerunning after
  install completed passed. This is not classified as an SDK defect.
- Acceptance receipts now read the actual installed package version rather
  than hardcoding alpha.6.
- No model request was started, no grant was expanded, and no shared host was
  changed. Mounted RC browser/live acceptance was not performed.

The SDK thread superseded this candidate before live checks because the native
Claude subscription limit was incorrectly classified as CLI_FAILED. New Claude
inference is held until the reported reset at 2026-09-29T15:10:00Z and the
replacement final artifact handoff. Preserve the selected Claude account/model;
do not substitute Codex or enable overage. These compatibility results are
historical preflight evidence, not final RC acceptance or registry adoption.

## Corrected RC connection preflight

The replacement archive from SDK source
`726fd821a31d7c4462db36bfdf3884ab028f9b7a` was verified against SHA-256
`d5f13587d78e4d887ad4879a14e317db7aba34ce1d3544ecba8239e940060822`
and installed only in the disposable clone above. Fresh/frozen installs,
typecheck, build and all 347 tests (2 skipped) passed.

The actual app backend connected to the real final RC host at
`http://127.0.0.1:17439/`, using its existing private application profile.
No model request was sent. The mounted native T3 browser checked the first
screen, Settings, read-only provider controls, metadata refresh and reload.
The explicit Claude Haiku selection stayed enabled; Codex stayed disabled with
no model selected. Account identity remained masked. Desktop and 390px-wide
screenshots were inspected. The Settings tabs require horizontal scrolling at
the narrow width; no new mobile-layout qualification is claimed.

The app API rejected disabled-provider execution before dispatch. The live-check
receipt reports no completed runs and only the four non-generation checks:
empty onboarding, real read-only panel, disabled execution rejection, and
refresh preserving the model selection. The task-owned temporary backend was
stopped after inspection; shared SDK hosts/services were untouched.

Private receipt:
`/home/hashim/Applications/T3CodeNightly/tmp/litagent-alpha6-live-F9Sxed/receipt.json`.
Browser screenshots:
`/home/hashim/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mumokqhn-15b14a06.png`
and
`/home/hashim/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mumol5xc-edf9f30e.png`.

Final generation, supported-candidate acceptance and cancellation/restart checks
remain pending the selected Claude account's recovery. No quota failure counts
as positive generation acceptance, and the earlier alpha.6 live evidence is not
relabelled.

## Registry RC1 Pin

After the SDK's publication confirmation, all three owning manifests
(`apps/server`, `apps/web`, `packages/agents`) were pinned to npm
`@agenticdriver/sdk@0.2.0-rc.1`. The installed package version matches.
`bun.lock` records integrity
`sha512-m4SWXDdP1vGxUAr2DXhtYU0BAXI344RmbF3O/ZDHAqxy3Aml09CI9YN4cAmiC1M/pzYWvsSJnnH1npTmCJpYow==`.
It resolves the corrected 726fd82 archive, not the superseded candidate or a
local path. Installation and frozen-lock installation passed.

Registry adoption commit: `cf67c0746a84eacf676f51696fe506bfcb3accf5`.
[Prometheus CI 36573266371](https://github.com/hashimkarim/agentic-literature-review/actions/runs/36573266371)
passed typecheck, 347 tests (2 skipped) and build on runner
`prometheus-literature-01` (ID 2), job `109422286461`. No hosted compute.

## Final RC Live Workflow

The SDK confirmed the same Claude account recovered at 15:11 UTC. LitAgent
then used only `prometheus-claude / claude-haiku-4-5-20251001`, native
2.1.282, through the scoped RC host and exact registry package above. No
account/model/billing fallback, grant expansion, private source or external
send occurred. SDK recovery evidence is separate from these app calls.

### Rejected first question

The unchanged baseline question required the explicit 20-versus-50 comparison
from section 5, although that wording is in the introduction. All four provider
calls completed, but app support validation rejected the final answer after
its one bounded repair. The API returned HTTP 500 with `invalid_evidence`;
no answer or manuscript change was saved. This is not a successful answer or an
SDK transport failure. Its private receipt/logs are preserved under
`/home/hashim/Applications/T3CodeNightly/tmp/litagent-alpha6-live-iIiaV6/`.

| Stage | SDK run | Input | Output | API-equivalent USD |
| --- | --- | ---: | ---: | ---: |
| Draft | `0b80832d-e0a4-481f-8d05-ab0a97bcedbd` | 30289 | 1994 | 0.070538 |
| Review | `b48bda20-405b-4ab6-8032-646a842635ee` | 31242 | 11059 | 0.117769 |
| Repair | `c0e4455d-81dd-4729-8a3f-e392bf117473` | 30876 | 2970 | 0.076592 |
| Review | `3996b46f-de19-4bb5-9031-67da69759a9d` | 30895 | 4660 | 0.085080 |

The acceptance question was corrected to cite the introduction for the numeric
comparison and section 5 for saturation, in app commit
`ffdd6e383bca2fb4eb759ac3e26b814491a471a5`. Source validators were not
changed or relaxed. One new, known-failed-operation replacement was made;
no uncertain request was replayed.

### Successful workflow

The corrected workflow passed using the same 18-page public PDF and full
73,754-character Markdown snapshot (111 app passages). The source hashes above
are unchanged. Selected-paper/project FTS retrieval returned actual passages.
The answer preserved the approximate 1.5% and 1% gains for the 20-versus-50
comparison and explained reader saturation, linking introduction passage
`0018` and section-5 passage `0064`.

Its first review judged support valid but changed a verbatim Markdown math
expression to plain `~`; exact-quote validation rejected that review. The
existing single repair succeeded. Both quote existence and support were
checked; neither check was bypassed.

The writing draft and separate support review completed. All three claim
evidence links resolved to the exact supplied quotes. Before acceptance, the
manuscript was unchanged. Explicit app-API acceptance added bibliography
references and candidate `candidate_f9effd8be49d7d62` to the disposable
`sections/introduction.tex`. Accepted revision:
`2a24c9ed329f36a17251c0ed73f747c1a668362c1f42c0d60971cc2e104424ed`.
Backend restart, repeated acceptance, and repeated generation request ID
preserved the same file/history without another model request or duplicate edit.

| Stage | SDK run | Input | Output | API-equivalent USD |
| --- | --- | ---: | ---: | ---: |
| Q&A draft | `3ebac6e4-6792-40e4-b294-db24ea0c114d` | 30307 | 2499 | 0.073099 |
| Q&A review | `22feafeb-499a-459b-a23f-9ae4f225ab5c` | 31270 | 3045 | 0.077755 |
| Q&A repair | `3fcbac8e-f814-4f41-a0d6-b00c7680ad3b` | 30649 | 6772 | 0.095148 |
| Q&A review | `55a1f102-25cf-4d29-9570-b8755f9369a6` | 31268 | 1833 | 0.071691 |
| Writing draft | `4c979040-8c11-4b76-800a-e31c8619fd05` | 32669 | 2791 | 0.079283 |
| Writing review | `683b2aa5-62f7-4d79-b62a-c0deba7f9eb4` | 32891 | 1573 | 0.073637 |

Successful-workflow completed usage: 189,054 input, 18,513 output, 0 cached,
USD 0.470613 API-equivalent. Including the rejected first question: 312,356
input, 39,196 output, 0 cached, USD 0.820592 API-equivalent. These are native
reported estimates, not subscription charges; reasoning usage was unreported.

### Cancellation and recovery

- Explicit cancellation: `306210b1-723f-4efc-a9b4-e9db6eae0a00`.
  The app observed SDK `CANCELLED` at 15:20:54.086Z. The cancelled batch
  survived restart and request replay without new events or manuscript edits.
- Backend interruption: `e04cf004-28d1-4dc3-90f6-b03baaac5a50`.
  After restart both candidates were interrupted, including the queued second
  candidate that never dispatched. Replaying the same batch did not resume or
  duplicate processing. The accepted file/history was unchanged.
- Neither interruption has a completed usage record locally. Usage is unknown,
  not zero. Host terminal reconciliation was requested from SDK ownership;
  abrupt-disconnect native terminal status is not inferred from app recovery.

### Mounted browser and limits

Native T3 browser inspected the 18-page PDF, saved Q&A after reload, citation 2
navigation to Markdown L172, accepted writing candidate, and interrupted batch.
Settings refresh/reload after backend restarts retained enabled Claude Haiku
and disabled/unselected Codex. Disabled execution was rejected before dispatch.
Acceptance/cancellation/restart were exercised through actual app HTTP APIs;
the browser inspected their persisted UI states, not a second generated run.

Screenshots in local T3 artifacts:
`browser-screenshot-127-0-0-1-mumtrnid-6a5503f6.png` (citation),
`browser-screenshot-127-0-0-1-mumtstjf-cd74f536.png` (accepted writing),
`browser-screenshot-127-0-0-1-mumttk5u-a57998a9.png` (saved connection).

The accepted draft has unescaped percent signs. The existing Editing checks UI
correctly warns that these comment out TeX text, but advisory editorial checks
do not block explicit acceptance. This is a remaining app output-quality issue:
the supported draft is not certified compilation-ready. The support reviewer
also mislabels the introduction quote as section 5 in its explanation; the
actual source IDs/quotes remain correct. Source support is a model judgment,
not independent factual certification.

PDF page mapping remains unavailable for these Markdown passages, so the UI
truthfully uses Markdown navigation instead of inventing pages. No vector
retrieval, SDK tools/jobs, native process reaping, automatic Usagestat capture,
or blanket model qualification is claimed by this app receipt.

Successful private receipt:
`/home/hashim/Applications/T3CodeNightly/tmp/litagent-alpha6-live-zhKifZ/receipt.json`.
No credential contents are included in this handoff.

### Final host reconciliation

SDK ownership read the actual final host records without rerunning requests.
Both interrupted IDs above are terminal `cancelled`, under
`rc1-literature / prometheus-claude / claude-haiku-4-5-20251001`.
The explicit-cancel duration was 101ms; disconnect duration was 108ms. Each
record has one started step, zero completed steps, no reported step usage, and
an empty usage object. Usage remains unknown, not zero.

The same readback matched all ten completed records' individual token and
API-equivalent figures above, including the rejected first question. This
confirms remote terminal state and reported totals, not per-run native
descendant inspection or Usagestat ingestion. No additional model calls were
made for reconciliation, registry equivalence, or documentation.
