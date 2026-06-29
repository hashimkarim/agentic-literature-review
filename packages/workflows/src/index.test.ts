import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { SearchIndex } from "@litagent/indexer";
import { LitAgentRepository } from "@litagent/library";

import { discoverPdfInputs, markerRuntimeStatus, processPdfInbox, processPdfInboxAsync, processPaperSetWithMarker, type ConversionResult } from "./index";

function makeRepo(): LitAgentRepository {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-workflow-test-"));
  const repo = new LitAgentRepository(dir);
  repo.init();
  return repo;
}

function writePdf(filePath: string, label: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `%PDF-1.4\n% ${label}\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n`, "utf8");
}

function fakeConvert(repo: LitAgentRepository, paperId: string): ConversionResult {
  const paper = repo.readPaper(paperId);
  if (!paper) throw new Error(`Missing paper: ${paperId}`);
  const result = repo.writeMarkdown(
    paperId,
    [
      `# ${paper.title}`,
      "",
      "This converted passage is available for indexed cited answers.",
      "",
      "## Method",
      "",
      "Marker first pass output keeps assets, passages, and local search recoverable."
    ].join("\n")
  );
  return {
    status: "ok",
    markdownPath: result.markdownPath,
    passageCount: result.passages.length,
    message: "fake marker conversion"
  };
}

describe("PDF inbox processing", () => {
  it("prefers configured and bundled Marker runtimes over uvx fallback", () => {
    const previousMarkerBin = process.env.LITAGENT_MARKER_BIN;
    const previousConverterDir = process.env.LITAGENT_CONVERTER_DIR;
    const previousUvxBin = process.env.LITAGENT_UVX_BIN;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-marker-runtime-test-"));
    try {
      const executable = process.platform === "win32" ? "marker_single.exe" : "marker_single";
      const explicitMarker = path.join(dir, executable);
      fs.writeFileSync(explicitMarker, "");
      process.env.LITAGENT_MARKER_BIN = explicitMarker;
      delete process.env.LITAGENT_CONVERTER_DIR;
      expect(markerRuntimeStatus()).toMatchObject({
        available: true,
        source: "env",
        command: explicitMarker
      });

      delete process.env.LITAGENT_MARKER_BIN;
      const bundledMarker = path.join(dir, "marker", "bin", executable);
      fs.mkdirSync(path.dirname(bundledMarker), { recursive: true });
      fs.writeFileSync(bundledMarker, "");
      process.env.LITAGENT_CONVERTER_DIR = dir;
      expect(markerRuntimeStatus()).toMatchObject({
        available: true,
        source: "bundled",
        command: bundledMarker
      });

      delete process.env.LITAGENT_CONVERTER_DIR;
      process.env.LITAGENT_UVX_BIN = path.join(dir, "missing-uvx");
      expect(markerRuntimeStatus()).toMatchObject({
        available: false,
        source: "uvx"
      });
    } finally {
      if (previousMarkerBin === undefined) delete process.env.LITAGENT_MARKER_BIN;
      else process.env.LITAGENT_MARKER_BIN = previousMarkerBin;
      if (previousConverterDir === undefined) delete process.env.LITAGENT_CONVERTER_DIR;
      else process.env.LITAGENT_CONVERTER_DIR = previousConverterDir;
      if (previousUvxBin === undefined) delete process.env.LITAGENT_UVX_BIN;
      else process.env.LITAGENT_UVX_BIN = previousUvxBin;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("discovers PDFs recursively under the user inbox", () => {
    const repo = makeRepo();
    writePdf(repo.resolve("pdfs/root.pdf"), "root");
    writePdf(repo.resolve("pdfs/topic/child.pdf"), "child");
    writePdf(repo.resolve("pdfs/topic/deeper/grandchild.PDF"), "grandchild");
    writePdf(repo.resolve("pdfs/node_modules/ignored.pdf"), "ignored");

    const discovered = discoverPdfInputs(repo, { sourceDir: "pdfs" });

    expect(discovered.map((item) => item.relativePath)).toEqual([
      "root.pdf",
      path.join("topic", "child.pdf"),
      path.join("topic", "deeper", "grandchild.PDF")
    ]);
  });

  it("imports, links, converts, writes passages, indexes, and summarizes inbox PDFs", () => {
    const repo = makeRepo();
    const project = repo.createProject({ name: "Inbox project" });
    writePdf(repo.resolve("pdfs/a.pdf"), "a");
    writePdf(repo.resolve("pdfs/nested/b.pdf"), "b");
    const index = new SearchIndex(repo.resolve(".litagent/index.sqlite"));

    const result = processPdfInbox(
      repo,
      { projectId: project.id, sourceDir: "pdfs", runId: "run_test" },
      {
        convertPaper: fakeConvert,
        indexPaper: (paperId) => {
          const paper = repo.readPaper(paperId);
          if (paper) index.indexPaper(paper, repo.readPassages(paperId));
        }
      }
    );

    expect(result.status).toBe("ok");
    expect(result.discovered).toBe(2);
    expect(result.imported).toBe(2);
    expect(result.converted).toBe(2);
    expect(result.summaryPath).toBe("workflows/run_test.pdf-processing-summary.json");
    expect(fs.existsSync(repo.resolve(result.summaryPath ?? ""))).toBe(true);
    expect(repo.listPaperLinks(project.id)).toHaveLength(2);
    expect(repo.listGlobalPapers().every((paper) => paper.filePaths.markdown)).toBe(true);

    const searchResults = index.search(repo, {
      query: "indexed cited answers",
      projectId: project.id,
      limit: 5
    });
    expect(searchResults[0]?.passage?.quote).toContain("converted passage");
    index.close();
  });

  it("skips existing Markdown unless forced", () => {
    const repo = makeRepo();
    writePdf(repo.resolve("pdfs/a.pdf"), "a");
    let conversions = 0;
    const convert = (repository: LitAgentRepository, paperId: string) => {
      conversions += 1;
      return fakeConvert(repository, paperId);
    };

    const first = processPdfInbox(repo, { sourceDir: "pdfs" }, { convertPaper: convert });
    const paperId = first.items[0]?.paperId;
    expect(paperId).toBeTruthy();
    const second = processPdfInbox(repo, { sourceDir: "pdfs" }, { convertPaper: convert });
    const forced = processPaperSetWithMarker(repo, paperId ? [paperId] : [], { force: true }, { convertPaper: convert });

    expect(conversions).toBe(2);
    expect(second.skipped).toBe(1);
    expect(forced.converted).toBe(1);
  });

  it("processes inbox PDFs asynchronously and emits progress", async () => {
    const repo = makeRepo();
    writePdf(repo.resolve("pdfs/a.pdf"), "a");
    const progress: string[] = [];

    const result = await processPdfInboxAsync(
      repo,
      { sourceDir: "pdfs", runId: "run_async" },
      {
        convertPaper: async (repository, paperId) => fakeConvert(repository, paperId),
        onProgress: (message) => progress.push(message)
      }
    );

    expect(result.status).toBe("ok");
    expect(result.converted).toBe(1);
    expect(result.summaryPath).toBe("workflows/run_async.pdf-processing-summary.json");
    expect(progress.some((message) => message.includes("Discovered 1 PDF"))).toBe(true);
    expect(progress.some((message) => message.includes("Finished a.pdf"))).toBe(true);
  });
});
