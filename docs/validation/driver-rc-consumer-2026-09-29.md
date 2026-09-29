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
