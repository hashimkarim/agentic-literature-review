# Isolated checks

Vitest derives exact aliases from this checkout. `bun run test` runs
`test:isolation` first: Vite resolves six app/four SDK imports, rejects escapes
(including symlinks), and records paths/digests. SDK files must be installed here.

Use a committed app checkout and independently built, pinned SDK archive.
Verify archive/install receipts; temporarily substitute the sibling dependency
for provisioning and restore tracked inputs. Do not link live SDK source or
copy node_modules. Run `bun run typecheck` and `bun run test`.

[Current receipts](agenticdriver-context.md).
[Historical isolation evidence and negative probes](https://github.com/hashimkarim/agentic-literature-review/blob/c931f8ff97550dd7e71aef621e409114d020b017/docs/isolated-sdk-checks.md).
