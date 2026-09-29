import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { ManuscriptStore } from "./manuscripts";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-linked-folder-")); roots.push(root);
  const repo = path.join(root, "repo"), folder = path.join(root, "paper");
  fs.mkdirSync(repo); fs.mkdirSync(folder); fs.mkdirSync(path.join(folder, "sections"));
  fs.writeFileSync(path.join(folder, "main.tex"), "\\documentclass{article}\n\\input{sections/intro}\n");
  fs.writeFileSync(path.join(folder, "sections/intro.tex"), "Initial text.");
  fs.writeFileSync(path.join(folder, "figure.png"), Buffer.from([137, 80, 78, 71]));
  const store = new ManuscriptStore(repo);
  const preview = store.previewFolder({ path: folder });
  const request = { path: folder, requestId: randomUUID(), expectedRevision: preview.revision, name: "Linked paper", entryFile: "main.tex", projectIds: [] };
  return { root, repo, folder, store, preview, request };
}

it("links sources without copying the editable tree and observes outside edits across restarts", () => {
  const f = setup(), document = f.store.attachFolder(f.request);
  expect(document).toMatchObject({ storage: "linked-folder", linkedFolder: { path: f.folder } });
  const local = path.join(f.repo, "manuscripts", document.id);
  expect(fs.existsSync(path.join(local, "main.tex"))).toBe(false);
  expect(fs.readFileSync(path.join(local, "manuscript.json"), "utf8")).not.toContain(f.folder);
  expect(fs.existsSync(path.join(f.folder, ".history"))).toBe(false);
  expect(f.store.attachFolder(f.request)).toEqual(document);
  fs.writeFileSync(path.join(f.folder, "sections/intro.tex"), "Edited externally.");
  fs.writeFileSync(path.join(f.folder, "references.bib"), "@article{new, title={New}}");
  fs.unlinkSync(path.join(f.folder, "figure.png"));
  const reopened = new ManuscriptStore(f.repo).read(document.id);
  expect(reopened.files.find((file) => file.path === "sections/intro.tex")?.content).toBe("Edited externally.");
  expect(reopened.files.map((file) => file.path)).toContain("references.bib");
  expect(reopened.assets).toEqual([]);
  expect(reopened.treeRevision).not.toBe(document.treeRevision);
  expect(f.store.history(document.id, "sections/intro.tex").map((item) => item.reason)).toEqual(["external", "external"]);
});

it("writes through with permissions and history intact, rejecting stale saves and candidate acceptance", () => {
  const f = setup(), document = f.store.attachFolder(f.request);
  const original = document.files.find((file) => file.path === "sections/intro.tex")!;
  fs.chmodSync(path.join(f.folder, original.path), 0o640);
  const saved = f.store.writeFile(document.id, { path: original.path, expectedRevision: original.revision, content: "App edit." });
  expect(fs.readFileSync(path.join(f.folder, original.path), "utf8")).toBe("App edit.");
  expect(fs.statSync(path.join(f.folder, original.path)).mode & 0o777).toBe(0o640);
  fs.writeFileSync(path.join(f.folder, original.path), "New outside edit.");
  expect(() => f.store.writeFile(document.id, { path: original.path, expectedRevision: saved.revision, content: "Stale app edit." }, "candidate"))
    .toThrow(expect.objectContaining({ code: "manuscript_file_changed" }));
  const history = f.store.history(document.id, original.path);
  expect(history.length).toBe(3);
  const initial = history.at(-1)!;
  const current = f.store.read(document.id).files.find((file) => file.path === original.path)!;
  f.store.restore(document.id, { path: original.path, versionId: initial.id, expectedRevision: current.revision });
  expect(fs.readFileSync(path.join(f.folder, original.path), "utf8")).toBe(original.content);
  expect(fs.existsSync(path.join(f.folder, ".comments"))).toBe(false);
});

