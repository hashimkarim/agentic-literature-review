import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { afterEach, expect, it } from "vitest";
import { ManuscriptStore } from "@litagent/library";
import type { ManuscriptDocument } from "@litagent/contracts";
import { TexBuildService, texDiagnostics } from "./tex-builds";
import { TectonicCompiler, type TexCompiler } from "./tex-runtime";
import { sourceBoxes } from "./tex-source-map";

const roots: string[] = [];
afterEach(() => { roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })); });
function fixture(compile: TexCompiler["compile"] = async () => ({ log: "", pdf: Buffer.from("%PDF-1.7\nsynthetic") })) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-tex-test-")); roots.push(root);
  const store = new ManuscriptStore(root);
  const document = store.create({ name: "Build test" });
  const compiler: TexCompiler = { status: () => ({ available: true, version: "fixture", message: "synthetic" }), compile };
  return { root, store, document, compiler, service: new TexBuildService(store, compiler) };
}
const request = (document: ManuscriptDocument) => ({ requestId: randomUUID(), entryFile: document.entryFile, revisions: Object.fromEntries([...document.files, ...(document.assets ?? [])].map((file) => [file.path, file.revision])) });

it("persists source mapping with the build, rejects stale PDF comments and reuses canonical threads", async () => {
  const synctex = gzipSync("SyncTeX Version:1\nInput:1:/work/main.tex\nOutput:pdf\nMagnification:1000\nUnit:1\nX Offset:0\nY Offset:0\nContent:\n{1\n(1,1:0,6578176:6578176,657818,0\n)\n}1\nPostamble:\n");
  const f = fixture(async () => ({ log: "", pdf: Buffer.from("%PDF-synthetic"), synctex }));
  const first = request(f.document);
  f.service.start(f.document.id, first); await f.service.idle();
  const reopened = new TexBuildService(f.store, f.compiler);
  expect(reopened.sourceMap(f.document.id, first.requestId).boxes).toHaveLength(1);
  const click = { page: 1, rects: [{ x: 10, y: 91, width: 10, height: 8 }], quote: "Rendered selection" };
  const selection = reopened.pdfCommentSelection(f.document.id, first.requestId, click);
  const comment = f.store.createComment(f.document.id, { requestId: randomUUID(), selection, body: "PDF-created comment" });
  expect(f.store.comments(f.document.id)[0]!.id).toBe(comment.id);
  expect(comment.location?.state).toBe("attached");
  f.store.writeFile(f.document.id, { path: "main.tex", expectedRevision: selection.revision, content: "New source revision" });
  expect(() => reopened.pdfCommentSelection(f.document.id, first.requestId, click)).toThrow("earlier revision");
  expect(() => reopened.sourceMap(f.document.id, "../../etc/passwd")).toThrow("No source map");
  reopened.start(f.document.id, request(f.store.read(f.document.id))); await reopened.idle();
  expect(fs.existsSync(path.join(f.root, ".litagent/tex-builds", f.document.id, `${first.requestId}.map.json`))).toBe(false);
  expect(f.store.comments(f.document.id)[0]!.messages[0]!.body).toBe("PDF-created comment");
});

it("keeps a valid PDF when mapping is absent or malformed without claiming comments can be mapped", async () => {
  const f = fixture(async () => ({ log: "", pdf: Buffer.from("%PDF-synthetic"), synctex: Buffer.from("invalid") }));
  const input = request(f.document); f.service.start(f.document.id, input); await f.service.idle();
  expect(f.service.get(f.document.id).latest?.status).toBe("succeeded");
  expect(f.service.get(f.document.id).latest?.diagnostics[0]?.message).toContain("source map is unavailable");
  expect(() => f.service.sourceMap(f.document.id, input.requestId)).toThrow("Compile again");
});

it("snapshots binary assets and rejects stale assets or main-file selection", async () => {
  let copied: Buffer | undefined;
  const f = fixture(async (snapshot) => { copied = snapshot.assetContents?.[0]?.bytes; return { log: "", pdf: Buffer.from("%PDF-fixture") }; });
  let document = f.store.uploadFile(f.document.id, "figures/test.png", Buffer.from([1, 2]), f.document.treeRevision!);
  const input = request(document);
  f.service.start(document.id, input); await f.service.idle();
  expect(copied).toEqual(Buffer.from([1, 2]));
  expect(f.service.get(document.id).latest?.revisions["figures/test.png"]).toBe(document.assets![0]!.revision);
  document = f.store.changeTree(document.id, { action: "entry", path: "sections/introduction.tex", expectedRevision: document.treeRevision });
  expect(() => f.service.start(document.id, { ...input, requestId: randomUUID() })).toThrow(/Saved sources changed/);
  fs.writeFileSync(path.join(f.root, "manuscripts", document.id, "figures/test.png"), Buffer.from([3]));
  expect(() => f.service.start(document.id, request(document))).toThrow(/Saved sources changed/);
});

