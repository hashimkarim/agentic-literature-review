import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { LitAgentRepository, ManuscriptError, ManuscriptStore } from "./index";

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })); });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-writing-"));
  roots.push(root);
  const repo = new LitAgentRepository(root);
  repo.init();
  const project = repo.createProject({ name: "Writing fixtures" });
  const store = new ManuscriptStore(root);
  const document = store.create(project.id, { name: "My paper" });
  const main = document.files.find((file) => file.path === "main.tex")!;
  const directory = path.join(root, "projects", project.id, "manuscripts", document.id);
  return { root, repo, store, projectId: project.id, document, main, directory };
}

it("creates a project-owned multi-file TeX manuscript and reopens canonical files", () => {
  const f = fixture();
  expect(f.store.list(f.projectId)).toMatchObject([{ name: "My paper", entryFile: "main.tex" }]);
  expect(f.document.files.map((file) => file.path)).toEqual(["main.tex", "references.bib", "sections/introduction.tex"]);
  expect(f.main.content).toContain("\\input{sections/introduction}");
  expect(new ManuscriptStore(f.root).read(f.projectId, f.document.id)).toEqual(f.document);
  expect(fs.readFileSync(path.join(f.directory, "main.tex"), "utf8")).toEqual(f.main.content);
});

it("saves one file atomically, keeps independent files and supports identical retries", () => {
  const f = fixture();
  const request = { path: f.main.path, content: "\\section{Results}\nMeasured result.", expectedRevision: f.main.revision };
  const saved = f.store.writeFile(f.projectId, f.document.id, request);
  expect(saved.revision).not.toEqual(f.main.revision);
  expect(f.store.writeFile(f.projectId, f.document.id, request)).toEqual(saved);
  expect(f.store.read(f.projectId, f.document.id).files.find((file) => file.path === "references.bib")?.content).toBe("");
});

it("rejects stale writes and externally edited sources without losing either version", () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.directory, "main.tex"), "External changes");
  expect(() => f.store.writeFile(f.projectId, f.document.id, { path: f.main.path, content: "Browser changes", expectedRevision: f.main.revision }))
    .toThrow(expect.objectContaining({ status: 409, code: "manuscript_file_changed" }));
  expect(f.store.read(f.projectId, f.document.id).files.find((file) => file.path === f.main.path)?.content).toBe("External changes");
});

it("preserves the old file if atomic replacement fails and removes temporary data", () => {
  const f = fixture();
  vi.spyOn(fs, "renameSync").mockImplementation(() => { throw new Error("Disk failure"); });
  expect(() => f.store.writeFile(f.projectId, f.document.id, { path: f.main.path, content: "New", expectedRevision: f.main.revision })).toThrow("Disk failure");
  expect(fs.readFileSync(path.join(f.directory, "main.tex"), "utf8")).toBe(f.main.content);
  expect(fs.readdirSync(f.directory).some((name) => name.endsWith(".tmp"))).toBe(false);
});

it("creates nested files and guards deletion including the main entry", () => {
  const f = fixture();
  const file = f.store.writeFile(f.projectId, f.document.id, { path: "sections/methods.tex", content: "\\section{Methods}", expectedRevision: null });
  expect(() => f.store.deleteFile(f.projectId, f.document.id, { path: file.path, expectedRevision: f.main.revision })).toThrow(ManuscriptError);
  f.store.deleteFile(f.projectId, f.document.id, { path: file.path, expectedRevision: file.revision });
  expect(f.store.read(f.projectId, f.document.id).files.some((item) => item.path === file.path)).toBe(false);
  expect(() => f.store.deleteFile(f.projectId, f.document.id, { path: f.main.path, expectedRevision: f.main.revision })).toThrow(/entry file/);
});

it("rejects traversal, absolute paths, unsupported extensions and portable case collisions", () => {
  const f = fixture();
  for (const target of ["../escape.tex", "/tmp/escape.tex", "sections/../../escape.tex", "sections\\escape.tex", ".hidden.tex", "script.sh"]) {
    expect(() => f.store.writeFile(f.projectId, f.document.id, { path: target, content: "Bad", expectedRevision: null })).toThrow();
  }
  expect(() => f.store.writeFile(f.projectId, f.document.id, { path: "Main.tex", content: "Bad", expectedRevision: null })).toThrow(/capitalization/);
  expect(() => f.store.list("../other")).toThrow();
});

it("refuses symlinks in files, nested directories and project ancestors", () => {
  const f = fixture();
  const outside = path.join(f.root, "outside.tex");
  fs.writeFileSync(outside, "Private");
  fs.symlinkSync(outside, path.join(f.directory, "linked.tex"));
  expect(() => f.store.read(f.projectId, f.document.id)).toThrow(/links/);
  fs.unlinkSync(path.join(f.directory, "linked.tex"));
  fs.symlinkSync(f.root, path.join(f.directory, "escape"), "dir");
  expect(() => f.store.writeFile(f.projectId, f.document.id, { path: "escape/new.tex", content: "Bad", expectedRevision: null })).toThrow(/links/);
  fs.symlinkSync(path.join(f.root, "projects", f.projectId), path.join(f.root, "projects", "linked"), "dir");
  expect(() => f.store.list("linked")).toThrow(/links/);
  expect(fs.readFileSync(outside, "utf8")).toBe("Private");
});

