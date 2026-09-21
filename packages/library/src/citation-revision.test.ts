import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { CitationSourceChangedError, LitAgentRepository } from "./index";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-citation-"));
  roots.push(root);
  const repo = new LitAgentRepository(root);
  repo.init();
  const { paper } = repo.importPaper({ metadata: { title: "Synthetic citation study" } });
  const markdown = "# Results\n\nAccuracy was 0.92.\n\nA separate limitation.";
  const { passages } = repo.writeMarkdown(paper.id, markdown);
  const passage = passages[0]!;
  const request = { paperId: paper.id, passageId: passage.id, expectedQuote: passage.quote,
    expectedMarkdownHash: crypto.createHash("sha256").update(markdown).digest("hex") };
  return { repo, paper, markdown, passage, request };
}

it("resolves an unchanged quote and immutable Markdown revision", () => {
  const { repo, request } = fixture();
  expect(repo.resolveCitationTarget(request).quote).toBe(request.expectedQuote);
});

it("rejects a changed document even when the cited paragraph is unchanged", () => {
  const { repo, paper, markdown, request } = fixture();
  repo.writeMarkdown(paper.id, `${markdown}\n\nNew findings.`);
  expect(() => repo.resolveCitationTarget(request)).toThrow(CitationSourceChangedError);
});

it("rejects a reused passage ID with a different quote for legacy answers", () => {
  const { repo, paper, request } = fixture();
  repo.writeMarkdown(paper.id, "# Results\n\nAccuracy was 0.12.");
  expect(() => repo.resolveCitationTarget({ paperId: paper.id, passageId: request.passageId, expectedQuote: request.expectedQuote })).toThrow(CitationSourceChangedError);
});

it("rejects removed passages and missing Markdown without remapping to another passage", () => {
  const { repo, paper, request } = fixture();
  repo.writePassages(paper.id, []);
  expect(() => repo.resolveCitationTarget(request)).toThrow(CitationSourceChangedError);
  fs.rmSync(repo.resolve(`library/markdown/${paper.id}/paper.md`));
  expect(() => repo.resolveCitationTarget(request)).toThrow(CitationSourceChangedError);
});