it("compiles an immutable revision-checked snapshot, deduplicates retries and persists the PDF", async () => {
  let snapshot: ManuscriptDocument | undefined;
  let finish!: (value: { log: string; pdf: Buffer }) => void;
  const f = fixture((document) => { snapshot = document; return new Promise((resolve) => { finish = resolve; }); });
  const input = request(f.document);
  expect(f.service.start(f.document.id, input).latest?.status).toBe("running");
  expect(f.service.start(f.document.id, input).latest?.id).toBe(input.requestId);
  const main = f.document.files.find((file) => file.path === "main.tex")!;
  f.store.writeFile(f.document.id, { path: main.path, content: "Changed while compiling", expectedRevision: main.revision });
  expect(snapshot?.files.find((file) => file.path === "main.tex")?.content).toBe(main.content);
  expect(() => f.service.start(f.document.id, { ...input, revisions: { "main.tex": "a".repeat(64) } })).toThrow("cannot be reused");
  finish({ log: "warning: main.tex:8: Synthetic warning", pdf: Buffer.from("%PDF-1.7\nsynthetic") });
  await f.service.idle();
  const reopened = new TexBuildService(f.store, f.compiler);
  expect(reopened.get(f.document.id).lastSuccessful?.id).toBe(input.requestId);
  expect(reopened.pdf(f.document.id, input.requestId).toString()).toContain("%PDF-");
  expect(() => reopened.start(f.document.id, request(f.document))).toThrow("Saved sources changed");
  expect(() => reopened.pdf(f.document.id, randomUUID())).toThrow("No PDF");
});

