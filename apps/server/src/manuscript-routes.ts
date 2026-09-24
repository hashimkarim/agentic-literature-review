import { Router } from "express";
import { z } from "zod";
import { ManuscriptError, ManuscriptStore } from "@litagent/library";
import type { WritingCandidateService } from "@litagent/workflows";

export function manuscriptRoutes(store: ManuscriptStore, candidates?: WritingCandidateService): Router {
  const router = Router({ mergeParams: true });
  const param = (params: Record<string, unknown>, name: string) => z.string().parse(params[name]);
  const project = (params: Record<string, unknown>) => z.string().optional().parse(params.id);
  // Older project URLs remain aliases, never separate copies of a document.
  router.get("/", (req, res) => res.json(store.list(project(req.params) ?? (req.query.projectId === undefined ? undefined : z.string().parse(req.query.projectId)))));
  router.post("/", (req, res) => res.status(201).json(store.create(project(req.params) ? { ...req.body, projectIds: [project(req.params)] } : req.body)));
  router.use("/:manuscriptId", (req, _res, next) => {
    const projectId = project(req.params);
    if (projectId && !store.read(param(req.params, "manuscriptId")).projectIds.includes(projectId)) {
      throw new ManuscriptError(404, "manuscript_not_found", "Document is not linked to this project.");
    }
    next();
  });
  router.put("/:manuscriptId/projects", (req, res) => res.json(store.updateProjects(param(req.params, "manuscriptId"), req.body)));
  router.get("/:manuscriptId", (req, res) => res.json(store.read(param(req.params, "manuscriptId"))));
  router.put("/:manuscriptId/files", (req, res) => res.json(store.writeFile(param(req.params, "manuscriptId"), req.body)));
  router.delete("/:manuscriptId/files", (req, res) => {
    store.deleteFile(param(req.params, "manuscriptId"), req.body);
    res.json({ ok: true });
  });
  router.get("/:manuscriptId/history", (req, res) => res.json(store.history(param(req.params, "manuscriptId"), z.string().parse(req.query.path))));
  router.get("/:manuscriptId/history/:versionId", (req, res) => res.json(store.historicalFile(param(req.params, "manuscriptId"), z.string().parse(req.query.path), param(req.params, "versionId"))));
  router.post("/:manuscriptId/checkpoints", (req, res) => res.status(201).json(store.checkpoint(param(req.params, "manuscriptId"), req.body)));
  router.post("/:manuscriptId/restore", (req, res) => res.json(store.restore(param(req.params, "manuscriptId"), req.body)));
  if (candidates) {
    router.get("/:manuscriptId/candidates", (req, res) => res.json(candidates.list(param(req.params, "manuscriptId"))));
    router.post("/:manuscriptId/candidates", (req, res) => res.status(202).json(candidates.start(param(req.params, "manuscriptId"), req.body)));
    router.get("/:manuscriptId/candidates/:batchId", (req, res) => res.json(candidates.get(param(req.params, "manuscriptId"), param(req.params, "batchId"))));
    router.post("/:manuscriptId/candidates/:batchId/cancel", (req, res) => res.json(candidates.cancel(param(req.params, "manuscriptId"), param(req.params, "batchId"))));
    router.post("/:manuscriptId/candidates/:batchId/accept", (req, res) => res.json(candidates.accept(param(req.params, "manuscriptId"), param(req.params, "batchId"), req.body)));
  }
  router.use((error: unknown, _req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    if (error instanceof ManuscriptError) { res.status(error.status).json({ error: error.message, code: error.code }); return; }
    if (error instanceof z.ZodError) { res.status(400).json({ error: "Invalid manuscript request.", code: "invalid_manuscript_request" }); return; }
    next(error);
  });
  return router;
}
