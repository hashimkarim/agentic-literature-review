import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { LitAgentRepository } from "./index";

function tempRepo(): LitAgentRepository {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-library-test-"));
  const repo = new LitAgentRepository(dir);
  repo.init();
  return repo;
}

describe("LitAgentRepository", () => {
  it("stores a paper globally and links it to multiple projects", () => {
    const repo = tempRepo();
    const first = repo.createProject({ name: "Thesis" });
    const second = repo.createProject({ name: "Survey" });

    const imported = repo.importPaper({
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
    repo.importPaper({ metadata: { doi: "10.1000/example", title: "First" } });
    repo.importPaper({ metadata: { doi: "10.1000/example", title: "Second" } });
    expect(repo.listGlobalPapers()).toHaveLength(1);
  });

  it("extracts Markdown passages with section labels", () => {
    const repo = tempRepo();
    const imported = repo.importPaper({ metadata: { title: "Markdown Paper" } });
    const result = repo.writeMarkdown(
      imported.paper.id,
      "# Abstract\n\nThis is the first paragraph.\n\n## Method\n\nThis is the method."
    );
    expect(result.passages).toHaveLength(2);
    expect(result.passages[1]?.section).toBe("Method");
  });
});
