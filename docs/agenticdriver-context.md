# Selected paper context in the optional SDK adapter

Q&A resolves its paper scope in LitAgent and snapshots the converted Markdown
before generating a draft. Only current, completely included passages receive
citation markers. Missing, placeholder, omitted and truncated source coverage
stays in the existing Q&A diagnostics.

`ProviderRunStartInput.selectedContext` carries a separate prompt and the marked
paper snapshots. The original prompt remains available to the existing CLI
adapters. `AgenticDriverAdapter` sends the snapshots as inline Markdown
attachments; draft, review and the single allowed repair share the same
selection. The SDK continues to own provider execution, transport, usage and
cancellation. LitAgent does not create a retrieval index or perform provider
computation as part of this handoff.

Each source has two distinct identities:

- `source.id` is the selected paper ID. `source.revision` is the SHA-256 of the
  complete canonical Markdown at selection time, including when the sent
  snapshot is a bounded prefix.
- Manifest `sha256` and `bytes` describe exactly the UTF-8 bytes sent in the
  attachment, including paper metadata and passage markers. They need not
  match the canonical revision hash or the character count.

The adapter copies snapshots at session start and requires the completion
manifest to match every expected source exactly. Missing, additional,
duplicated or altered sources fail with `source_mismatch` before a proposal
file or completion event is written. Source order alone is immaterial. A
manifest proves which snapshots were supplied; it does not establish that a
generated claim is supported.

The workflow rechecks the current project/collection selection and Markdown
hashes before and after each stage. The adapter also invokes that app-owned
check immediately before dispatch and before saving a completed proposal.
Unlinking a paper fails even if a collection still lists it and the global
Markdown remains. A changed selection or revision requires a fresh question
run; sources are never silently added to an in-flight request. Existing claim
validation, independent source review, one repair limit, cancellation, thread
revision checks and citation validation remain in place.

Inline context supports at most 16 included papers, 256 KiB per paper and
512 KiB total. UTF-8 byte counts are enforced separately from LitAgent's
Markdown character budget. Larger selections fail with smaller-scope guidance;
this integration does not silently switch models or omit more content.

These snapshots are app-authorized inputs to an explicitly enabled SDK
provider. They do not grant tools, filesystem access, canonical artifact
acceptance or access to unselected papers. Other workflow proposals retain
their existing approval rules. No new provider credentials or live-provider
experiments are part of this contribution.

## Isolated verification

The task starts from committed LitAgent `d9427f6ef26102bb216ac9baf0140ab703a39e6b`
and includes the prior isolation contribution `c931f8f` (cherry-picked as
`ef429d8`). Its own branch is `orchestrator/selected-paper-context`, tracked by
[issue #2](https://github.com/hashimkarim/agentic-literature-review/issues/2).
Publishing that branch does not mean it has landed on `main`.

The independently installed SDK package is built from
`ecda755ef5e4243da4a114b47c1f69b030806664`. Archive SHA-256:
`6cfaa8a880c1f3348358e2439a8b74e0a3a820b22797d86f775939c122949cf0`.
Candidate receipt SHA-256:
`28b4d0e2ad6fad32127ee566b72a0e3a1edb84013d2bb5ee8530f2050dc9b52e`.
Provisioning receipt SHA-256:
`4b5c0cb030d8705cca0796c3bc817139517a9f56f900365ac25b5a39ed6e4b4a`.
The provisioner verified archive files in this checkout's dependency tree and
restored the tracked manifest/lockfile. No live SDK source or dist is linked.

Required checks are `bun run typecheck` and `bun run test`; the latter includes
the checkout isolation guard. Adapter tests verify genuine SDK loopback
round-trips with deterministic fixture providers and adversarial manifests.
Q&A tests use a typed client fixture through the real optional adapter to check
selected revision preservation, citation identities and concurrent source
removal. They do not create an HTTP host; the adapter tests separately exercise
the installed SDK over loopback. Neither layer performs paid provider inference.

Verification on 2026-09-21 passed `bun run typecheck` and all 141 tests in
12 files with Node `v26.0.0`, Bun `1.3.14` and Vitest `4.1.11`. The isolation
guard resolved all six app imports and four SDK imports within the allocated
checkout. This contribution changes no rendered UI.
