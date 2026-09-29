import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";
import { LitAgentRepository } from "./index";
import { paperImageReferences } from "./paper-source-files";
import { normalizeMarkdownImages } from "./markdown-images";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-local-papers-")); roots.push(root);
  const folder = path.join(root, "documents"), pdf = path.join(folder, "literature/pdf"), markdown = path.join(folder, "literature/markdown");
  fs.mkdirSync(path.join(pdf, "models"), { recursive: true }); fs.mkdirSync(path.join(markdown, "models/Study_assets"), { recursive: true });
  fs.writeFileSync(path.join(pdf, "models/Study.pdf"), "%PDF-1.4\nLocal document\n%%EOF");
  const text = "# Results\n\nThe selected evaluation used 24 participants.\n\n![](Study_assets/figure one.png)\n";
  fs.writeFileSync(path.join(markdown, "models/Study.md"), text);
  fs.writeFileSync(path.join(markdown, "models/Study_assets/figure one.png"), Buffer.from([137, 80, 78, 71, 1]));
  const repo = new LitAgentRepository(path.join(root, "research")); repo.init();
  const preview = repo.localPapers.preview({ path: folder });
  const request = { previewId: preview.id, entryId: preview.entries[0]!.id, storage: "linked-files" as const };
  return { root, folder, pdf, markdown, text, repo, preview, request };
}

it("pairs mirrored roots and imports original Markdown bytes and image assets without conversion", () => {
  const f = setup();
  expect(f.preview.entries).toMatchObject([{ title: "Study", match: "path", pdf: { path: "models/Study.pdf" }, markdown: { path: "models/Study.md" } }]);
  const { paper, warnings } = f.repo.localPapers.importEntry({ ...f.request, storage: "copy" });
  expect(warnings).toEqual([]); expect(paper.storage).toBeUndefined();
  expect(f.repo.readMarkdown(paper.id)).toBe(f.text);
  expect(f.repo.readPassages(paper.id).some((item) => item.quote.includes("24 participants"))).toBe(true);
  expect(f.repo.localPapers.asset(paper.id, "Study_assets/figure%20one.png")).toEqual(Buffer.from([137, 80, 78, 71, 1]));
  fs.rmSync(f.folder, { recursive: true });
  expect(fs.existsSync(f.repo.pdfPath(paper.id)!)).toBe(true);
  expect(f.repo.readMarkdown(paper.id)).toBe(f.text);
});

it("attaches files without source copies, refreshes external changes and rejects stale citation hashes", () => {
  const f = setup(), { paper } = f.repo.localPapers.importEntry(f.request);
  expect(f.repo.pdfPath(paper.id)).toBe(path.join(f.pdf, "models/Study.pdf"));
  expect(fs.existsSync(f.repo.resolve(paper.filePaths.pdf!))).toBe(false);
  expect(fs.existsSync(f.repo.resolve(paper.filePaths.markdown!))).toBe(false);
  expect(fs.readFileSync(f.repo.resolve(`library/papers/${paper.id}/metadata.json`), "utf8")).not.toContain(f.folder);
  expect(spawnSync("git", ["check-ignore", `.litagent/paper-links/${paper.id}.json`], { cwd: f.repo.root }).status).toBe(0);
  const before = f.repo.localPapers.refresh(paper.id).state, passage = f.repo.readPassages(paper.id)[0]!;
  fs.writeFileSync(path.join(f.markdown, "models/Study.md"), "# Results\n\nThe corrected evaluation used 31 participants.\n");
  expect(f.repo.readMarkdown(paper.id)).toContain("31 participants");
  expect(f.repo.readPassages(paper.id)[0]!.quote).toContain("31 participants");
  const after = f.repo.localPapers.refresh(paper.id).state;
  expect(after.revision).not.toBe(before.revision); expect(after.pdfRevision).toBe(before.pdfRevision);
  expect(() => f.repo.resolveCitationTarget({ paperId: paper.id, passageId: passage.id, expectedQuote: passage.quote })).toThrow(/no longer matches/);
  expect(() => f.repo.writeMarkdown(paper.id, "Overwrite")).toThrow(/linked local files/);
  const restarted = new LitAgentRepository(f.repo.root); restarted.init();
  expect(restarted.readMarkdown(paper.id)).toContain("31 participants");
  const repeat = restarted.localPapers.preview({ path: f.folder });
  expect(restarted.localPapers.importEntry({ ...f.request, previewId: repeat.id, entryId: repeat.entries[0]!.id }).paper.id).toBe(paper.id);
  expect(restarted.listGlobalPapers()).toHaveLength(1);
});

it("preserves unavailable sources and recovers only the original root identity", () => {
  const f = setup(), { paper } = f.repo.localPapers.importEntry(f.request);
  fs.renameSync(f.markdown, `${f.markdown}-away`);
  expect(f.repo.localPapers.refresh(paper.id).state.available).toBe(false);
  expect(f.repo.readMarkdown(paper.id)).toBeNull(); expect(f.repo.readPassages(paper.id)).toEqual([]); expect(f.repo.pdfPath(paper.id)).toBeNull();
  fs.mkdirSync(f.markdown); fs.writeFileSync(path.join(f.markdown, "Study.md"), "Replacement");
  expect(f.repo.localPapers.refresh(paper.id).state.available).toBe(false);
  fs.rmSync(f.markdown, { recursive: true }); fs.renameSync(`${f.markdown}-away`, f.markdown);
  expect(f.repo.localPapers.refresh(paper.id).state.available).toBe(true);
  expect(f.repo.readPassages(paper.id).some((item) => item.quote.includes("24 participants"))).toBe(true);
});