it("keeps the last successful PDF after failure, cancellation, and interrupted server restart", async () => {
  const f = fixture();
  const first = request(f.document);
  f.service.start(f.document.id, first); await f.service.idle();
  f.compiler.compile = async () => ({ log: "error: sections/introduction.tex:3: Undefined control sequence", pdf: null });
  f.service.start(f.document.id, request(f.document)); await f.service.idle();
  expect(f.service.get(f.document.id)).toMatchObject({ latest: { status: "failed", diagnostics: [{ path: "sections/introduction.tex", line: 3 }] }, lastSuccessful: { id: first.requestId } });
  f.compiler.compile = (_document, signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  const cancelled = request(f.document);
  f.service.start(f.document.id, cancelled);
  expect(() => f.service.start(f.document.id, request(f.document))).toThrow("Another document");
  f.service.cancel(f.document.id, cancelled.requestId); await f.service.idle();
  expect(f.service.get(f.document.id).latest?.status).toBe("cancelled");
  expect(f.service.pdf(f.document.id, first.requestId).length).toBeGreaterThan(5);
  const statePath = path.join(f.root, ".litagent/tex-builds", f.document.id, "state.json");
  const saved = JSON.parse(fs.readFileSync(statePath, "utf8")); saved.latest.status = "running"; saved.latest.finishedAt = null;
  fs.writeFileSync(statePath, JSON.stringify(saved));
  expect(new TexBuildService(f.store, f.compiler).get(f.document.id).latest?.status).toBe("interrupted");
  expect(f.store.read(f.document.id).files).toEqual(f.document.files);
});

it("fails closed for unavailable compilers, symlink caches and invalid output", async () => {
  const f = fixture(async () => ({ log: "", pdf: Buffer.from("not a PDF") }));
  f.service.start(f.document.id, request(f.document)); await f.service.idle();
  expect(f.service.get(f.document.id)).toMatchObject({ latest: { status: "failed" }, lastSuccessful: null });
  f.compiler.status = () => ({ available: false, version: null, message: "Not packaged" });
  expect(() => f.service.start(f.document.id, request(f.document))).toThrow("Not packaged");
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-tex-outside-")); roots.push(outside);
  fs.rmSync(path.join(f.root, ".litagent/tex-builds"), { recursive: true });
  fs.symlinkSync(outside, path.join(f.root, ".litagent/tex-builds"));
  expect(() => f.service.get(f.document.id)).toThrow("symbolic links");
  expect(fs.readdirSync(outside)).toEqual([]);
});

it("only links diagnostics to manuscript files and bounds malformed logs", () => {
  expect(texDiagnostics("error: /work/sections/a.tex:12: Bad macro\nwarning: /etc/secret.tex:99: Denied", ["sections/a.tex"])).toEqual([
    { severity: "error", message: "Bad macro", path: "sections/a.tex", line: 12 },
    { severity: "warning", message: "Denied", path: null, line: null }
  ]);
  expect(texDiagnostics("error: Bad\n".repeat(500), []).length).toBe(100);
  expect(texDiagnostics(`error: main.tex:${"9".repeat(400)}: Bad`, ["main.tex"])[0]?.line).toBeNull();
});

it("maps native XeLaTeX errors and ignores warnings resolved by later passes", () => {
  const log = "[XeLaTeX pass 1]\nLaTeX Warning: Citation undefined.\n[XeLaTeX pass 2]\n/work/chapters/intro.tex:13: Undefined control sequence.\nERROR - Bibliography failed\nwarning: Output limited";
  expect(texDiagnostics(log, ["chapters/intro.tex"])).toEqual([
    { severity: "error", path: "chapters/intro.tex", line: 13, message: "Undefined control sequence." },
    { severity: "error", path: null, line: null, message: "Bibliography failed" },
    { severity: "warning", path: null, line: null, message: "Output limited" }
  ]);
});

it("persists compiler phases while keeping source snapshots and last-good output unchanged", async () => {
  let progress!: (phase: string) => void;
  let finish!: (value: { log: string; pdf: Buffer }) => void;
  const f = fixture((_document, _signal, report) => { progress = report!; return new Promise((resolve) => { finish = resolve; }); });
  f.service.start(f.document.id, request(f.document));
  progress("Biber bibliography");
  expect(f.service.get(f.document.id).latest).toMatchObject({ status: "running", phase: "Biber bibliography" });
  finish({ log: "", pdf: Buffer.from("%PDF-synthetic") }); await f.service.idle();
  expect(f.service.get(f.document.id).latest?.status).toBe("succeeded");
  expect(f.store.read(f.document.id).files).toEqual(f.document.files);
});

it("retains a failed status when the warning limit is already full", async () => {
  const f = fixture(async () => ({ log: "warning: Warning\n".repeat(200), pdf: null }));
  f.service.start(f.document.id, request(f.document)); await f.service.idle();
  const result = f.service.get(f.document.id);
  expect(result.latest?.status).toBe("failed");
  expect(result.latest?.diagnostics).toHaveLength(100);
  expect(result.latest?.diagnostics.at(-1)?.severity).toBe("error");
});

it.runIf(process.env.LITAGENT_TEST_TEX === "1")("uses the prepared offline engine with real isolation, diagnostics and cancellation", async () => {
  const f = fixture();
  const engine = new TectonicCompiler();
  expect(engine.status().available).toBe(true);
  const result = await engine.compile(f.document, new AbortController().signal);
  expect(result.pdf?.subarray(0, 5).toString(), result.log).toBe("%PDF-");
  expect(result.synctex).toBeDefined();
  expect(sourceBoxes(result.synctex!, f.document).some((box) => box.path === "main.tex")).toBe(true);
  let imported = f.store.uploadFile(f.document.id, "figures/sample.pdf", result.pdf!, f.document.treeRevision!);
  imported = f.store.uploadFile(imported.id, "custom.sty", Buffer.from("\\RequirePackage{graphicx}\n\\newcommand{\\fixturetext}{Imported figure}"), imported.treeRevision!);
  f.store.writeFile(imported.id, { path: "main.tex", content: "\\documentclass{article}\n\\usepackage{custom}\n\\begin{document}\\fixturetext\\includegraphics[width=2cm]{figures/sample.pdf}\\end{document}", expectedRevision: imported.files.find((file) => file.path === "main.tex")!.revision });
  imported = f.store.read(imported.id);
  const service = new TexBuildService(f.store, engine);
  service.start(imported.id, request(imported)); await service.idle();
  expect(service.get(imported.id).latest?.status, service.get(imported.id).latest?.log).toBe("succeeded");
  const replaceMain = (content: string) => ({ ...f.document, files: f.document.files.map((file) => file.path === "main.tex" ? { ...file, content } : file) });
  const bad = await engine.compile(replaceMain("\\documentclass{article}\n\\begin{document}\n\\unknownCommand\n\\end{document}"), new AbortController().signal);
  expect(bad.pdf).toBeNull();
  expect(texDiagnostics(bad.log, ["main.tex"])).toContainEqual(expect.objectContaining({ path: "main.tex", line: 3 }));
  const secretPath = path.join(f.root, "private.tex");
  fs.writeFileSync(secretPath, "PRIVATE-CONTENT-MUST-NOT-BE-READ");
  const denied = await engine.compile(replaceMain(`\\documentclass{article}\n\\begin{document}\n\\input{${secretPath}}\n\\end{document}`), new AbortController().signal);
  expect(denied.pdf).toBeNull(); expect(denied.log).not.toContain("PRIVATE-CONTENT-MUST-NOT-BE-READ");
  const marker = path.join(f.root, "shell-ran");
  await engine.compile(replaceMain(`\\documentclass{article}\n\\begin{document}\n\\immediate\\write18{touch ${marker}} Safe text.\n\\end{document}`), new AbortController().signal);
  expect(fs.existsSync(marker)).toBe(false);
  const missing = await engine.compile(replaceMain("\\documentclass{article}\n\\usepackage{not-in-the-offline-bundle}\n\\begin{document}Test\\end{document}"), new AbortController().signal);
  expect(missing.pdf).toBeNull(); expect(missing.log).toContain("using only cached"); expect(missing.log).not.toContain("downloading");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try { await expect(engine.compile(replaceMain("\\documentclass{article}\n\\begin{document}\n\\loop\\iftrue\\repeat\n\\end{document}"), controller.signal)).rejects.toThrow(); }
  finally { clearTimeout(timer); }
  const limited = new TectonicCompiler(engine.runtime, engine.bwrap, engine.prlimit, 500);
  await expect(limited.compile(replaceMain("\\documentclass{article}\n\\begin{document}\n\\loop\\iftrue\\repeat\n\\end{document}"), new AbortController().signal)).rejects.toThrow("time limit");
}, 45_000);
