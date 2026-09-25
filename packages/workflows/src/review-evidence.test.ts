import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { LitAgentRepository } from "@litagent/library";
import { SearchIndex } from "@litagent/indexer";
import { ReviewEvidence } from "./review-evidence";

const cleanup: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanup.splice(0)) dispose(); });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "review-evidence-"));
  const repo = new LitAgentRepository(root); repo.init();
  const project = repo.createProject({ name: "Synthetic scoped review" });
  const { paper } = repo.importPaper({ projectId: project.id, metadata: { title: "Synthetic detector" } });
  const { paper: excluded } = repo.importPaper({ metadata: { title: "Excluded detector" } });
  repo.writeMarkdown(paper.id, "# Results\n\nThe detector achieved\n0.92 accuracy.\n");
  repo.writeMarkdown(excluded.id, "# Results\n\nThe excluded detector achieved 0.99 accuracy.");
  const index = new SearchIndex(repo.resolve(".litagent/index.sqlite")); index.rebuild(repo);
  cleanup.push(() => { index.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const scope = ReviewEvidence.capture(repo, project.id, [paper.id]);
  return { root, repo, index, project, paper, excluded, scope, evidence: new ReviewEvidence(repo, index, scope) };
}

it("searches only selected sources and returns navigable evidence without claiming support", () => {
  const f = fixture();
  const result = f.evidence.search({ query: "detector" });
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ source: { paperId: f.paper.id }, citationExists: true, support: "not_assessed", target: { paperId: f.paper.id } });
  expect(result[0]!.source.markdownHash).toBe(f.scope.sources[0]!.markdownHash);
  expect(() => f.evidence.passage({ paperId: f.excluded.id, passageId: f.repo.readPassages(f.excluded.id)[0]!.id })).toThrow(/outside/);
  expect(() => f.evidence.search({ query: "detector", paperIds: [f.excluded.id] })).toThrow();
});

it("rejects changed revisions, removed project access, missing passages and invented quotes", () => {
  const f = fixture(); const passage = f.repo.readPassages(f.paper.id)[0]!;
  expect(() => f.evidence.passage({ paperId: f.paper.id, passageId: passage.id, quote: "0.99 accuracy" })).toThrow(/Quoted/);
  expect(() => f.evidence.passage({ paperId: f.paper.id, passageId: "missing" })).toThrow(/no longer/);
  f.repo.writePaperLinks(f.project.id, []);
  expect(() => f.evidence.search({ query: "detector" })).toThrow(/access changed/);
  f.repo.linkPaperToProject(f.paper.id, { projectId: f.project.id });
  f.repo.writeMarkdown(f.paper.id, "# Revised\n\nThe detector achieved 0.50 accuracy.");
  expect(() => new ReviewEvidence(f.repo, f.index, f.scope)).toThrow(/revision changed/);
});

it("rejects stale or forged index text and never allows an empty scope to become global", () => {
  const f = fixture(); const passages = f.repo.readPassages(f.paper.id);
  f.repo.writePassages(f.paper.id, [{ ...passages[0]!, quote: "Invented result" }]);
  expect(() => f.evidence.search({ query: "detector" })).toThrow(/current Markdown/);
  expect(() => ReviewEvidence.capture(f.repo, null, [])).toThrow();
  expect(() => ReviewEvidence.capture(f.repo, f.project.id, [f.excluded.id])).toThrow(/not accessible/);
  expect(() => ReviewEvidence.capture(f.repo, f.project.id, [f.paper.id, f.paper.id])).toThrow(/Duplicate/);
});
