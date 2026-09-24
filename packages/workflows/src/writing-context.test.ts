import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, it } from "vitest";
import { LitAgentRepository, ManuscriptStore } from "@litagent/library";
import { WritingContextService } from "./writing-context";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-writing-context-")); roots.push(root);
  const repo = new LitAgentRepository(root); repo.init();
  const project = repo.createProject({ name: "Synthetic context" });
  const paper = repo.importPaper({ metadata: { title: "Synthetic study", authors: ["Example Author"], year: 2026 }, projectId: project.id }).paper;
  repo.writeMarkdown(paper.id, "# Method\n\nA small study.\n\n# Results\n\nThe measured accuracy was 0.72 on the synthetic test set.\n");
  const store = new ManuscriptStore(root), document = store.create({ name: "Draft", projectIds: [project.id] });
  const context = new WritingContextService(store, repo);
  return { root, repo, store, document, context, paper, project };
}
it("pins complete selected paper text and distinct code/result provenance, never unselected sources", () => {
  const f = fixture();
  const code = f.store.attachWritingSource(f.document.id, { path: "src/model.ts", kind: "code", content: "export const layers = 4;" });
  const result = f.store.attachWritingSource(f.document.id, { path: "runs/results.csv", kind: "results", content: "run,accuracy\na,0.72\n", originUrl: "https://wandb.ai/example/project/runs/a" });
  f.store.attachWritingSource(f.document.id, { path: "notes.txt", kind: "notes", content: "Unselected data" });
  const selection = { paperIds: [f.paper.id], attachmentIds: [code.id, result.id], manuscriptPaths: [] };
  const snapshot = f.context.preview(f.document.id, selection);
  expect(snapshot.sources.map((source) => source.kind).sort()).toEqual(["code", "literature", "results"]);
  expect(snapshot.sources[0]!.quote).toBe(f.repo.readMarkdown(f.paper.id));
  expect(snapshot.coverage.every((source) => source.status === "complete")).toBe(true);
  expect(JSON.stringify(snapshot)).not.toContain("Unselected data");
  expect(snapshot.sources[0]!.bibliography).toContain("Example Author");
  expect(snapshot.sources.find((source) => source.kind === "code")!.startLine).toBe(1);
  expect(snapshot.sources.find((source) => source.kind === "results")!.originUrl).toBe("https://wandb.ai/example/project/runs/a");
  expect(() => f.context.assertCurrent(f.document.id, selection, snapshot.revision)).not.toThrow();
  f.repo.writeMarkdown(f.paper.id, "Changed results");
  expect(() => f.context.assertCurrent(f.document.id, selection, snapshot.revision)).toThrow(/sources changed/);
});
it("excludes out-of-scope papers, detects changed links and removed attachments", () => {
  const f = fixture();
  const outsider = f.repo.importPaper({ metadata: { title: "Other project" } }).paper;
  expect(() => f.context.preview(f.document.id, { paperIds: [outsider.id], attachmentIds: [], manuscriptPaths: [] })).toThrow(/scope/);
  const source = f.store.attachWritingSource(f.document.id, { path: "note.md", kind: "notes", content: "A working hypothesis" });
  const selection = { paperIds: [], attachmentIds: [source.id], manuscriptPaths: [] };
  const snapshot = f.context.preview(f.document.id, selection);
  f.store.removeWritingSource(f.document.id, source.id);
  expect(() => f.context.assertCurrent(f.document.id, selection, snapshot.revision)).toThrow(/removed/);
});
it("reports omissions explicitly and distributes the source budget", () => {
  const f = fixture();
  const attachments = Array.from({ length: 8 }, (_, i) => f.store.attachWritingSource(f.document.id, { path: `large-${i}.csv`, kind: "results", content: "row,value\n".repeat(20_000) }));
  const snapshot = f.context.preview(f.document.id, { paperIds: [], attachmentIds: attachments.map((source) => source.id), manuscriptPaths: [] });
  expect(snapshot.characters).toBeLessThanOrEqual(snapshot.limit);
  expect(snapshot.sources.length).toBeLessThanOrEqual(160);
  expect(snapshot.coverage.every((source) => source.status === "partial" && source.includedCharacters > 0)).toBe(true);
  expect(snapshot.sources.every((source) => source.quote.length <= 4000)).toBe(true);
});
it("deduplicates immutable uploads, rejects credential paths/content and preserves manuscripts", () => {
  const f = fixture(), original = f.store.read(f.document.id);
  const input = { path: "results.csv", kind: "results", content: "run,accuracy\na,0.72" };
  const first = f.store.attachWritingSource(f.document.id, input);
  expect(f.store.attachWritingSource(f.document.id, input)).toEqual(first);
  for (const file of [".env", "secrets.json", "keys/private_key.txt", "../escape.txt", "node_modules/lib.ts"]) expect(() => f.store.attachWritingSource(f.document.id, { ...input, path: file })).toThrow();
  expect(() => f.store.attachWritingSource(f.document.id, { ...input, content: 'api_key = "not-a-real-secret-but-sensitive"' })).toThrow(/credentials/);
  expect(() => f.store.attachWritingSource(f.document.id, { ...input, originUrl: "https://example.com?token=secret" })).toThrow();
  expect(f.store.read(f.document.id)).toEqual(original);
  expect(new ManuscriptStore(f.root).writingAttachments(f.document.id)).toEqual([first]);
});
