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
});
