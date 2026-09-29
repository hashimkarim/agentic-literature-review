import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { LitAgentRepository } from "@litagent/library";
import { SearchIndex } from "./index";

describe("SearchIndex", () => {
  it("refreshes linked Markdown before ranking and removes unavailable source evidence", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-linked-index-"));
    const repo = new LitAgentRepository(path.join(dir, "repo")); repo.init();
    const folder = path.join(dir, "papers"); fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, "Results.md"), "# Results\n\nInitial latency was measured.");
    const preview = repo.localPapers.preview({ path: folder });
    const { paper } = repo.localPapers.importEntry({ previewId: preview.id, entryId: preview.entries[0]!.id, storage: "linked-files" });
    const index = new SearchIndex(path.join(dir, "index.sqlite"));
    try {
      index.rebuild(repo);
      expect(index.search(repo, { query: "latency", paperId: paper.id })[0]?.passage?.quote).toContain("Initial latency");
      fs.writeFileSync(path.join(folder, "Results.md"), "# Results\n\nExternal correction measures throughput instead.");
      expect(index.search(repo, { query: "throughput", paperId: paper.id })[0]?.passage?.quote).toContain("External correction");
      expect(index.search(repo, { query: "latency", paperId: paper.id })).toEqual([]);
      fs.renameSync(folder, `${folder}-away`);
      expect(index.search(repo, { query: "throughput", paperId: paper.id })).toEqual([]);
      fs.renameSync(`${folder}-away`, folder);
      expect(index.search(repo, { query: "throughput", paperId: paper.id })[0]?.passage?.quote).toContain("External correction");
    } finally { index.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  });
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
