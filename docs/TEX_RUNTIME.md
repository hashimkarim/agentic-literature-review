# Local TeX Builds

LitAgent uses pinned Tectonic 0.17.0, not a host TeX Live installation. The first
supported sandbox is Linux x64/arm64 with Bubblewrap and util-linux `prlimit`.
Other platforms fail closed; they do not run the engine unrestricted.

## Prepare On The Build Host

Run `bun run prepare:tex-runtime`. This downloads the upstream musl executable,
checks its pinned release SHA-256, and warms a private support-file cache using
synthetic documents. Only preparation accesses the network. No research files
are sent anywhere. Generated platform-specific resources are ignored by Git.

The prepared `resources/tex` directory contains the executable, offline cache
and a manifest of file hashes. Bundle it as `resources/tex` in a desktop release;
Electron passes its resources path to the backend. Local web deployments can set
`LITAGENT_TEX_RUNTIME_DIR` to that directory. A normal document build never falls
back to a system TeX executable, package manager, or online package download.

The initial cache covers article/report/book, the default manuscript template,
Latin Modern font sizes/styles, BibTeX/plain, amsmath/amssymb, graphicx, hyperref,
geometry, booktabs, array, longtable and xcolor. It is not all of TeX Live. Missing
packages produce build errors. Extend the preparation fixtures deliberately and
revalidate the offline build before expanding this support set.

Linux installers must supply Bubblewrap and util-linux; paths can be set with
`LITAGENT_BWRAP_BIN` / `LITAGENT_PRLIMIT_BIN`. User namespaces must be permitted.
A disabled sandbox produces a failed build, never an unrestricted retry. Full
desktop installer assembly, macOS/Windows sandbox implementations and bundled
third-party license inventory remain release gates; this is not a claim of a
finished cross-platform installer.

## Execution Boundary

- The complete saved source revision map must match the request.
- Builds use a temporary source snapshot, never the canonical manuscript folder.
- A private Linux namespace exposes only that snapshot, the read-only engine and
  support cache, temporary files, a minimal device tree and private `/proc`.
- No host home, credentials, repository or network is mounted. Tectonic runs
  with `--untrusted --only-cached`; shell escape cannot be enabled by a document.
- Limits: one active build, 90 seconds wall time, 60 CPU seconds, 1 GiB address
  space, 128 open descriptors, 16 MiB per output, 48 MiB aggregate output, 256
  files/directories and 1 MB process log (64,000 characters retained).
- Cancellation kills the process group. Restarted builds are marked interrupted
  and never replayed automatically.
- Only a successful PDF replaces the last-good preview. Source revisions, logs
  and bounded file/line diagnostics persist under `.litagent/tex-builds`.
- Build caches are disposable, ignored by Git, and separate from text history.

`LITAGENT_TEST_TEX=1 bunx vitest run packages/workflows/src/tex-builds.test.ts`
exercises the real prepared compiler, missing-package failure, denied host-file
reads and shell escape, diagnostics and cancellation. The default suite uses
fixture engines so it does not download anything or require a compiler.

Upstream references: [compile/security options](https://tectonic-typesetting.github.io/book/latest/v2cli/compile.html),
[pinned release](https://github.com/tectonic-typesetting/tectonic/releases/tag/tectonic%400.17.0).
