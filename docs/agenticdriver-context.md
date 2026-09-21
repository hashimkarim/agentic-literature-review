# Selected context

Q&A snapshots app-selected Markdown and complete passage markers.
`ProviderRunStartInput.selectedContext` supplies a separate SDK prompt; CLI
adapters retain their full prompt. Draft/review/one repair share attachments;
review retains cited passages. Coverage diagnostics remain unchanged.

Source ID is the paper ID. Revision hashes complete canonical Markdown;
manifest SHA-256/bytes describe exact attached UTF-8, including metadata and
markers. A truncated snapshot retains the canonical revision. The adapter copies
snapshots at start and rejects missing/extra/duplicate/altered manifests before
proposal writes (`source_mismatch`). Order is immaterial. A manifest is input
provenance, not claim support; existing grounding and approval rules remain.

App callbacks recheck project/collection scope and Markdown at dispatch/output
and between workflow stages. Unlinked papers, deleted project/collection
records, changed revisions and selection expansion fail closed despite retained global
Markdown. Cancellation, thread revisions and citation validation still apply.
Provider compute/credentials remain SDK-owned. Inline limits: 16 papers,
256 KiB each/512 KiB total, measured separately from character budgets. Oversize
fails with smaller-scope guidance, without fallback or further silent omission.

## Evidence

[Issue #2](https://github.com/hashimkarim/agentic-literature-review/issues/2),
branch `orchestrator/selected-paper-context` (unlanded).
Base `d9427f6` plus isolation `c931f8f`/`ef429d8`;
SDK `ecda755ef5e4243da4a114b47c1f69b030806664`.

- Archive: `6cfaa8a880c1f3348358e2439a8b74e0a3a820b22797d86f775939c122949cf0`
- Candidate receipt: `28b4d0e2ad6fad32127ee566b72a0e3a1edb84013d2bb5ee8530f2050dc9b52e`
- Initial install receipt: `4b5c0cb030d8705cca0796c3bc817139517a9f56f900365ac25b5a39ed6e4b4a`
- Retry install receipt: `7f9b4e4a0ad495f5a30d54d8edfdf1c3c4257ee75a62acf48e18dec8bde89f0a`

2026-09-21: typecheck and 141 tests/12 files passed (Node v26.0.0, Bun 1.3.14,
Vitest 4.1.11). Isolation resolved six app/four SDK imports locally; provisioning
verified archive contents and restored tracked inputs. Adapter tests use the
installed SDK over loopback; workflow tests use a typed client fixture through
the real adapter. No rendered UI or live-provider changes.
