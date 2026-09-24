import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { zipSync, strToU8 } from "fflate";
import { afterEach, expect, it, vi } from "vitest";
import { inspectManuscriptZip } from "./manuscript-import";
import { ManuscriptStore } from "./manuscripts";

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); roots.splice(0).forEach((root) => fs.rmSync(root, { force: true, recursive: true })); });
const archive = (files: Record<string, string | Uint8Array>) => Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, typeof value === "string" ? strToU8(value) : value]))));
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-import-")); roots.push(root);
  return { root, store: new ManuscriptStore(root) };
}
const contents = { "Thesis/main.tex": "\\documentclass{custom}\n\\begin{document}\\input{chapters/intro}\\end{document}", "Thesis/chapters/intro.tex": "Imported chapter", "Thesis/custom.cls": "\\LoadClass{article}", "Thesis/references.bib": "@article{example,title={Fixture}}", "Thesis/figures/example.png": new Uint8Array([1, 2, 3]), "Thesis/empty/": new Uint8Array(), "Thesis/main.aux": "generated", "Thesis/main.pdf": "generated", "__MACOSX/._main.tex": "metadata" };

it("inspects nested Overleaf sources, styles, figures, empty folders and omitted build outputs", async () => {
  const result = await inspectManuscriptZip(archive(contents));
  expect(result.preview).toMatchObject({ rootFolder: "Thesis", suggestedEntry: "main.tex", entryCandidates: ["chapters/intro.tex", "main.tex"] });
  expect(result.preview.files.map((file) => file.path)).toEqual(["chapters/intro.tex", "custom.cls", "figures/example.png", "main.tex", "references.bib"]);
  expect(result.preview.folders).toEqual(["chapters", "empty", "figures"]);
  expect(result.preview.skipped).toHaveLength(3);
  expect(result.contents.get("figures/example.png")).toEqual(Buffer.from([1, 2, 3]));
});

it("requires explicit choice when several TeX entry files are plausible", async () => {
  const result = await inspectManuscriptZip(archive({ "paper.tex": "\\documentclass{article}", "slides.tex": "\\documentclass{beamer}" }));
  expect(result.preview.suggestedEntry).toBeNull();
  const { store } = fixture();
  expect(() => store.importDocument({ requestId: randomUUID(), name: "Import", entryFile: "missing.tex" }, result)).toThrow(/main TeX file/);
});

it("imports atomically with initial file history and retry deduplication without replacing documents", async () => {
  const { store, root } = fixture();
  const old = store.create({ name: "Existing" });
  const result = await inspectManuscriptZip(archive(contents));
  const request = { requestId: randomUUID(), name: "Imported", entryFile: "main.tex" };
  const document = store.importDocument(request, result);
  expect(store.importDocument(request, result).id).toBe(document.id);
  expect(() => store.importDocument({ ...request, name: "Changed" }, result)).toThrow(/already used/);
  expect(store.list()).toHaveLength(2);
  expect(store.read(old.id)).toEqual(old);
  const history = store.history(document.id, "chapters/intro.tex");
  expect(history[0]?.label).toBe("Imported source");
  expect(store.historicalFile(document.id, "chapters/intro.tex", history[0]!.id).content).toBe("Imported chapter");
  expect(store.asset(document.id, "figures/example.png", document.assets![0]!.revision)).toEqual(Buffer.from([1, 2, 3]));
  expect(fs.readFileSync(path.join(root, "manuscripts", document.id, "custom.cls"), "utf8")).toBe("\\LoadClass{article}");
});

it("leaves no published or temporary document when publication fails", async () => {
  const { store, root } = fixture();
  const result = await inspectManuscriptZip(archive(contents));
  vi.spyOn(fs, "renameSync").mockImplementation(() => { throw new Error("Disk failure"); });
  expect(() => store.importDocument({ requestId: randomUUID(), name: "Import", entryFile: "main.tex" }, result)).toThrow("Disk failure");
  expect(store.list()).toEqual([]);
  expect(fs.readdirSync(path.join(root, "manuscripts"))).toEqual([]);
});

it("rejects traversal, duplicates, case collisions, file/folder clashes and invalid UTF-8", async () => {
  for (const files of [
    { "../bad.tex": "bad" }, { "/main.tex": "bad" }, { "a\\main.tex": "bad" },
    { "Main.tex": "a", "main.tex": "b" }, { "part.tex": "a", "part.tex/chapter.tex": "b" },
    { "main.tex": new Uint8Array([0xff, 0xfe]) }
  ]) await expect(inspectManuscriptZip(archive(files))).rejects.toThrow();
  const duplicate = archive({ "main.tex": "a", "else.tex": "b" });
  // Same-length substitution in local and central names creates a duplicate entry.
  for (let at = duplicate.indexOf("else.tex"); at !== -1; at = duplicate.indexOf("else.tex")) duplicate.write("main.tex", at);
  await expect(inspectManuscriptZip(duplicate)).rejects.toThrow(/Duplicate/);
});

