#!/usr/bin/env bun
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Release digests from the upstream GitHub release API, not a floating installer.
const release = {
  x64: { target: "x86_64-unknown-linux-musl", sha256: "8533d07f9ccbd7a65824b9e0459041bca34af1eb33daba48f59215593753a3b7" },
  arm64: { target: "aarch64-unknown-linux-musl", sha256: "b10954a95404f3ab2328d2fa59a5ebab8e657f893fab096f98be8db7c0c979b8" }
};
const version = "0.17.0";
const root = fileURLToPath(new URL("../", import.meta.url));
const destination = path.resolve(process.env.LITAGENT_TEX_RUNTIME_DIR ?? path.join(root, "resources/tex"));
if (process.platform !== "linux" || !(process.arch in release)) throw new Error("Only Linux x64/arm64 TeX isolation is currently supported.");
if (fs.existsSync(destination)) throw new Error(`Runtime already exists: ${destination}. Move it aside before preparing a replacement.`);
const asset = release[process.arch as keyof typeof release];
const url = `https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${version}/tectonic-${version}-${asset.target}.tar.gz`;
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-tex-prepare-"));
const runtime = path.join(temporary, "runtime");
fs.mkdirSync(runtime);
function run(command: string, args: string[], cwd = temporary) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", timeout: 600_000,
    env: { PATH: process.env.PATH, HOME: temporary, XDG_CACHE_HOME: path.join(temporary, "xdg"), TECTONIC_CACHE_DIR: path.join(runtime, "cache"), TECTONIC_UNTRUSTED_MODE: "1" } });
  if (result.error || result.status !== 0) throw result.error ?? new Error(`${command} exited ${result.status}`);
}
try {
  console.log(`Downloading Tectonic ${version} (${asset.target})`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== asset.sha256) throw new Error("Tectonic archive checksum mismatch.");
  fs.writeFileSync(path.join(temporary, "engine.tar.gz"), bytes);
  run("tar", ["-xzf", "engine.tar.gz", "-C", runtime, "tectonic"]);
  fs.chmodSync(path.join(runtime, "tectonic"), 0o755);
  // Only this maintainer preparation step uses the network, never document builds.
  fs.writeFileSync(path.join(temporary, "seed.bib"), "@article{sample, author={A. Researcher}, title={Synthetic study}, journal={Examples}, year={2026}}\n");
  for (const documentClass of ["article", "report", "book"]) {
    fs.writeFileSync(path.join(temporary, "seed.tex"), String.raw`\documentclass{${documentClass}}
\usepackage[utf8]{inputenc}
\usepackage{amsmath,amssymb,graphicx,hyperref,geometry,booktabs,array,longtable,xcolor}
\title{Runtime preparation}\author{}\date{}
\begin{document}\maketitle
${documentClass === "article" ? String.raw`\begin{abstract}Synthetic abstract.\end{abstract}` : String.raw`\chapter{Synthetic chapter}`}
${["tiny", "scriptsize", "footnotesize", "small", "normalsize", "large", "Large", "LARGE", "huge", "Huge"].map((size) => `{\\${size} Roman \\textbf{Bold} \\textit{Italic} \\texttt{Mono} \\textsf{Sans} \\par}`).join("\n")}
\section{Synthetic text} Inline $x^2$ and \[y=\sum_{i=1}^{n}i.\]
\begin{tabular}{ll}\toprule A&B\\\midrule 1&2\\\bottomrule\end{tabular}
\cite{sample}\bibliographystyle{plain}\bibliography{seed}
\end{document}`);
    run(path.join(runtime, "tectonic"), ["-X", "compile", "--untrusted", "seed.tex"]);
  }
  const files: Record<string, string> = {};
  function inventory(directory: string) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      if (item.isDirectory()) inventory(file);
      else if (item.isFile()) files[path.relative(runtime, file).split(path.sep).join("/")] = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
      else throw new Error("Unexpected link in prepared runtime.");
    }
  }
  inventory(runtime);
  fs.writeFileSync(path.join(runtime, "manifest.json"), JSON.stringify({ version, platform: process.platform, arch: process.arch, archive: { url, sha256: asset.sha256 }, files }, null, 2));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(runtime, destination, { recursive: true, errorOnExist: true, force: false });
  console.log(`Prepared offline runtime: ${destination}`);
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