it("imports Markdown-only papers, accepts explicit matching and never guesses ambiguous names", () => {
  const f = setup();
  fs.mkdirSync(path.join(f.markdown, "alternate"));
  fs.writeFileSync(path.join(f.markdown, "alternate/Study.md"), "# Alternate\n\nDifferent reading copy.");
  fs.renameSync(path.join(f.markdown, "models/Study.md"), path.join(f.markdown, "Different.md"));
  fs.writeFileSync(path.join(f.markdown, "Study.md"), "# Another\n\nAnother reading copy.");
  const preview = f.repo.localPapers.preview({ path: f.pdf, markdownPath: f.markdown });
  const entry = preview.entries.find((item) => item.pdf)!;
  expect(entry.markdown).toBeNull(); expect(entry.match).toBeNull();
  const md = preview.markdownFiles.find((file) => file.path === "Different.md")!;
  const paired = f.repo.localPapers.importEntry({ ...f.request, previewId: preview.id, entryId: entry.id, markdownId: md.id });
  expect(f.repo.readMarkdown(paired.paper.id)).toBe(f.text);
  const standalone = preview.entries.find((item) => item.markdown?.path === "Study.md")!;
  const imported = f.repo.localPapers.importEntry({ ...f.request, previewId: preview.id, entryId: standalone.id, storage: "copy" });
  expect(imported.paper.filePaths.pdf).toBeNull(); expect(f.repo.readMarkdown(imported.paper.id)).toContain("Another reading copy");
});

it("deduplicates earlier PDF imports and protects an existing different Markdown version", () => {
  const f = setup(), original = f.repo.importPaper({ sourcePath: path.join(f.pdf, "models/Study.pdf"), metadata: { title: "Curated title", tags: ["reviewed"] } });
  const project = f.repo.createProject({ name: "Paper project" });
  const imported = f.repo.localPapers.importEntry({ ...f.request, storage: "copy", projectId: project.id });
  expect(imported.paper.id).toBe(original.paper.id); expect(imported.paper.title).toBe("Curated title"); expect(imported.paper.tags).toEqual(["reviewed"]);
  expect(f.repo.listGlobalPapers()).toHaveLength(1); expect(f.repo.listPapers(project.id)).toHaveLength(1);
  f.repo.writeMarkdown(imported.paper.id, "# Curated\n\nAccepted correction.");
  expect(() => f.repo.localPapers.importEntry({ ...f.request, storage: "copy" })).toThrow(/different Markdown/);
  expect(f.repo.readMarkdown(imported.paper.id)).toContain("Accepted correction");
});

it("rejects stale previews and symbolic links without publishing papers", () => {
  const f = setup();
  fs.writeFileSync(path.join(f.markdown, "models/Study.md"), "Changed after preview");
  expect(() => f.repo.localPapers.importEntry(f.request)).toThrow(/changed since preview/);
  expect(f.repo.listGlobalPapers()).toEqual([]);
  const preview = f.repo.localPapers.preview({ path: f.folder });
  fs.renameSync(path.join(f.pdf, "models"), path.join(f.pdf, "moved")); fs.symlinkSync(path.join(f.pdf, "moved"), path.join(f.pdf, "models"));
  expect(() => f.repo.localPapers.importEntry({ ...f.request, previewId: preview.id, entryId: preview.entries[0]!.id })).toThrow(/unavailable/);
  expect(f.repo.listGlobalPapers()).toEqual([]);
});

it("parses image references with spaces and HTML but not fenced code, and does not expose arbitrary files", () => {
  const source = '![](Paper assets/figure (1).png)\n\n![x][chart]\n\n[chart]: <images/chart.png>\n\n<img src="images/other.png">\n\n```md\n![](ignored image.png)\n```';
  expect(paperImageReferences(source)).toEqual(["Paper assets/figure (1).png", "images/chart.png", "images/other.png"]);
  expect(normalizeMarkdownImages(source)).toContain("```md\n![](ignored image.png)\n```");
  const f = setup();
  fs.writeFileSync(path.join(f.markdown, "models/Study.md"), f.text + "\n![](../../../../private.png)\n");
  fs.writeFileSync(path.join(f.markdown, "models/private.png"), "unreferenced");
  const preview = f.repo.localPapers.preview({ path: f.folder });
  const result = f.repo.localPapers.importEntry({ ...f.request, previewId: preview.id, entryId: preview.entries[0]!.id });
  expect(result.warnings).toHaveLength(1);
  expect(f.repo.localPapers.asset(result.paper.id, "private.png")).toBeNull();
  expect(f.repo.localPapers.asset(result.paper.id, "../../../../private.png")).toBeNull();
  expect(f.repo.localPapers.asset(result.paper.id, "/etc/passwd")).toBeNull();
  fs.unlinkSync(path.join(f.markdown, "models/Study_assets/figure one.png"));
  expect(f.repo.localPapers.asset(result.paper.id, "Study_assets/figure one.png")).toBeNull();
  fs.writeFileSync(path.join(f.markdown, "models/Study_assets/figure one.png"), "restored");
  expect(f.repo.localPapers.asset(result.paper.id, "Study_assets/figure one.png")?.toString()).toBe("restored");
});
