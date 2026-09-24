# Local TeX Builds

LitAgent builds from prepared, offline application resources, not the user's
system TeX installation. The full runtime supports XeLaTeX, Biber, BibTeX,
makeindex glossaries, custom classes/styles and bundled fonts. It is currently
qualified on Linux x64 with Bubblewrap and util-linux `prlimit`. A smaller
Tectonic 0.17.0 runtime remains available for basic Linux x64/arm64 documents.
Other platforms fail closed; there is no unrestricted compiler fallback.

## Prepare On The Build Host

### Full TeX Projects

Run `bun run prepare:texlive-runtime` on the supported Fedora build host with
TeX Live 2026, Biber 2.22, Perl, Liberation Sans/Mono, and their distribution
dependencies installed. This maintainer-only recipe copies the system-managed
distribution, required native libraries/loader, format, locale and paper-size
data into `resources/texlive/rootfs`. It records exact RPM versions, license
texts and SHA-256 hashes. It does not copy the host home, local TeX customizations,
provider configuration or user fonts. Current prepared size is about 2.8 GiB.

The recipe refuses to overwrite an existing bundle. Set
`LITAGENT_TEXLIVE_RUNTIME_DIR` to prepare/use another location, including when a
shared filesystem cannot hold the distribution's many small files. For desktop
releases, include the complete generated `texlive` directory in application
resources; Electron passes that location to the backend. Do not include a
development symlink pointing to a maintainer's cache in a release.

No system TeX installation, package download, or network access is used when
compiling a document. The packaged runtime is selected at server startup when
present (or explicitly configured). A failed build never retries another engine.
An explicit but missing runtime path fails closed. Prepared resources are
immutable deployment assets; the complete manifest is verified before their
first use in each server process and again if the manifest changes. The first
build therefore has an additional integrity-check phase; subsequent builds
reuse that verification. Replace bundles atomically and restart on upgrade.

The full pipeline uses saved source/asset snapshots, never the original imported
folder. It runs XeLaTeX without shell escape or automatic package/format
generation, then the required Biber/BibTeX and makeindex steps, up to five
reference-stabilization passes, and PDF generation. Changed glossary inputs
trigger a new makeindex pass. Nested `\include` auxiliary directories are
prepared. Compiler stages are visible while the build is running.

Imported `latexmkrc`, Python and shell scripts remain editable text; none is
executed. Projects requiring custom preprocessing must include its generated
inputs. LuaLaTeX, arbitrary external executors, xindy/bib2gls, PostScript
conversion and every possible custom glossary type are not supported by this
pipeline. Fonts must be in the bundle or imported with the project. Missing
packages/fonts produce errors, not silent source rewrites or substitutions.

### Basic Tectonic Projects

Run `bun run prepare:tex-runtime`. This downloads the upstream musl executable,
checks its pinned release SHA-256, and warms a private support-file cache using
synthetic documents. Only preparation accesses the network. No research files
are sent anywhere. Generated platform-specific resources are ignored by Git.

The basic `resources/tex` directory contains the executable, offline cache
and a manifest of file hashes. Bundle it as `resources/tex` in a desktop release;
Electron passes its resources path to the backend. Local web deployments can set
`LITAGENT_TEX_RUNTIME_DIR` to that directory. A normal document build never falls
back to a system TeX executable, package manager, or online package download.

Its cache covers article/report/book, the default manuscript template,
Latin Modern font sizes/styles, BibTeX/plain, amsmath/amssymb, graphicx, hyperref,
geometry, booktabs, array, longtable and xcolor. It is not all of TeX Live. Missing
packages produce build errors. Extend the preparation fixtures deliberately and
revalidate the offline build before expanding this support set.

Linux installers must supply Bubblewrap and util-linux; paths can be set with
`LITAGENT_BWRAP_BIN` / `LITAGENT_PRLIMIT_BIN`. User namespaces must be permitted.
A disabled sandbox produces a failed build, never an unrestricted retry. Desktop
installer assembly, macOS/Windows sandbox implementations, full-runtime arm64
qualification and release licensing/source-distribution review remain gates.
This is not a claim of a finished cross-platform installer. The full runtime
retains distribution license texts and package inventory; Tectonic's complete
third-party inventory still needs release review.

## Execution Boundary

- The complete saved source revision map must match the request.
- Builds use a temporary source snapshot, never the canonical manuscript folder.
- A private Linux namespace exposes only that snapshot, the read-only engine and
  support cache, temporary files, a minimal device tree and private `/proc`.
- No host home, credentials, repository or network is mounted. The full engine
  uses `-no-shell-escape -no-pdf` with a separate fixed PDF driver invocation;
  Tectonic uses `--untrusted --only-cached`. No imported command line is executed.
- Both engines allow one active build and a 16 MiB PDF/per-file output limit.
- Full-runtime limits: 300 seconds total build wall time (after verification),
  240 CPU seconds per process, 4 GiB address space, 256 open descriptors,
  256 MiB aggregate source/scratch/output, 2048 files/directories and 2 MB log.
- Basic-runtime limits: 90 seconds wall time, 60 CPU seconds, 1 GiB address
  space, 128 open descriptors, 96 MiB aggregate source/scratch/output, 1024
  files/directories and 1 MB log. Both retain the final 64,000 log characters.
- Cancellation kills the process group. Restarted builds are marked interrupted
  and never replayed automatically.
- Only a successful PDF replaces the last-good preview. Source revisions, logs
  and bounded file/line diagnostics persist under `.litagent/tex-builds`.
- Build caches are disposable, ignored by Git, and separate from text history.

## Verification

`LITAGENT_TEST_TEX=1 bunx vitest run packages/workflows/src/tex-builds.test.ts`
exercises the real prepared compiler, missing-package failure, denied host-file
reads and shell escape, diagnostics and cancellation. The default suite uses
fixture engines so it does not download anything or require a compiler.

`LITAGENT_TEST_TEXLIVE=1 bunx vitest run packages/workflows/src/texlive-runtime.test.ts`
checks the full native runtime, fonts, bibliography/glossary PDF text, nested
chapters, imported-script isolation, denied host reads and cancellation.
Runtime-integrity and build-phase/diagnostic tests also run in the default suite.

`bun run test:writing-import-ui` exercises folder/ZIP imports and the editor
against isolated real HTTP servers. Set `LITAGENT_TEST_WRITING_FOLDER` to a local
TeX project for a read-only source compatibility test: upload it through the UI,
check every imported hash, compile and inspect the resulting PDF, then verify
the original folder's hashes are unchanged. Test sources/PDFs remain local and
are never committed. A 116-file, 52 MiB thesis with Biber, glossaries, custom
class, figures and Liberation fonts was verified this way as an 88-page PDF.

Upstream references: [compile/security options](https://tectonic-typesetting.github.io/book/latest/v2cli/compile.html),
[pinned release](https://github.com/tectonic-typesetting/tectonic/releases/tag/tectonic%400.17.0).
