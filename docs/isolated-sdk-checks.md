# Isolated SDK consumer checks

LitAgent's Vitest root and package aliases are derived from `vitest.config.ts`,
so an independent checkout tests its own source even when the invoking shell is
elsewhere. Exact alias matches preserve package exports such as
`@litagent/agents/agenticdriver`.

`bun run test` first runs `bun run test:isolation`. The isolation check resolves
the app package imports and the four SDK entry points used by the adapter tests
through Vite's actual resolver. It rejects source outside the checkout, including
symlink escapes, and requires SDK entry points to be in the checkout's installed
dependency tree. Its JSON output records the checkout, importer, resolved paths,
and SHA-256 of each resolved file. It does not open a provider session or listen
on an HTTP port.

For an independent consumer run:

1. Allocate a checkout at a recorded committed LitAgent revision.
2. Build and pack the SDK from a separate owned checkout at a pinned commit.
   Record the source revision, archive SHA-256, build commands, and environment.
3. Provision that archive into LitAgent's own dependency tree. The current
   `packages/agents/package.json` uses a sibling directory dependency; substitute
   the archive only for the isolated installation, preserving and restoring the
   tracked manifest and lockfile. Do not link a live SDK checkout or copy another
   checkout's `node_modules`.
4. Verify the installed SDK against the package receipt. The isolation guard
   verifies location and records entry-point digests; it does not independently
   establish the archive's source provenance or validate every installed file.
5. Run `bun run typecheck` and `bun run test` from the allocated checkout. Keep
   their results with the source and provisioning receipts.

The guard can also be run from another directory using an absolute path to
`scripts/check-test-isolation.ts`. A normal local installation with a symlink to
an external SDK source will fail the guard; install a package into this checkout
before claiming isolated consumer verification.

These checks exercise the existing optional adapter with fixture providers.
They do not establish delivery of new SDK features, authorize live-provider
experiments, or change LitAgent's artifact acceptance rules.

## Recorded source baseline

This contribution starts from committed LitAgent source
`dcd792780846ac0b0b9798c66cc024c81ae7f77c`. At verification setup, GitHub
`origin/main` was `f953cf9ec01606fdd0c5822d7d0eb48f4a5df9ca`; the source baseline
was 26 commits ahead. The task branch preserves that baseline history. Only the
new isolation-check contribution belongs to this task; publishing the branch
does not land that history or this contribution on `main`.

## Verification receipt, 2026-09-21

The allocated checkout was `run_68b7d72455d8403e`. It consumed AgenticDriver
`0.1.0` from source commit `eb986878af34eba5566b73302e8a24a52626ac09`:

- Archive SHA-256:
  `f4433c60ecca15b51edfa5ae442057054c3594121e2699e0f78c5b2236ddd453`.
- Package receipt SHA-256:
  `accc8fe21e469f766f9b9845c09eaed698d6e03afccfb4f8a692d8e7913e0c0b`.
  This receipt records an existing build in the owned SDK checkout
  (`provided-build`); its pack step does not itself claim to have run SDK tests.
- Provisioning receipt SHA-256:
  `63951dcbc5a628e0453bf4168edd7f5bb5846681f1176d6d7383b3b5c9df851c`.
  The orchestrator's reusable package provisioner verified all 128 archive files
  after a fresh `bun install --ignore-scripts`, and restored the original
  manifest and lockfile bytes.
- Environment: Linux x64, Node `v26.0.0`, Bun `1.3.14`, Vite `7.3.6`,
  Vitest `4.1.11`, TypeScript `5.9.3`. Bun regenerated and recorded the install
  lock privately; this was not a frozen-lockfile reproduction.

`bun run typecheck` passed. `bun run test` passed all 113 tests in 12 files,
including the existing SDK adapter fixture tests. The new script also passed a
standalone TypeScript check.

The isolation guard resolved six app imports and four SDK imports inside the
allocated checkout. It also passed when invoked from `/tmp`. Two deliberate
negative probes independently replaced the contracts alias with an external
file and an in-checkout symlink to that file; both exited with code 1 and
`resolves outside this checkout`. The original config was restored afterward.
Raw check logs and resolution receipts are retained in the allocated checkout's
ignored `.litagent/isolation-checks/` directory. Package/install receipts are
retained by the local orchestrator under their content hashes.