it("isolates projects and refuses mismatched manifest identities", () => {
  const f = fixture();
  const other = f.repo.createProject({ name: "Other" });
  expect(f.store.list(other.id)).toEqual([]);
  expect(() => f.store.read(other.id, f.document.id)).toThrow(/not found/);
  expect(() => f.store.create("missing", { name: "No project" })).toThrow(/Project not found/);
  fs.writeFileSync(path.join(f.directory, "manuscript.json"), JSON.stringify({ ...f.document, projectId: other.id }));
  expect(() => f.store.read(f.projectId, f.document.id)).toThrow(/identity/);
});

it("enforces UTF-8 byte limits and never truncates oversized sources", () => {
  const f = fixture();
  expect(() => f.store.writeFile(f.projectId, f.document.id, { path: "big.tex", content: "\u00e9".repeat(130_000), expectedRevision: null })).toThrow(/limit/);
  fs.writeFileSync(path.join(f.directory, "big.tex"), "x".repeat(250_001));
  expect(() => f.store.read(f.projectId, f.document.id)).toThrow(/limit/);
});

it("cleans failed creations and does not list an interrupted uncommitted manifest", () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.directory, "..", "manuscript_0000000000000000"));
  expect(f.store.list(f.projectId)).toHaveLength(1);
  vi.spyOn(fs, "renameSync").mockImplementation(() => { throw new Error("Disk failure"); });
  expect(() => f.store.create(f.projectId, { name: "Failed" })).toThrow("Disk failure");
  expect(f.store.list(f.projectId)).toHaveLength(1);
});

it("retains automatic text history and named checkpoints without Git commits", () => {
  const f = fixture();
  const initial = f.store.history(f.projectId, f.document.id, f.main.path)[0]!;
  expect(initial.reason).toBe("created");
  const file = f.store.writeFile(f.projectId, f.document.id, { path: f.main.path, content: "Draft two", expectedRevision: f.main.revision });
  f.store.checkpoint(f.projectId, f.document.id, { path: file.path, expectedRevision: file.revision, label: "Before review" });
  const history = new ManuscriptStore(f.root).history(f.projectId, f.document.id, f.main.path);
  expect(history.map((entry) => entry.reason)).toEqual(["checkpoint", "saved", "created"]);
  expect(history[0]?.label).toBe("Before review");
  expect(f.store.historicalFile(f.projectId, f.document.id, f.main.path, initial.id).content).toBe(f.main.content);
  expect(f.store.read(f.projectId, f.document.id).files).toHaveLength(3);
});

it("restores as a new revision, retains the replaced text and rejects stale restores", () => {
  const f = fixture();
  const versionId = f.store.history(f.projectId, f.document.id, f.main.path)[0]!.id;
  const saved = f.store.writeFile(f.projectId, f.document.id, { path: f.main.path, content: "New writing", expectedRevision: f.main.revision });
  expect(() => f.store.restore(f.projectId, f.document.id, { path: f.main.path, versionId, expectedRevision: "0".repeat(64) })).toThrow(/changed/);
  expect(f.store.restore(f.projectId, f.document.id, { path: f.main.path, versionId, expectedRevision: saved.revision })).toEqual(f.main);
  const history = f.store.history(f.projectId, f.document.id, f.main.path);
  expect(history[0]?.reason).toBe("restored");
  expect(f.store.historicalFile(f.projectId, f.document.id, f.main.path, history[1]!.id).content).toBe("New writing");
});

it("captures external edits before replacing them and retains deleted file contents", () => {
  const f = fixture();
  const localPath = path.join(f.directory, "sections/introduction.tex");
  fs.writeFileSync(localPath, "Edited outside the app");
  const external = f.store.read(f.projectId, f.document.id).files.find((file) => file.path === "sections/introduction.tex")!;
  const changed = f.store.writeFile(f.projectId, f.document.id, { path: external.path, content: "Next draft", expectedRevision: external.revision });
  expect(f.store.history(f.projectId, f.document.id, external.path).map((entry) => entry.reason)).toEqual(["saved", "external", "created"]);
  f.store.deleteFile(f.projectId, f.document.id, { path: changed.path, expectedRevision: changed.revision });
  const old = f.store.history(f.projectId, f.document.id, external.path)[0]!;
  expect(old.reason).toBe("deleted");
  expect(f.store.restore(f.projectId, f.document.id, { path: old.path, versionId: old.id, expectedRevision: null }).content).toBe("Next draft");
});

it("validates history identity and blob integrity before restoring", () => {
  const f = fixture();
  const entry = f.store.history(f.projectId, f.document.id, f.main.path)[0]!;
  expect(() => f.store.historicalFile(f.projectId, f.document.id, "references.bib", entry.id)).toThrow(/not found/);
  fs.writeFileSync(path.join(f.directory, ".history/blobs", `${entry.revision}.json`), JSON.stringify("Tampered history"));
  expect(() => f.store.restore(f.projectId, f.document.id, { path: f.main.path, versionId: entry.id, expectedRevision: f.main.revision })).toThrow(/integrity/);
  expect(fs.readFileSync(path.join(f.directory, "main.tex"), "utf8")).toBe(f.main.content);
});
