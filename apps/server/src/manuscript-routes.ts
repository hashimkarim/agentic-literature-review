import { Router } from "express";
import multer from "multer";
import { zip } from "fflate";
import { z } from "zod";
import { ManuscriptError, ManuscriptStore, inspectManuscriptZip, manuscriptLimits, ManuscriptTreeError } from "@litagent/library";
import type { WritingCandidateService, TexBuildService, WritingContextService } from "@litagent/workflows";

export function manuscriptRoutes(store: ManuscriptStore, candidates?: WritingCandidateService, builds?: TexBuildService, context?: WritingContextService): Router {
  const router = Router({ mergeParams: true });
  const param = (params: Record<string, unknown>, name: string) => z.string().parse(params[name]);
  const project = (params: Record<string, unknown>) => z.string().optional().parse(params.id);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: manuscriptLimits.archive, files: 1, fields: 1, fieldSize: 32_000, parts: 3 } });
  let importing = false;
  router.post(["/import/preview", "/import"], (req, res, next) => {
    if (importing) { res.status(429).json({ error: "Another document import is being processed. Try again shortly." }); return; }
    importing = true;
    res.once("finish", () => { importing = false; }); res.once("close", () => { importing = false; }); next();
  }, upload.single("archive"), async (req, res) => {
    if (!req.file) throw new ManuscriptError(400, "archive_required", "Choose a ZIP or folder to import.");
    let data: Awaited<ReturnType<typeof inspectManuscriptZip>>;
    try { data = await inspectManuscriptZip(req.file.buffer); }
    catch (error) { throw new ManuscriptError(400, "invalid_manuscript_archive", error instanceof z.ZodError ? "The archive contains an unsupported path." : error instanceof Error ? error.message : "Could not read ZIP."); }
    if (req.path.endsWith("/preview")) {
      const compiler = builds?.compiler.status();
      const warnings = [...data.preview.warnings];
      if (!compiler?.available) warnings.push(compiler?.message ?? "No compiler is configured. Files can still be imported and edited.");
      else if (compiler.engine !== "texlive" && data.preview.requirements.some((item) => item === "biber" || item === "glossaries" || item === "fonts")) warnings.push("This project needs the full offline TeX Live runtime for bibliography, glossary or custom font support.");
      res.json({ ...data.preview, warnings, compiler }); return;
    }
    let options: unknown;
    try { options = JSON.parse(req.body.options ?? "null"); } catch { throw new ManuscriptError(400, "invalid_import_options", "Invalid import options."); }
    const linkedProject = project(req.params);
    res.status(201).json(store.importDocument(linkedProject ? { ...z.object({}).passthrough().parse(options), projectIds: [linkedProject] } : options, data));
  });
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
  router.get("/:manuscriptId/comments", (req, res) => res.json(store.comments(param(req.params, "manuscriptId"))));
  router.post("/:manuscriptId/comments", (req, res) => res.status(201).json(store.createComment(param(req.params, "manuscriptId"), req.body)));
  router.patch("/:manuscriptId/comments/:commentId", (req, res) => res.json(store.updateComment(param(req.params, "manuscriptId"), param(req.params, "commentId"), req.body)));
  router.post("/:manuscriptId/tree", (req, res) => res.json(store.changeTree(param(req.params, "manuscriptId"), req.body)));
  router.post("/:manuscriptId/upload", multer({ storage: multer.memoryStorage(), limits: { fileSize: manuscriptLimits.asset, files: 1, fields: 2, fieldSize: 1000, parts: 4 } }).single("file"), (req, res) => {
    if (!req.file) throw new ManuscriptError(400, "file_required", "Choose a file to upload.");
    res.status(201).json(store.uploadFile(param(req.params, "manuscriptId"), z.string().parse(req.body.path), req.file.buffer, z.string().parse(req.body.expectedRevision)));
  });
  router.get("/:manuscriptId/assets", (req, res) => {
    const name = z.string().parse(req.query.path);
    const bytes = store.asset(param(req.params, "manuscriptId"), name, z.string().parse(req.query.revision));
    const extension = name.split(".").pop()!.toLowerCase();
    const mime: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", pdf: "application/pdf" };
    res.set({ "Content-Type": mime[extension] ?? "application/octet-stream", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Content-Disposition": `${mime[extension] ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name.split("/").pop()!)}` }).send(bytes);
  });
  router.get("/:manuscriptId/archive", async (req, res) => {
    const document = store.read(param(req.params, "manuscriptId"));
    const files: Record<string, Uint8Array> = Object.fromEntries(document.files.map((file) => [file.path, Buffer.from(file.content)]));
    for (const folder of document.folders ?? []) files[`${folder}/`] = new Uint8Array();
    for (const asset of document.assets ?? []) files[asset.path] = store.asset(document.id, asset.path, asset.revision);
    const bytes = await new Promise<Uint8Array>((resolve, reject) => zip(files, { level: 6 }, (error, data) => error ? reject(error) : resolve(data)));
    res.set({ "Content-Type": "application/zip", "Content-Disposition": "attachment; filename=manuscript.zip", "Cache-Control": "private, no-store" }).send(Buffer.from(bytes));
  });
  router.put("/:manuscriptId/files", (req, res) => res.json(store.writeFile(param(req.params, "manuscriptId"), req.body)));
  router.delete("/:manuscriptId/files", (req, res) => {
    store.deleteFile(param(req.params, "manuscriptId"), req.body);
    res.json({ ok: true });
  });
  router.get("/:manuscriptId/history", (req, res) => res.json(store.history(param(req.params, "manuscriptId"), z.string().parse(req.query.path))));
  router.get("/:manuscriptId/history/:versionId", (req, res) => res.json(store.historicalFile(param(req.params, "manuscriptId"), z.string().parse(req.query.path), param(req.params, "versionId"))));
  router.post("/:manuscriptId/checkpoints", (req, res) => res.status(201).json(store.checkpoint(param(req.params, "manuscriptId"), req.body)));
  router.post("/:manuscriptId/restore", (req, res) => res.json(store.restore(param(req.params, "manuscriptId"), req.body)));
  if (context) {
    router.get("/:manuscriptId/sources", (req, res) => res.json(context.catalog(param(req.params, "manuscriptId"))));
    router.post("/:manuscriptId/sources", (req, res) => res.status(201).json(store.attachWritingSource(param(req.params, "manuscriptId"), req.body)));
    router.delete("/:manuscriptId/sources/:sourceId", (req, res) => { store.removeWritingSource(param(req.params, "manuscriptId"), param(req.params, "sourceId")); res.json({ ok: true }); });
    router.post("/:manuscriptId/context", (req, res) => res.json(context.preview(param(req.params, "manuscriptId"), req.body)));
  }
  if (builds) {
    router.get("/:manuscriptId/builds/:buildId/source-map", (req, res) => res.json(builds.sourceMap(param(req.params, "manuscriptId"), param(req.params, "buildId"))));
    router.post("/:manuscriptId/builds/:buildId/comment-selection", (req, res) => res.json(builds.pdfCommentSelection(param(req.params, "manuscriptId"), param(req.params, "buildId"), req.body)));
    router.get("/:manuscriptId/builds", (req, res) => res.json(builds.get(param(req.params, "manuscriptId"))));
    router.post("/:manuscriptId/builds", (req, res) => res.status(202).json(builds.start(param(req.params, "manuscriptId"), req.body)));
    router.post("/:manuscriptId/builds/:buildId/cancel", (req, res) => res.json(builds.cancel(param(req.params, "manuscriptId"), param(req.params, "buildId"))));
    router.get("/:manuscriptId/builds/:buildId/pdf", (req, res) => {
      const pdf = builds.pdf(param(req.params, "manuscriptId"), param(req.params, "buildId"));
      res.set({ "Content-Type": "application/pdf", "Cache-Control": "private, no-store", "Content-Disposition": "inline; filename=manuscript.pdf", "X-Content-Type-Options": "nosniff" }).send(pdf);
    });
  }
  if (candidates) {
    router.get("/:manuscriptId/candidates", (req, res) => res.json(candidates.list(param(req.params, "manuscriptId"))));
    router.post("/:manuscriptId/candidates", (req, res) => res.status(202).json(candidates.start(param(req.params, "manuscriptId"), req.body)));
    router.get("/:manuscriptId/candidates/:batchId", (req, res) => res.json(candidates.get(param(req.params, "manuscriptId"), param(req.params, "batchId"))));
    router.post("/:manuscriptId/candidates/:batchId/cancel", (req, res) => res.json(candidates.cancel(param(req.params, "manuscriptId"), param(req.params, "batchId"))));
    router.post("/:manuscriptId/candidates/:batchId/accept", (req, res) => res.json(candidates.accept(param(req.params, "manuscriptId"), param(req.params, "batchId"), req.body)));
    router.post("/:manuscriptId/candidates/:batchId/dismiss", (req, res) => {
      const input = z.object({ candidateId: z.string(), dismissed: z.boolean() }).strict().parse(req.body);
      res.json(candidates.dismiss(param(req.params, "manuscriptId"), param(req.params, "batchId"), input.candidateId, input.dismissed));
    });
    router.post("/:manuscriptId/candidates/:batchId/references/:candidateId", (req, res) => res.json(candidates.addReferences(param(req.params, "manuscriptId"), param(req.params, "batchId"), param(req.params, "candidateId"), req.body)));
    router.post("/:manuscriptId/candidates/:batchId/evidence", (req, res) => {
      const input = z.object({ sourceId: z.string(), quote: z.string().max(2000) }).strict().parse(req.body);
      res.json(candidates.evidence(param(req.params, "manuscriptId"), param(req.params, "batchId"), input.sourceId, input.quote));
    });
  }
  router.use((error: unknown, _req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    if (error instanceof multer.MulterError) { res.status(413).json({ error: "Import upload exceeds its file, field or size limit (128 MB ZIP).", code: "import_limit" }); return; }
    if (error instanceof ManuscriptTreeError) { res.status(400).json({ error: error.message, code: "invalid_tree" }); return; }
    if (error instanceof ManuscriptError) { res.status(error.status).json({ error: error.message, code: error.code }); return; }
    if (error instanceof z.ZodError) { res.status(400).json({ error: "Invalid manuscript request.", code: "invalid_manuscript_request" }); return; }
    next(error);
  });
  return router;
}
