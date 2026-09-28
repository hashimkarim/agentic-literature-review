# Branch audit and consolidation

Reviewed against `main` at `9f5615c031186a1510aeb1664ba895a937d6c465`.
No wholesale merge of old adapter branches is appropriate: they predate the
published scoped SDK, multi-connection settings and removal of direct CLI paths.

## Disposition

| Branch | Audited tip | Disposition |
| --- | --- | --- |
| `chat-reliability` | `85f9cb1b41183823f63ae26ab901251bd3c474ea` | Already an ancestor of main; remove branch. |
| `hk-branch-1` | `35034c89621ece22fb5236c2841cf7aeaec03816` | Already an ancestor of main; remove branch. |
| `literature-feature-roadmap` | `f371f118458f5051186e7f00bdf94988016a7b3a` | Already an ancestor of main; remove branch. |
| `sdk-integration` | `19943daea921519f661fa7a05e820c28ca1d0e11` | Already an ancestor of main; remove branch. |
| `agenticdriver-connection-setup` | `4f4be9240080c776d0b7161501e038577e9b6202` | Explicitly reconciled by `138c22d`, then superseded by current SDK/settings; archive and remove branch. |
| `orchestrator/isolated-sdk-checks` | `c931f8ff97550dd7e71aef621e409114d020b017` | Port resolver guard to current scoped SDK in `36e88fb`; archive original receipt and remove branch. |
| `orchestrator/selected-paper-context` | `bacdca074f7b96dab4e928f46be93d058791b771` | Port scope/revision/provenance protection in `75aeee2` and `66e4a33`; original history is contained in archived catalog tip; remove branch. |
| `orchestrator/litagent-catalog-ad031-round3` | `e36e5b73ea1e9584e81f75d2b74c56bf7749634d` | Keep optional quota prototype under archive tag; do not merge obsolete single-host adapter or unmounted quota API; remove branch. |

The three remote archive tags were created and read back before deleting any
branch. They retain the exact original commits and their history:

- `archive/2026-09-28/connection-setup`: `4f4be9240080c776d0b7161501e038577e9b6202`
- `archive/2026-09-28/isolated-sdk-checks`: `c931f8ff97550dd7e71aef621e409114d020b017`
- `archive/2026-09-28/catalog-quota-prototype`: `e36e5b73ea1e9584e81f75d2b74c56bf7749634d`

Deletion is limited to these audited tips after the reconciled changes land and
pass main's Prometheus checks. Recheck live tips first; do not delete a branch
that advanced during the audit. No force push or pull request is involved.

## Reconciled safeguards

- Collection selection intersects current project membership. Deleted scopes,
  changed membership and reconverted Markdown invalidate an in-flight answer
  before another generation/review stage or chat persistence.
- Q&A supplies typed Markdown snapshots with application document IDs/revisions.
  Before accepting a cached draft, the adapter validates exact SDK manifests:
  source IDs, revision, content digest, byte count, media type, origin and location.
  Inline limits are enforced with explicit omitted/truncated coverage, not silently
  represented as full-source reading.
- Citation existence and semantic support remain separate. Each supported claim
  needs verified verbatim source excerpts and a separate comparison/scope verdict.
  Proposed experiments remain inferences, not reported results. Style and word
  count are not factual-support gates. `f813364` adds these checks and regressions.
- `bun run test` checks that Vitest resolves application code and installed SDK
  entrypoints inside this checkout, including when invoked from another directory.

## Not merged

The quota prototype contains useful account-binding, freshness and revocation
tests. A current implementation would need explicit authorized multi-host account
bindings and an actual settings view; it must not expose Usagestat administration
credentials, infer permission from quota, or revive the legacy provider adapter.
The archive preserves this work without claiming a shipped quota feature.

Source-manifest verification proves supplied provenance, not factual entailment.
Model support review can still make mistakes and is not an independent proof or
confidence score. Existing saved answers are historical and are not retroactively
rewritten by this cleanup.
