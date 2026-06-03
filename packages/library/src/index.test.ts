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

    expect(repo.listGlobalPapers()).toHaveLength(pdfs.length);
    expect(repo.listPapers(project.id)).toHaveLength(pdfs.length);
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
});
