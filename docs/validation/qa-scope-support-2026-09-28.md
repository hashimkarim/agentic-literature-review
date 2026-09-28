# Q&A scope and factual-support regression

Application runtime: `f81336441dc777e3352afc31bddfcfcffc17bee0` on the
`qa-safety-cleanup` stack. Subsequent `36e88fb` adds only test isolation.
Installed SDK remains exact registry `@agenticdriver/sdk@0.2.0-alpha.5`.

## Local verification

- `bun run typecheck`: passed.
- `bun run test`: 343 passed, two skipped, 44 files; resolver guard passed.
- `bun /mnt/shared/Git/agentic-literature-review/scripts/check-test-isolation.ts`
  from `/tmp`: passed, including scoped SDK panel/connection entrypoints.
- `bun run build`: passed; existing Vite large-chunk warning remains.
- Scope tests cover stale collection links, unlink/deletion/expansion during a
  run, and Markdown replacement. Provenance tests reject changed, missing,
  extra and duplicate manifests before saving an artifact. Support regressions
  separate exact quotation/citation existence from comparison scope.

These offline regression checks are not live-provider certification.

## Actual remote application check

Used the authorized SSH-forwarded Prometheus host at loopback port 17435 and the
existing `literature-prometheus-validation` grant. Explicit route:
`prometheus-claude / claude-haiku-4-5-20251001`. No account/model fallback.
No SDK host restart, grant change, authentication migration, production settings
edit, or private paper/manuscript submission occurred.

The app backend ran on port 3895 with disposable repository
`/tmp/litagent-remote-acceptance-20260928-1519`; web port 5235. Native T3 browser
was used at 1920x1080 for selecting the public notes, submitting both questions
and opening the resulting citation. The existing scoped Claude enablement/model
selection persisted; Codex stayed disabled and was not invoked.

Only the 826-character supplied public-paper notes about Lewis et al.
(arXiv 2005.11401) and Liu et al. (arXiv 2307.03172) were selected. These are
paraphrases, not complete PDF extractions. Temporary app seed papers were not
sent. The earlier run `run_08049e6fbed24326` remains historical evidence of the
original overclaim; it was not overwritten or replayed.

### Rejected overclaim

Question asked the model to re-evaluate the earlier answer's claims about both
Lewis variants beating a baseline, Liu evaluating retrieval-augmented QA, and
Lewis testing only two methods, then propose two design experiments.

App run `run_abfcecf30a304307`, 15:53:37-15:56:39 UTC, made the normal bounded
draft/review/repair/review sequence. The final review rejected the unsupported
exhaustive claim "Lewis tested only two methods". The app failed closed with
`invalid_evidence` and did not save that new answer into the chat. This verifies
rejection, not successful generation of a corrected answer to that question.

| Stage | Actual SDK run ID | Native input tokens | Native output tokens |
| --- | --- | ---: | ---: |
| Draft | `6f623196-7562-4ce0-9e4d-b1c043426fe4` | 5059 | 5392 |
| Review | `82cf846f-c48b-40f6-8c9f-7a4de6facddb` | 5846 | 5546 |
| Repair | `cecdca3f-af11-4f18-be1d-138b85e37f5d` | 5805 | 1295 |
| Review | `f86f5b13-4f1e-45fd-ae8b-a35929895b8b` | 5807 | 7898 |

### Supported answer and citation

The second question asked what Liu observed about relevant information near the
ends versus the middle, requesting two sentences and preserving "often".
App run `run_6e8e942c10234bcf`, 15:57:24-15:57:53 UTC, completed on the first
draft/review cycle. The answer preserved the comparison, "often", and the
long-context-model condition. The reviewer supplied an exact source excerpt;
the app verified it independently against the cited passage.

| Stage | Actual SDK run ID | Native input tokens | Native output tokens |
| --- | --- | ---: | ---: |
| Draft | `f73bb060-eff2-4726-83d6-c77d6de6d3bf` | 5021 | 1290 |
| Review | `d2ee0906-b21d-475d-8c32-2c8a6a3a314a` | 5334 | 1499 |

Clicking citation 1 in the native browser resolved the Liu passage at Markdown
line 11 and correctly reported "PDF not attached". Verified source manifests
were retained for all six calls: document revision
`e891316006fd2de44a026dbe239add8e8db8e3dbc7c3b9d8e0da28d20560c2db`, supplied
snapshot SHA-256
`0f17c560e8f5f98aa5c7bbc0caaf343674cb1383fee64eca35277ed2a346f9be`, 1215 UTF-8
bytes including source metadata and passage markers, origin `inline`.

## Limits

Semantic review is still a model judgment, not a proof of entailment. The first
review in the negative case missed the exhaustive-scope problem; the final
review caught it. A failed repair remains an explicit failure, not a substituted
answer or silent fallback. Existing historical answers are not automatically
revalidated. Pending chat wording remains generic through review/repair stages.

A question submission during the disposable backend restart failed before any
run was created; after startup, the public notes were reselected and the request
was submitted. There was no extra model call for that transport failure.

Usage is native-reported and retained with SDK run IDs in normalized app logs.
API-equivalent estimates are not subscription charges. This remote validation
host uses its existing JSONL sink; no shared Usagestat-ingestion claim is made.
No new cancellation, PDF geometry, full-paper retrieval or vector-retrieval
qualification is claimed. Raw receipts remain in the disposable repository's
`workflows/` and `.litagent/cache/provider-runs/` directories, without credentials.
