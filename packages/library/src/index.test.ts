import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { LitAgentRepository } from "./index";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const localPdfFixtureRoot = path.join(repoRoot, "tests/fixtures/pdfs");

function tempRepo(): LitAgentRepository {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-library-test-"));
  const repo = new LitAgentRepository(dir);
  repo.init();
  return repo;
}

function fixturePdfs(): string[] {
  const localPdfs = localFixturePdfs();
  if (localPdfs.length > 0) return localPdfs;

  const generatedDir = path.join(os.tmpdir(), "litagent-generated-pdf-fixtures");
  fs.mkdirSync(generatedDir, { recursive: true });
  return Array.from({ length: 5 }, (_value, index) => {
    const filePath = path.join(generatedDir, `fixture-${index + 1}.pdf`);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(
        filePath,
        `%PDF-1.4\n% LitAgent generated test fixture ${index + 1}\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n`,
        "utf8"
      );
    }
    return filePath;
  });
}

function fixturePdf(index: number): string {
  const pdfs = fixturePdfs();
  expect(pdfs.length).toBeGreaterThan(0);
  const pdf = pdfs[index % pdfs.length];
  if (!pdf) throw new Error(`Missing fixture PDF at index ${index}`);
  return pdf;
}

function localFixturePdfs(): string[] {
  return findPdfFiles(localPdfFixtureRoot);
}

function findPdfFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...findPdfFiles(fullPath));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) files.push(fullPath);
  }
  return files.sort();
}