it("rejects links, encrypted entries, corrupt CRC and inflated size claims before publication", async () => {
  const mutate = (edit: (bytes: Buffer, header: number) => void) => { const data = archive({ "main.tex": "Hello" }); const header = data.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); edit(data, header); return data; };
  await expect(inspectManuscriptZip(mutate((bytes, at) => bytes.writeUInt32LE((0xa1ff * 65536) >>> 0, at + 38)))).rejects.toThrow(/Links/);
  await expect(inspectManuscriptZip(mutate((bytes, at) => bytes.writeUInt16LE(1, at + 8)))).rejects.toThrow(/Encrypted/);
  await expect(inspectManuscriptZip(mutate((bytes, at) => bytes.writeUInt32LE(0, at + 16)))).rejects.toThrow(/integrity/);
  await expect(inspectManuscriptZip(mutate((bytes, at) => bytes.writeUInt32LE(1_000_001, at + 24)))).rejects.toThrow(/size limit/);
  await expect(inspectManuscriptZip(archive({ "main.tex": "x".repeat(1_000_001) }))).rejects.toThrow(/size limit/);
});

it("reports external compiler dependencies without executing imported scripts", async () => {
  const result = await inspectManuscriptZip(archive({ "main.tex": "\\documentclass{custom}\n\\usepackage[backend=biber]{biblatex}\n\\makeglossaries", "custom.cls": "\\setmainfont{Example}", "latexmkrc": "system('do-not-run')", "scripts/build.py": "raise RuntimeError()" }));
  expect(result.preview.warnings).toHaveLength(4);
  expect(result.contents.get("latexmkrc")?.toString()).toContain("do-not-run");
});

it("creates folders, moves a chapter tree with history, and preserves deletion history", async () => {
  const { store } = fixture();
  let document = store.importDocument({ requestId: randomUUID(), name: "Tree", entryFile: "main.tex" }, await inspectManuscriptZip(archive(contents)));
  const oldHistory = store.history(document.id, "chapters/intro.tex")[0]!;
  document = store.changeTree(document.id, { action: "folder", path: "drafts/review", expectedRevision: document.treeRevision });
  document = store.changeTree(document.id, { action: "move", path: "chapters", destination: "drafts/sections", expectedRevision: document.treeRevision });
  expect(document.files.some((file) => file.path === "drafts/sections/intro.tex")).toBe(true);
  expect(store.historicalFile(document.id, "drafts/sections/intro.tex", oldHistory.id).content).toBe("Imported chapter");
  document = store.changeTree(document.id, { action: "delete", path: "drafts", expectedRevision: document.treeRevision });
  expect(document.folders).not.toContain("drafts");
  expect(store.history(document.id, "drafts/sections/intro.tex")[0]?.reason).toBe("deleted");
  expect(store.restore(document.id, { path: "drafts/sections/intro.tex", versionId: oldHistory.id, expectedRevision: null }).content).toBe("Imported chapter");
});

it("guards stale tree changes, main-file deletion, recursive moves and destination collisions", async () => {
  const { store } = fixture();
  let document = store.create({ name: "Tree" });
  const stale = document.treeRevision;
  document = store.changeTree(document.id, { action: "entry", path: "sections/introduction.tex", expectedRevision: stale });
  expect(() => store.changeTree(document.id, { action: "folder", path: "new", expectedRevision: stale })).toThrow(/changed elsewhere/);
  expect(() => store.changeTree(document.id, { action: "delete", path: "sections", expectedRevision: document.treeRevision })).toThrow(/main file/);
  expect(() => store.changeTree(document.id, { action: "move", path: "sections", destination: "sections/inner", expectedRevision: document.treeRevision })).toThrow(/inside itself/);
  expect(() => store.changeTree(document.id, { action: "move", path: "main.tex", destination: "references.bib", expectedRevision: document.treeRevision })).toThrow();
  document = store.changeTree(document.id, { action: "move", path: "sections", destination: "chapters", expectedRevision: document.treeRevision });
  expect(document.entryFile).toBe("chapters/introduction.tex");
});

it("reconciles an interrupted move after its filesystem rename without losing history", () => {
  const { store } = fixture();
  const document = store.create({ name: "Tree" });
  const rename = fs.renameSync.bind(fs);
  vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
    if (String(to).endsWith("manuscript.json")) throw new Error("Interrupted");
    rename(from, to);
  });
  expect(() => store.changeTree(document.id, { action: "move", path: "main.tex", destination: "paper.tex", expectedRevision: document.treeRevision })).toThrow("Interrupted");
  vi.restoreAllMocks();
  expect(store.read(document.id).entryFile).toBe("paper.tex");
  expect(store.history(document.id, "paper.tex")).toHaveLength(1);
  expect(store.read(document.id).files.some((file) => file.path === "main.tex")).toBe(false);
});

it("uploads figures and text, validates revisions, and prevents replacing files or following symlinks", () => {
  const { store, root } = fixture();
  let document = store.create({ name: "Upload" });
  document = store.uploadFile(document.id, "figures/example.png", Buffer.from([1, 2]), document.treeRevision!);
  expect(() => store.asset(document.id, "figures/example.png", "0".repeat(64))).toThrow(/changed/);
  expect(() => store.uploadFile(document.id, "main.tex", Buffer.from("Overwrite"), document.treeRevision!)).toThrow(/Conflicting/);
  document = store.uploadFile(document.id, "notes/review.txt", Buffer.from("Note"), document.treeRevision!);
  expect(store.history(document.id, "notes/review.txt")).toHaveLength(1);
  fs.symlinkSync(root, path.join(root, "manuscripts", document.id, "linked"));
  expect(() => store.changeTree(document.id, { action: "folder", path: "linked/escape", expectedRevision: document.treeRevision })).toThrow(/links/);
});