it("previews only supported sources, skips generated/dependency files and rejects changed previews", () => {
  const f = setup();
  for (const dir of [".git", "build", "node_modules"]) { fs.mkdirSync(path.join(f.folder, dir)); fs.writeFileSync(path.join(f.folder, dir, "private.tex"), "Do not read"); }
  fs.writeFileSync(path.join(f.folder, "main.pdf"), "Generated PDF");
  fs.writeFileSync(path.join(f.folder, "main.aux"), "Generated");
  fs.writeFileSync(path.join(f.folder, "sections/new.tex"), "Added after preview");
  const preview = f.store.previewFolder({ path: f.folder });
  expect(preview.files.map((file) => file.path)).toEqual(["figure.png", "main.tex", "sections/intro.tex", "sections/new.tex"]);
  expect(preview.skipped).toHaveLength(5);
  expect(preview.suggestedEntry).toBe("main.tex");
  expect(() => f.store.attachFolder(f.request)).toThrow(expect.objectContaining({ code: "linked_folder_changed" }));
  const document = f.store.attachFolder({ ...f.request, expectedRevision: preview.revision });
  expect(() => f.store.attachFolder({ ...f.request, expectedRevision: preview.revision, requestId: randomUUID() })).toThrow(/already attached/);
  expect(() => f.store.changeTree(document.id, { action: "delete", path: "sections", expectedRevision: document.treeRevision })).toThrow(/file manager/);
  expect(fs.existsSync(path.join(f.folder, "sections/new.tex"))).toBe(true);
});

it("recovers a temporarily missing folder without falling back to a stale copied source", () => {
  const f = setup(), document = f.store.attachFolder(f.request), held = f.folder + "-offline";
  fs.renameSync(f.folder, held);
  expect(f.store.list()).toHaveLength(1);
  expect(() => f.store.read(document.id)).toThrow(expect.objectContaining({ code: "linked_folder_unavailable" }));
  expect(() => f.store.writeFile(document.id, { path: "main.tex", content: "Lost?", expectedRevision: document.files[0]!.revision })).toThrow();
  fs.mkdirSync(f.folder); fs.writeFileSync(path.join(f.folder, "main.tex"), "Replacement directory");
  expect(() => f.store.read(document.id)).toThrow(/replaced/);
  fs.rmSync(f.folder, { recursive: true }); fs.renameSync(held, f.folder);
  expect(new ManuscriptStore(f.repo).read(document.id)).toEqual(document);
});

it("rejects root/ancestor/descendant symlink escapes and missing machine-local links", () => {
  const f = setup(), document = f.store.attachFolder(f.request);
  fs.symlinkSync(f.folder, path.join(f.root, "alias"));
  expect(() => f.store.previewFolder({ path: path.join(f.root, "alias") })).toThrow();
  expect(() => f.store.previewFolder({ path: f.repo })).toThrow(/outside/);
  expect(() => f.store.previewFolder({ path: "/" })).toThrow();
  expect(() => f.store.previewFolder({ path: "relative" })).toThrow(/absolute/);
  fs.symlinkSync(f.repo, path.join(f.folder, "escape"));
  expect(() => f.store.writeFile(document.id, { path: "escape/new.tex", content: "No", expectedRevision: null })).toThrow(/symlinks/);
  expect(fs.existsSync(path.join(f.repo, "new.tex"))).toBe(false);
  fs.unlinkSync(path.join(f.folder, "sections/intro.tex")); fs.symlinkSync(path.join(f.folder, "main.tex"), path.join(f.folder, "sections/intro.tex"));
  expect(() => f.store.writeFile(document.id, { path: "sections/intro.tex", content: "No", expectedRevision: null })).toThrow(/symlinks/);
  fs.unlinkSync(path.join(f.repo, ".litagent/manuscript-links", `${document.id}.json`));
  expect(() => new ManuscriptStore(f.repo).read(document.id)).toThrow(/unavailable/);
});

it("uses linked assets, bibliography, new files and main-file settings through the existing store", () => {
  const f = setup(), document = f.store.attachFolder(f.request), asset = document.assets![0]!;
  expect(f.store.asset(document.id, asset.path, asset.revision)).toEqual(fs.readFileSync(path.join(f.folder, asset.path)));
  f.store.writeFile(document.id, { path: "appendix/extra.tex", content: "Extra", expectedRevision: null });
  f.store.writeFile(document.id, { path: "references.bib", content: "", expectedRevision: null });
  let latest = f.store.read(document.id);
  latest = f.store.changeTree(document.id, { action: "entry", path: "appendix/extra.tex", expectedRevision: latest.treeRevision });
  expect(latest.entryFile).toBe("appendix/extra.tex");
  latest = f.store.uploadFile(document.id, "figure2.png", Buffer.from([1, 2, 3]), latest.treeRevision!);
  expect(latest.assets).toHaveLength(2);
  expect(fs.readFileSync(path.join(f.folder, "figure2.png"))).toEqual(Buffer.from([1, 2, 3]));
  expect(fs.existsSync(path.join(f.folder, "manuscript.json"))).toBe(false);
});
