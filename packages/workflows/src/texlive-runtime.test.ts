import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { ManuscriptStore } from "@litagent/library";
import { TexLiveCompiler, glossarySteps } from "./texlive-runtime";

it("builds fixed makeindex commands from safe generated glossary declarations", () => {
  const steps = glossarySteps("\\@newglossary{acronym}{alg}{acr}{acn}\n\\@newglossary{main}{glg}{gls}{glo}\n\\@newglossary{acronym}{alg}{acr}{acn}", "main");
  expect(steps).toHaveLength(2);
  expect(steps[0]).toMatchObject({ command: "/usr/bin/makeindex", args: ["-s", "/output/main.ist", "-t", "/output/main.alg", "-o", "/output/main.acr", "/output/main.acn"] });
  expect(glossarySteps("system('touch secret');\\@newglossary{x}{../../secret}{gls}{glo}", "main")).toEqual([]);
  expect(() => glossarySteps("\\@newglossary{x}{log}{tex}{aux}", "main")).toThrow("Unsupported glossary");
});

it.runIf(process.platform === "linux" && process.arch === "x64")("rejects damaged or symlinked runtime files before executing a compiler", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-runtime-integrity-"));
  try {
    fs.mkdirSync(path.join(root, "research"));
    const store = new ManuscriptStore(path.join(root, "research"));
    const document = store.create({ name: "Integrity test" });
    fs.mkdirSync(path.join(root, "rootfs/usr/bin"), { recursive: true });
    for (const name of ["xetex", "biber"]) fs.writeFileSync(path.join(root, "rootfs/usr/bin", name), "not executable");
    const checksum = createHash("sha256").update("not executable").digest("hex");
    const manifest = { schema: 1, platform: "linux", arch: "x64", version: "synthetic", biberVersion: "synthetic", files: { "usr/bin/xetex": checksum, "usr/bin/biber": "0".repeat(64) } };
    fs.writeFileSync(path.join(root, "manifest.json"), JSON.stringify(manifest));
    const compiler = new TexLiveCompiler(root, process.execPath, process.execPath);
    await expect(compiler.compile(document, new AbortController().signal)).rejects.toThrow("integrity check");
    manifest.files["usr/bin/biber"] = checksum;
    fs.writeFileSync(path.join(root, "manifest.json"), JSON.stringify(manifest));
    fs.symlinkSync(root, path.join(root, "rootfs/escape"));
    await expect(compiler.compile(document, new AbortController().signal)).rejects.toThrow("links");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

it.runIf(process.env.LITAGENT_TEST_TEXLIVE === "1")("builds bundled fonts, Biber and glossaries without host TeX or imported scripts", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-fulltex-test-"));
  try {
    const store = new ManuscriptStore(root);
    let document = store.create({ name: "Synthetic full TeX project" });
    const content = String.raw`\documentclass{report}
\usepackage{fontspec}
\setmainfont{Liberation Sans}
\setmonofont{Liberation Mono}
\usepackage[backend=biber,style=ieee]{biblatex}
\addbibresource{references.bib}
\usepackage[acronym,nomain]{glossaries-extra}
\makeglossaries
\newacronym{sdk}{SDK}{software development kit}
\begin{document}
\tableofcontents
\include{chapters/study}
\printglossary[type=acronym]
\printbibliography
\end{document}`;
    const chapter = String.raw`
\chapter{Synthetic study}
\gls{sdk}. A citation \cite{fixture}. \texttt{Bundled monospace.}
`;
    for (const [name, text] of Object.entries({ "main.tex": content, "chapters/study.tex": chapter, "references.bib": "@article{fixture,author={Researcher, Alex},title={Synthetic bibliography entry},journal={Testing},year={2026}}" })) {
      store.writeFile(document.id, { path: name, content: text, expectedRevision: document.files.find((file) => file.path === name)?.revision ?? null });
    }
    document = store.read(document.id);
    document = store.uploadFile(document.id, "latexmkrc", Buffer.from("die 'IMPORTED SCRIPT EXECUTED';"), document.treeRevision!);
    const compiler = new TexLiveCompiler();
    expect(compiler.status().available).toBe(true);
    const result = await compiler.compile(document, new AbortController().signal);
    expect(result.pdf?.subarray(0, 5).toString(), result.log).toBe("%PDF-");
    expect(result.log).toContain("[Biber bibliography]"); expect(result.log).toContain("[Glossary (acn)]");
    expect(result.log).toContain("[PDF generation]"); expect(result.log).not.toContain("IMPORTED SCRIPT EXECUTED");
    expect(result.log.slice(result.log.lastIndexOf("[XeLaTeX pass"))).not.toContain("Please (re)run Biber");
    fs.writeFileSync(path.join(root, "full.pdf"), result.pdf!);
    const text = execFileSync("pdftotext", [path.join(root, "full.pdf"), "-"], { encoding: "utf8" });
    expect(text).toContain("Synthetic bibliography entry"); expect(text).toContain("software development kit");
    const empty = await compiler.compile(store.create({ name: "Uncited bibliography" }), new AbortController().signal);
    expect(empty.pdf?.subarray(0, 5).toString(), empty.log).toBe("%PDF-");
    expect(empty.log).not.toContain("[BibTeX bibliography]");
    const replacement = (text: string) => ({ ...document, files: document.files.map((file) => file.path === "main.tex" ? { ...file, content: text } : file) });
    const bibtex = await compiler.compile(replacement(String.raw`\documentclass{article}\begin{document}\cite{fixture}\bibliographystyle{plain}\bibliography{references}\end{document}`), new AbortController().signal);
    expect(bibtex.pdf?.subarray(0, 5).toString(), bibtex.log).toBe("%PDF-"); expect(bibtex.log).toContain("[BibTeX bibliography]");
    const privateFile = path.join(root, "private.tex"); fs.writeFileSync(privateFile, "PRIVATE-CONTENT");
    const denied = await compiler.compile(replacement(`\\documentclass{article}\n\\begin{document}\n\\input{${privateFile}}\\end{document}`), new AbortController().signal);
    expect(denied.pdf).toBeNull(); expect(denied.log).not.toContain("PRIVATE-CONTENT");
    const shell = await compiler.compile(replacement(String.raw`\documentclass{article}\begin{document}\immediate\write18{touch /work/out/unrestricted}Safe\end{document}`), new AbortController().signal);
    expect(shell.pdf?.subarray(0, 5).toString(), shell.log).toBe("%PDF-");
    const controller = new AbortController();
    const pending = compiler.compile(replacement("\\documentclass{article}\\begin{document}\\loop\\iftrue\\repeat\\end{document}"), controller.signal);
    setTimeout(() => controller.abort(), 1500);
    await expect(pending).rejects.toThrow();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}, 300_000);
