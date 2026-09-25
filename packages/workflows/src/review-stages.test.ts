import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { WorkflowRunSchema, type WorkflowRun } from "@litagent/contracts";
import { LitAgentRepository } from "@litagent/library";
import { SearchIndex } from "@litagent/indexer";
import { WorkflowEngine, type WorkflowStartRequest } from "./index";
import { ReviewEvidence } from "./review-evidence";
import { ReviewStages } from "./review-stages";

const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).forEach((dispose) => dispose()));
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "review-stages-"));
  const repo = new LitAgentRepository(root); repo.init();
  const project = repo.createProject({ name: "Synthetic review" });
  const { paper } = repo.importPaper({ projectId: project.id, metadata: { title: "Synthetic accuracy" } });
  repo.writeMarkdown(paper.id, "# Result\n\nAccuracy is 0.92.");
  const index = new SearchIndex(repo.resolve(".litagent/index.sqlite")); index.rebuild(repo);
  cleanup.push(() => { index.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const save = (run: WorkflowRun) => fs.writeFileSync(repo.resolve(`workflows/${run.id}.run.json`), JSON.stringify(run));
  const engine = {
    startWorkflow: vi.fn((request: WorkflowStartRequest, id?: string) => {
      const run = WorkflowRunSchema.parse({ ...request, id, scope: { paperIds: request.paperIds },
        status: "running", eventsPath: `workflows/${id}.jsonl`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      save(run); return run;
    }),
    readRun: (id: string) => ({ run: WorkflowRunSchema.parse(JSON.parse(fs.readFileSync(repo.resolve(`workflows/${id}.run.json`), "utf8"))), events: [] }),
    hasActiveRun: () => false
  };
  const request = { type: "metadata-extraction", projectId: project.id, paperIds: [paper.id], providerId: "driver.fixture", model: "fixture-model" };
  const scope = ReviewEvidence.capture(repo, project.id, [paper.id]);
  return { repo, index, paper, engine, request, scope, save, coordinator: new ReviewStages(repo, index, engine) };
}

it("reconciles completed processing after restart without repeating it", () => {
  const f = fixture(); const before = f.repo.readPaper(f.paper.id);
  const review = f.coordinator.create(f.scope, [f.request, { ...f.request, type: "key-findings" }]);
  f.coordinator.advance(review.id);
  expect(f.engine.startWorkflow).toHaveBeenCalledTimes(1);
  const run = f.engine.readRun(review.stages[0]!.runId).run;
  f.save({ ...run, status: "completed" }); // Result persisted before checkpoint update.
  const restarted = new ReviewStages(f.repo, f.index, f.engine);
  expect(restarted.advance(review.id).stages[0]!.state).toBe("completed");
  expect(f.engine.startWorkflow).toHaveBeenCalledTimes(2);
  expect(restarted.advance(review.id).stages[1]!.state).toBe("blocked");
  expect(f.engine.startWorkflow).toHaveBeenCalledTimes(2);
  expect(f.repo.readPaper(f.paper.id)).toEqual(before);
});

it("does not redispatch an uncertain intent or send unsupported tool requests", () => {
  const f = fixture();
  expect(() => f.coordinator.create(f.scope, [{ ...f.request, options: { requiredTools: ["search"] } }])).toThrow(/Tool-enabled/);
  expect(f.engine.startWorkflow).not.toHaveBeenCalled();
  const review = f.coordinator.create(f.scope, [f.request]);
  f.engine.startWorkflow.mockImplementation(() => { throw new Error("Simulated crash after intent, before run persistence"); });
  expect(f.coordinator.advance(review.id).stages[0]!.state).toBe("blocked");
  const restarted = new ReviewStages(f.repo, f.index, f.engine);
  expect(restarted.advance(review.id).stages[0]!.state).toBe("blocked");
  expect(f.engine.startWorkflow).toHaveBeenCalledTimes(1);
});

it("rechecks revisions before dispatch and forbids canonical-writing or widened stages", () => {
  const f = fixture();
  expect(() => f.coordinator.create(f.scope, [{ ...f.request, type: "pdf-markdown-processing" }])).toThrow(/proposal-producing/);
  expect(() => f.coordinator.create(f.scope, [{ ...f.request, paperIds: [] }])).toThrow(/explicit selected/);
  const review = f.coordinator.create(f.scope, [f.request]);
  f.repo.writeMarkdown(f.paper.id, "# Updated\n\nAccuracy was corrected.");
  expect(() => f.coordinator.advance(review.id)).toThrow(/revision changed/);
  expect(f.engine.startWorkflow).not.toHaveBeenCalled();
});

it("never starts a reserved workflow ID twice in the existing engine", () => {
  const f = fixture(); const engine = new WorkflowEngine(f.repo, f.index);
  const request = { ...f.request, type: "key-findings", providerId: "local-heuristic", model: null, query: null, options: {}, collectionIds: [] } as WorkflowStartRequest;
  expect(() => engine.startWorkflow({ ...request, providerId: "driver.missing", model: "missing" })).toThrow(/no fallback/);
  expect(() => engine.startWorkflow({ ...request, options: { requiredTools: ["search"] } })).toThrow(/no request was dispatched/);
  expect(engine.listRuns()).toHaveLength(0);
  engine.startWorkflow(request, "run_reserved_fixture");
  expect(() => engine.startWorkflow(request, "run_reserved_fixture")).toThrow(/already dispatched/);
  expect(() => engine.startWorkflow(request, "../outside")).toThrow(/Invalid/);
});
