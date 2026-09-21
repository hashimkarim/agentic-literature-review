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

function annotationFixture() {
  const fixtureData = fixture();
  const { repo, paper, passage, request } = fixtureData;
  const project = repo.createProject({ name: "Citation geometry" });
  const add = (quote: string, page = passage.page ?? 1, x = 10) => repo.createAnnotation({
    projectId: project.id, paperId: paper.id, page, quote,
    rects: [{ page, x, y: 20, width: 30, height: 10 }]
  });
  return { ...fixtureData, project, add, resolve: () => repo.resolveCitationTarget({ ...request, projectId: project.id }) };
}

it("does not borrow unrelated, empty or partial annotation text on the cited page", () => {
  const { add, resolve } = annotationFixture();
  add("A separate limitation.");
  add("");
  add("Accuracy");
  add("Accuracy was 0.92. More text that is not part of the citation.");
  const target = resolve();
  expect(target.annotations).toEqual([]);
  expect(target.pdf.rects).toEqual([]);
  expect(target.pdf.rectSource).toBe("none");
});

it("uses only matching quote geometry on the citation page", () => {
  const { passage, add, resolve } = annotationFixture();
  const matching = add(`  ${passage.quote.replaceAll(" ", "\n")}  `);
  add(passage.quote, (passage.page ?? 1) + 1);
  add("Unrelated paragraph", passage.page ?? 1, 80);
  const target = resolve();
  expect(target.annotations.map((item) => item.id)).toEqual([matching.id]);
  expect(target.pdf.rects).toEqual(matching.rects);
  expect(target.pdf.rectSource).toBe("annotation");
});

it("filters off-page rectangles from a matching legacy annotation", () => {
  const { repo, paper, project, passage, resolve } = annotationFixture();
  repo.createAnnotation({ projectId: project.id, paperId: paper.id, page: passage.page ?? 1,
    quote: passage.quote, rects: [{ page: (passage.page ?? 1) + 1, x: 1, y: 1, width: 10, height: 10 }] });
  expect(resolve().pdf.rects).toEqual([]);
  expect(resolve().pdf.rectSource).toBe("none");
});

it("keeps passage geometry authoritative over matching annotation rectangles", () => {
  const { repo, paper, passage, add, resolve } = annotationFixture();
  const rects = [{ page: passage.page ?? 1, x: 50, y: 50, width: 20, height: 10 }];
  repo.writePassages(paper.id, [{ ...passage, rects }]);
  add(passage.quote);
  expect(resolve().pdf.rects).toEqual(rects);
  expect(resolve().pdf.rectSource).toBe("passage");
});
