import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { LitAgentRepository } from "@litagent/library";
import { SearchIndex } from "./index";

describe("SearchIndex", () => {
  it("returns project-scoped passage evidence", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-index-test-"));
    const repo = new LitAgentRepository(path.join(dir, "repo"));
    repo.init();
    const project = repo.createProject({ name: "Scope" });
    const imported = repo.importPaper({
      projectId: project.id,
      metadata: { title: "Evidence Paper", authors: ["Tester"] }
    });
    repo.writeMarkdown(imported.paper.id, "# Finding\n\nStreaming inference matters for real-time systems.");
    const index = new SearchIndex(path.join(dir, "index.sqlite"));
    index.rebuild(repo);
    const results = index.search(repo, { query: "streaming inference", projectId: project.id, limit: 5 });
    expect(results[0]?.paper.title).toBe("Evidence Paper");
    expect(results[0]?.passage?.quote).toContain("Streaming inference");
    index.close();
  });

  it("filters results to collection and explicit selected paper scopes", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-index-scope-test-"));
    const repo = new LitAgentRepository(path.join(dir, "repo"));
    repo.init();
    const project = repo.createProject({ name: "Collection Scope" });
    const includedCollection = repo.createCollection({ projectId: project.id, name: "Included" });
    const included = repo.importPaper({
      projectId: project.id,
      subcollectionIds: [includedCollection.id],
      metadata: { title: "Included Paper", authors: ["Tester"] }
    });
    const excluded = repo.importPaper({
      projectId: project.id,
      metadata: { title: "Excluded Paper", authors: ["Tester"] }
    });
    repo.writeMarkdown(included.paper.id, "# Finding\n\nStreaming inference appears in the included collection.");
    repo.writeMarkdown(excluded.paper.id, "# Finding\n\nStreaming inference appears outside the collection.");
    const index = new SearchIndex(path.join(dir, "index.sqlite"));
    index.rebuild(repo);

    const collectionResults = index.search(repo, {
      query: "streaming inference",
      projectId: project.id,
      collectionId: includedCollection.id,
      limit: 5
    });
    expect(collectionResults.map((result) => result.paper.id)).toEqual([included.paper.id]);

    const selectedResults = index.search(repo, {
      query: "streaming inference",
      paperIds: [excluded.paper.id],
      limit: 5
    });
    expect(selectedResults.map((result) => result.paper.id)).toEqual([excluded.paper.id]);
    index.close();
  });

  it("falls back to lexical passage scoring when the SQLite index has not been populated", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-index-fallback-test-"));
    const repo = new LitAgentRepository(path.join(dir, "repo"));
    repo.init();
    const imported = repo.importPaper({
      metadata: { title: "Unindexed Paper", authors: ["Tester"] }
    });
    repo.writeMarkdown(imported.paper.id, "# Finding\n\nSymbolic retrieval works before an explicit rebuild.");
    const index = new SearchIndex(path.join(dir, "index.sqlite"));

    const results = index.search(repo, {
      query: "symbolic retrieval",
      paperId: imported.paper.id,
      limit: 5
    });

    expect(results[0]?.paper.id).toBe(imported.paper.id);
    expect(results[0]?.passage?.quote).toContain("Symbolic retrieval");
    index.close();
  });
});
