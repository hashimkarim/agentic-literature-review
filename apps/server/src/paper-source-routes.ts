import path from "node:path";
import { Router } from "express";
import type { LitAgentRepository } from "@litagent/library";

export function paperSourceRoutes(repo: LitAgentRepository, indexPaper: (id: string) => void): Router {
  const router = Router();
  router.get("/:id/local-source", (req, res) => {
    const id = req.params.id;
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) { res.status(400).json({ error: "Invalid paper ID." }); return; }
    const before = repo.readPaper(id);
    if (before?.storage !== "linked-files") { res.status(404).json({ error: "No linked source for this paper." }); return; }
    const state = repo.localPapers.refresh(id).state;
    const paper = repo.readPaper(id)!;
    if (before.sourceRevision !== paper.sourceRevision) indexPaper(id);
    res.set("Cache-Control", "no-store").json({ paper, state });
  });
  router.get("/:id/markdown-assets", (req, res) => {
    if (typeof req.query.path !== "string") { res.status(400).json({ error: "An image path is required." }); return; }
    const bytes = repo.localPapers.asset(req.params.id, req.query.path);
    if (!bytes) { res.status(404).json({ error: "Markdown image is unavailable." }); return; }
    res.set("Cache-Control", "no-cache").set("X-Content-Type-Options", "nosniff").set("Content-Security-Policy", "sandbox");
    res.type(path.extname(req.query.path.split(/[?#]/, 1)[0]!) || "application/octet-stream").send(bytes);
  });
  return router;
}
