import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ReviewEvidenceScopeSchema, type ReviewEvidenceScope } from "@litagent/contracts";
import { createId, type LitAgentRepository } from "@litagent/library";
import type { SearchIndex } from "@litagent/indexer";
import { WorkflowStartRequestSchema, type WorkflowEngine } from "./index";
import { ReviewEvidence } from "./review-evidence";

const StageRequest = WorkflowStartRequestSchema.refine((request) =>
  ["relevance-tagging", "metadata-extraction", "key-findings", "compare-papers", "synthesis-note"].includes(request.type), "Only proposal-producing review stages are permitted");
const Checkpoint = z.object({
  id: z.string().regex(/^review_[A-Za-z0-9_-]+$/),
  scope: ReviewEvidenceScopeSchema,
  stages: z.array(z.object({
    runId: z.string().regex(/^run_[A-Za-z0-9_-]+$/), request: StageRequest,
    state: z.enum(["pending", "dispatched", "completed", "blocked"]), message: z.string().nullable()
  })).min(1).max(500)
});

/** Single-backend, synchronous checkpoint coordinator; execution stays in WorkflowEngine. */
export class ReviewStages {
  constructor(private repo: LitAgentRepository, private index: SearchIndex,
    private workflows: Pick<WorkflowEngine, "startWorkflow" | "readRun" | "hasActiveRun">) {}

  create(scope: ReviewEvidenceScope, requests: unknown[]) {
    const evidence = new ReviewEvidence(this.repo, this.index, scope);
    const checkpoint = Checkpoint.parse({ id: createId("review"), scope: evidence.scope,
      stages: requests.map((input) => ({ runId: createId("run"), request: StageRequest.parse(input), state: "pending", message: null })) });
    const selected = new Set(scope.sources.map((source) => source.paperId));
    for (const stage of checkpoint.stages) {
      if (stage.request.projectId !== scope.projectId || !stage.request.paperIds.length || stage.request.collectionIds.length || stage.request.paperIds.some((id) => !selected.has(id))) {
        throw new Error("Review stages must use explicit selected papers and the same project scope.");
      }
      if (!stage.request.providerId.startsWith("driver.") || !stage.request.model) throw new Error("Review stages require an explicit driver and model.");
      if (stage.request.options.tools || stage.request.options.requiredTools) throw new Error("Tool-enabled review stages are not connected to a qualified execution route.");
    }
    this.write(checkpoint);
    return checkpoint;
  }

  read(id: string) {
    if (!/^review_[A-Za-z0-9_-]+$/.test(id)) throw new Error("Invalid review ID.");
    return Checkpoint.parse(JSON.parse(fs.readFileSync(this.repo.resolve(`workflows/reviews/${id}.json`), "utf8")));
  }

  advance(id: string) {
    const checkpoint = this.read(id);
    new ReviewEvidence(this.repo, this.index, checkpoint.scope).assertCurrent();
    for (const stage of checkpoint.stages) {
      if (stage.state === "completed") continue;
      const runPath = this.repo.resolve(`workflows/${stage.runId}.run.json`);
      if (fs.existsSync(runPath)) {
        const { run } = this.workflows.readRun(stage.runId);
        if (run.id !== stage.runId || run.type !== stage.request.type || run.providerId !== stage.request.providerId || run.model !== stage.request.model || run.projectId !== stage.request.projectId || JSON.stringify(run.scope.paperIds) !== JSON.stringify(stage.request.paperIds)) {
          throw new Error("Persisted workflow does not match the reserved review stage.");
        }
        if (run.status === "completed") { stage.state = "completed"; stage.message = null; this.write(checkpoint); continue; }
        stage.state = this.workflows.hasActiveRun(run.id) ? "dispatched" : "blocked";
        stage.message = stage.state === "blocked" ? "Existing workflow needs reconciliation; it will not be replayed automatically." : null;
        this.write(checkpoint); return checkpoint;
      }
      if (stage.state !== "pending") {
        stage.state = "blocked"; stage.message = "Dispatch outcome is uncertain; reconcile before starting another attempt.";
        this.write(checkpoint); return checkpoint;
      }
      // Durable intent precedes provider dispatch, including the crash window before run creation.
      stage.state = "dispatched"; this.write(checkpoint);
      try { this.workflows.startWorkflow(stage.request, stage.runId); }
      catch {
        stage.state = "blocked"; stage.message = "Stage dispatch failed; inspect its existing workflow before retrying.";
        this.write(checkpoint);
      }
      return checkpoint;
    }
    return checkpoint;
  }

  private write(checkpoint: z.infer<typeof Checkpoint>) {
    const dir = this.repo.resolve("workflows/reviews"); fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, `${checkpoint.id}.json`), temporary = `${target}.${createId("write")}.tmp`;
    try {
      const fd = fs.openSync(temporary, "wx", 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(Checkpoint.parse(checkpoint), null, 2)); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
      fs.renameSync(temporary, target);
      const directoryFd = fs.openSync(dir, "r"); try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
    } finally { fs.rmSync(temporary, { force: true }); }
  }
}