describe("LitAgentRepository", () => {
  it("keeps generated manuscript PDFs and build logs out of version control", () => {
    const repo = tempRepo();
    try { expect(fs.readFileSync(repo.resolve(".gitignore"), "utf8")).toContain(".litagent/tex-builds/\n"); }
    finally { fs.rmSync(repo.root, { recursive: true, force: true }); }
  });
  it("can import every local PDF fixture when developers provide them", () => {
    const pdfs = localFixturePdfs();
    if (pdfs.length === 0) return;
    const repo = tempRepo();
    const project = repo.createProject({ name: "Local PDF Fixtures" });

    for (const [index, sourcePath] of pdfs.entries()) {
      const imported = repo.importPaper({
        sourcePath,
        projectId: project.id,
        metadata: {
          title: path.basename(sourcePath, ".pdf"),
          tags: ["local-fixture", `fixture:${index + 1}`]
        }
      });
      const copiedPath = repo.pdfPath(imported.paper.id);
      expect(copiedPath).toBeTruthy();
      expect(copiedPath && fs.existsSync(copiedPath)).toBe(true);
    }

    expect(repo.listGlobalPapers().length).toBeGreaterThan(0);
    expect(repo.listGlobalPapers().length).toBeLessThanOrEqual(pdfs.length);
    expect(repo.listPapers(project.id).length).toBe(repo.listGlobalPapers().length);
  });

  it("stores a paper globally and links it to multiple projects", () => {
    const repo = tempRepo();
    const first = repo.createProject({ name: "Thesis" });
    const second = repo.createProject({ name: "Survey" });

    const imported = repo.importPaper({
      sourcePath: fixturePdf(0),
      projectId: first.id,
      projectTags: ["mobile"],
      metadata: {
        doi: "10.1000/example",
        title: "Shared Paper",
        authors: ["A. Researcher"],
        year: 2026
      }
    });
    const linked = repo.linkPaperToProject(imported.paper.id, {
      projectId: second.id,
      projectTags: ["background"]
    });

    expect(repo.listGlobalPapers()).toHaveLength(1);
    expect(repo.listPapers(first.id)).toHaveLength(1);
    expect(repo.listPapers(second.id)).toHaveLength(1);
    expect(linked.projectTags).toContain("background");
    expect(linked.projectTags).toContain("project:survey");
  });

  it("deduplicates papers by DOI", () => {
    const repo = tempRepo();
    repo.importPaper({ sourcePath: fixturePdf(1), metadata: { doi: "10.1000/example", title: "First" } });
    repo.importPaper({ sourcePath: fixturePdf(2), metadata: { doi: "10.1000/example", title: "Second" } });
    expect(repo.listGlobalPapers()).toHaveLength(1);
  });

  it("extracts Markdown passages with section labels", () => {
    const repo = tempRepo();
    const imported = repo.importPaper({ sourcePath: fixturePdf(3), metadata: { title: "Markdown Paper" } });
    const result = repo.writeMarkdown(
      imported.paper.id,
      "# Abstract\n\nThis is the first paragraph.\n\n## Method\n\nThis is the method."
    );
    expect(result.passages).toHaveLength(2);
    expect(result.passages[1]?.section).toBe("Method");
  });

  it("stores project notes as Markdown and links them to paper membership", () => {
    const repo = tempRepo();
    const project = repo.createProject({ name: "Notes Project" });
    const imported = repo.importPaper({
      sourcePath: fixturePdf(4),
      projectId: project.id,
      metadata: { title: "Annotated Paper" }
    });

    const note = repo.createNote(project.id, {
      title: "Finding note",
      paperId: imported.paper.id,
      passageIds: [`${imported.paper.id}_passage_0001`],
      tags: ["finding"],
      content: "# Finding note\n\nThis paper has a reusable finding."
    });
    const listed = repo.listNotes(project.id);
    const link = repo.listPaperLinks(project.id).find((candidate) => candidate.paperId === imported.paper.id);

    expect(listed).toHaveLength(1);
    expect(note.content).toContain("reusable finding");
    expect(link?.notes).toContain(note.id);

    const updated = repo.updateNote(project.id, note.id, {
      content: "# Finding note\n\nUpdated text.",
      tags: ["finding", "updated"]
    });
    expect(updated.content).toContain("Updated text");
    expect(repo.readNote(project.id, note.id)?.tags).toContain("updated");
  });

  it("reviews relevance proposals before changing project screening state", () => {
    const repo = tempRepo();
    const project = repo.createProject({
      name: "Screening Project",
      researchQuestion: "Does the method support reliable real-time analysis?"
    });
    const imported = repo.importPaper({
      sourcePath: fixturePdf(0),
      projectId: project.id,
      metadata: { title: "Real-time Analysis" }
    });
    const { passages } = repo.writeMarkdown(imported.paper.id, "# Findings\n\nThe method supports reliable real-time analysis.");
    const evidence = [{
      paperId: imported.paper.id,
      passageId: passages[0]?.id ?? "missing",
      page: passages[0]?.page ?? null,
      paperTitle: imported.paper.title,
      section: passages[0]?.section ?? "Findings",
      quote: passages[0]?.quote ?? "The method supports reliable real-time analysis.",
      confidence: 0.9
    }];
    const proposalInput = {
      runId: "run_relevance",
      projectId: project.id,
      paperId: imported.paper.id,
      researchQuestionId: project.researchQuestions[0]?.id ?? null,
      question: project.researchQuestions[0]?.text ?? "relevance",
      proposedState: "included" as const,
      relevanceScore: 0.9,
      confidence: 0.8,
      rationale: "The findings directly address the research question.",
      projectTags: ["rq:real-time-analysis"],
      evidence,
      providerId: "codex",
      model: null
    };

    const rejected = repo.createRelevanceProposal(proposalInput);
    repo.reviewRelevanceProposal(project.id, rejected.id, { decision: "rejected" });
    expect(repo.listPaperLinks(project.id)[0]?.relevanceState).toBe("unreviewed");

    const accepted = repo.createRelevanceProposal(proposalInput);
    const reviewed = repo.reviewRelevanceProposal(project.id, accepted.id, {
      decision: "accepted",
      proposedState: "maybe",
      rationale: "Relevant, but the evaluation evidence is incomplete."
    });
    const link = repo.listPaperLinks(project.id)[0];
    expect(reviewed).toMatchObject({ status: "accepted", proposedState: "maybe" });
    expect(link?.relevanceState).toBe("maybe");
    expect(link?.projectTags).toContain("rq:real-time-analysis");
    expect(repo.listRelevanceProposals(project.id, { paperId: imported.paper.id })).toHaveLength(2);
  });

  it("applies only accepted metadata proposal fields", () => {
    const repo = tempRepo();
    const imported = repo.importPaper({
      sourcePath: fixturePdf(1),
      metadata: { title: "Unverified title", authors: [], tags: ["existing"] }
    });
    const proposal = repo.createMetadataProposal({
      runId: "run_metadata",
      paperId: imported.paper.id,
      fields: [
        {
          field: "title",
          currentValue: "Unverified title",
          proposedValue: "Verified Paper Title",
          confidence: 0.95,
          rationale: "The title appears in the document heading.",
          evidence: []
        },
        {
          field: "year",
          currentValue: null,
          proposedValue: 2025,
          confidence: 0.8,
          rationale: "The publication year appears in the front matter.",
          evidence: []
        },
        {
          field: "tags",
          currentValue: ["existing"],
          proposedValue: ["metadata", "review"],
          confidence: 0.7,
          rationale: "These topics are discussed in the paper.",
          evidence: []
        }
      ],
      providerId: "codex"
    });

    const reviewed = repo.reviewMetadataProposal(imported.paper.id, proposal.id, {
      decision: "accepted",
      acceptedFields: ["title", "tags"],
      edits: { title: "Edited Verified Title" }
    });
    const paper = repo.readPaper(imported.paper.id);

    expect(reviewed).toMatchObject({ status: "accepted", appliedFields: ["title", "tags"] });
    expect(paper?.title).toBe("Edited Verified Title");
    expect(paper?.year).toBeNull();
    expect(paper?.tags).toEqual(expect.arrayContaining(["existing", "metadata", "review"]));
  });

  it("creates canonical research records only from accepted finding items", () => {
    const repo = tempRepo();
    const project = repo.createProject({ name: "Findings Project" });
    const imported = repo.importPaper({
      sourcePath: fixturePdf(2),
      projectId: project.id,
      metadata: { title: "Structured Findings" }
    });
    const { passages } = repo.writeMarkdown(
      imported.paper.id,
      "# Results\n\nThe proposed method improves accuracy by five points.\n\n## Limitations\n\nThe evaluation uses only one dataset."
    );
    const evidence = (index: number) => [{
      paperId: imported.paper.id,
      passageId: passages[index]?.id ?? "missing",
      page: passages[index]?.page ?? null,
      paperTitle: imported.paper.title,
      section: passages[index]?.section ?? "",
      quote: passages[index]?.quote ?? "Missing evidence",
      confidence: 0.9
    }];
    const proposal = repo.createResearchFindingProposal({
      runId: "run_findings",
      projectId: project.id,
      paperId: imported.paper.id,
      providerId: "codex",
      items: [
        {
          id: "item_result",
          kind: "result",
          title: "Accuracy improvement",
          content: "The proposed method improves accuracy by five points.",
          attributes: { improvement: "5 points" },
          confidence: 0.9,
          evidence: evidence(0)
        },
        {
          id: "item_limit",
          kind: "limitation",
          title: "Single-dataset evaluation",
          content: "The evaluation uses only one dataset.",
          attributes: {},
          confidence: 0.85,
          evidence: evidence(1)
        }
      ]
    });

    const reviewed = repo.reviewResearchFindingProposal(imported.paper.id, proposal.id, {
      decision: "accepted",
      acceptedItemIds: ["item_result"],
      edits: { item_result: { title: "Reviewed accuracy improvement" } }
    });
    const records = repo.listResearchRecords(imported.paper.id, project.id);

    expect(reviewed).toMatchObject({ status: "accepted", acceptedItemIds: ["item_result"] });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      kind: "result",
      title: "Reviewed accuracy improvement",
      sourceProposalId: proposal.id,
      sourceItemId: "item_result"
    });
  });

  it("stores annotations and keeps note backlinks in sync", () => {
    const repo = tempRepo();
    const project = repo.createProject({ name: "Annotation Project" });
    const imported = repo.importPaper({
      sourcePath: fixturePdf(0),
      projectId: project.id,
      metadata: { title: "Highlight Paper" }
    });
    const note = repo.createNote(project.id, {
      title: "Highlight note",
      paperId: imported.paper.id,
      content: "Linked highlight."
    });

    const annotation = repo.createAnnotation({
      projectId: project.id,
      paperId: imported.paper.id,
      page: 2,
      quote: "Important sentence",
      color: "blue",
      noteId: note.id,
      rects: [{ page: 2, x: 10, y: 20, width: 30, height: 8 }]
    });
    const updatedNote = repo.readNote(project.id, note.id);
    expect(repo.listAnnotations(project.id, imported.paper.id)).toHaveLength(1);
    expect(updatedNote?.annotationIds).toContain(annotation.id);

    const updatedAnnotation = repo.updateAnnotation(project.id, annotation.id, { color: "green", noteId: null });
    expect(updatedAnnotation.color).toBe("green");
    expect(updatedAnnotation.noteId).toBeNull();
    expect(repo.readNote(project.id, note.id)?.annotationIds).not.toContain(annotation.id);

    repo.deleteAnnotation(project.id, annotation.id);
    expect(repo.listAnnotations(project.id, imported.paper.id)).toHaveLength(0);
  });

  it("resolves citation targets to PDF pages, annotation rects, and Markdown lines", () => {
    const repo = tempRepo();
    const project = repo.createProject({ name: "Citation Project" });
    const imported = repo.importPaper({
      sourcePath: fixturePdf(1),
      projectId: project.id,
      metadata: { title: "Citation Paper" }
    });
    const markdown = [
      "# Overview",
      "",
      "First paragraph for the overview.",
      "",
      "Second paragraph has the exact cited sentence.",
      "",
      "## Method",
      "",
      "Method paragraph."
    ].join("\n");
    const { passages } = repo.writeMarkdown(imported.paper.id, markdown);
    const passage = passages.find((candidate) => candidate.quote.includes("exact cited sentence"));
    expect(passage).toBeTruthy();
    if (!passage) throw new Error("Expected a passage for citation target test.");

    const annotation = repo.createAnnotation({
      projectId: project.id,
      paperId: imported.paper.id,
      page: passage.page ?? 1,
      quote: passage.quote,
      color: "yellow",
      rects: [{ page: passage.page ?? 1, x: 12, y: 34, width: 56, height: 10 }]
    });
    const target = repo.resolveCitationTarget({
      projectId: project.id,
      paperId: imported.paper.id,
      passageId: passage.id
    });

    expect(target.paperTitle).toBe("Citation Paper");
    expect(target.pdf.available).toBe(true);
    expect(target.pdf.page).toBe(passage.page);
    expect(target.pdf.rectSource).toBe("annotation");
    expect(target.pdf.rects[0]?.x).toBe(12);
    expect(target.markdown.available).toBe(true);
    expect(target.markdown.startLine).toBe(5);
    expect(target.markdown.endLine).toBe(5);
    expect(target.annotations.map((item) => item.id)).toContain(annotation.id);
  });
});
