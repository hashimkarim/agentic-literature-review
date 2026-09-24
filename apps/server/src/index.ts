import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { WebSocketServer } from "ws";
import { z } from "zod";

import {
  AgentProviderSettingsPatchSchema,
  CreateAnnotationRequestSchema,
  CreateNoteRequestSchema,
  ImportPaperRequestSchema,
  LinkPaperRequestSchema,
  ProposalReviewStatusSchema,
  QaRequestSchema,
  QaThreadRequestSchema,
  ReviewMetadataProposalRequestSchema,
  ReviewComparisonArtifactRequestSchema,
  ReviewResearchFindingProposalRequestSchema,
  ReviewRelevanceProposalRequestSchema,
  ReviewSynthesisArtifactRequestSchema,
  SearchRequestSchema,
  UpdateAnnotationRequestSchema,
  UpdateNoteRequestSchema
} from "@litagent/contracts";
import { AgentHarness, AgentProviderSettingsStore } from "@litagent/agents";
import { agenticDriverCatalogFromEnvironment } from "@litagent/agents/agenticdriver";
import { SearchIndex } from "@litagent/indexer";
import { CitationSourceChangedError, DEFAULT_REPO_ROOT, LitAgentRepository, ManuscriptStore } from "@litagent/library";
import { manuscriptRoutes } from "./manuscript-routes";
import { TexBuildService } from "@litagent/workflows";
import { WorkflowEngine, WorkflowStartRequestSchema, QaThreadConflictError, convertPaperWithMarker, discoverPdfInputs, markerRuntimeStatus, PdfProcessingOptionsSchema, WritingCandidateService, writingTargetValidator } from "@litagent/workflows";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.LITAGENT_PORT ?? 3874);
const repoRoot = process.env.LITAGENT_REPO ?? DEFAULT_REPO_ROOT;

const repo = new LitAgentRepository(repoRoot);
repo.init();
repo.seedDemoData();

const index = new SearchIndex(repo.resolve(".litagent/index.sqlite"));
index.rebuild(repo);

const providerSettings = new AgentProviderSettingsStore(repo.resolve(".litagent/provider-settings.json"));
const providers = await agenticDriverCatalogFromEnvironment(providerSettings.read());
const workflows = new WorkflowEngine(repo, index, providers, undefined, providerSettings);
const upload = multer({ dest: repo.resolve(".litagent/cache/uploads") });

const PdfInboxAutomationRuleSchema = z.object({
  id: z.literal("pdf-inbox"),
  enabled: z.boolean().default(false),
  eventTriggerEnabled: z.boolean().default(true),
  timerTriggerEnabled: z.boolean().default(false),
  intervalMinutes: z.number().int().positive().max(1440).default(15),
  sourceDir: z.string().min(1).default("pdfs"),
  force: z.boolean().default(false),
  projectId: z.string().nullable().default(null),
  knownKeys: z.array(z.string()).default([]),
  lastCheckedAt: z.string().datetime().nullable().default(null),
  lastRunAt: z.string().datetime().nullable().default(null),
  updatedAt: z.string().datetime()
});
type PdfInboxAutomationRule = z.infer<typeof PdfInboxAutomationRuleSchema>;

const PdfInboxAutomationPatchSchema = PdfInboxAutomationRuleSchema.partial().omit({
  id: true,
  knownKeys: true,
  lastCheckedAt: true,
  lastRunAt: true,
  updatedAt: true
});

const automationPath = repo.resolve(".litagent/workflow-automations.json");

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
const manuscripts = new ManuscriptStore(repo.root);
const writingCandidates = new WritingCandidateService(manuscripts, new AgentHarness({ catalog: providers }), writingTargetValidator(providers, () => providerSettings.read()));
const texBuilds = new TexBuildService(manuscripts);
app.use("/api/manuscripts", manuscriptRoutes(manuscripts, writingCandidates, texBuilds));
app.use("/api/projects/:id/manuscripts", manuscriptRoutes(manuscripts, writingCandidates, texBuilds));

function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void> | void
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function parseJsonField(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (!value.trim()) return undefined;
  return JSON.parse(value);
}

function routeParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== "string" || !value) {
    throw new Error(`Missing route parameter: ${name}`);
  }
  return value;
}

function queryString(req: Request, name: string): string | null {
  const value = req.query[name];
  return typeof value === "string" && value ? value : null;
}

function qaThreadScopeFromQuery(req: Request) {
  const paperIds = queryString(req, "paperIds")?.split(",").map((paperId) => paperId.trim()).filter(Boolean) ?? [];
  return QaThreadRequestSchema.parse({
    projectId: queryString(req, "projectId"),
    paperId: queryString(req, "paperId"),
    collectionId: queryString(req, "collectionId"),
    paperIds
  });
}

function staticContentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".apng":
      return "image/apng";
    case ".avif":
      return "image/avif";
    case ".bmp":
      return "image/bmp";
    case ".gif":
      return "image/gif";
    case ".jpg":
    case ".jpeg":
    case ".jfif":
    case ".pjpeg":
    case ".pjp":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".svg":
    case ".svgz":
      return "image/svg+xml";
    case ".tif":
    case ".tiff":
      return "image/tiff";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function decodeUrlPath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeMarkdownAssetPath(value: string): string {
  const normalized = decodeUrlPath(value).replaceAll("\\", "/").replace(/^\/+/, "").replace(/^(\.\/)+/, "");
  const parts = normalized.split("/").filter(Boolean);
  const assetsIndex = parts.findIndex((part) => part === "assets");
  return (assetsIndex >= 0 ? parts.slice(assetsIndex + 1) : parts).join("/");
}

function indexPaper(paperId: string): void {
  const paper = repo.readPaper(paperId);
  if (!paper) return;
  index.indexPaper(paper, repo.readPassages(paperId));
}

function refreshProviders() {
  providers.setSettings(providerSettings.read());
  return providers.discover();
}

function defaultPdfInboxAutomation(): PdfInboxAutomationRule {
  return PdfInboxAutomationRuleSchema.parse({
    id: "pdf-inbox",
    updatedAt: new Date().toISOString()
  });
}

function readPdfInboxAutomation(): PdfInboxAutomationRule {
  if (!fs.existsSync(automationPath)) return defaultPdfInboxAutomation();
  const parsed = JSON.parse(fs.readFileSync(automationPath, "utf8")) as { pdfInbox?: unknown };
  return PdfInboxAutomationRuleSchema.parse(parsed.pdfInbox ?? defaultPdfInboxAutomation());
}

function writePdfInboxAutomation(rule: PdfInboxAutomationRule): PdfInboxAutomationRule {
  fs.mkdirSync(path.dirname(automationPath), { recursive: true });
  const parsed = fs.existsSync(automationPath) ? JSON.parse(fs.readFileSync(automationPath, "utf8")) : {};
  const updated = PdfInboxAutomationRuleSchema.parse({ ...rule, updatedAt: new Date().toISOString() });
  fs.writeFileSync(automationPath, `${JSON.stringify({ ...parsed, pdfInbox: updated }, null, 2)}\n`, "utf8");
  return updated;
}

function pdfInboxKey(item: { sourcePath: string; size: number; modifiedAt: string }): string {
  return `${item.sourcePath}:${item.size}:${item.modifiedAt}`;
}

function runPdfInboxAutomation(reason: "event" | "timer" | "manual"): { runId: string | null; matched: number; reason: string } {
  const rule = readPdfInboxAutomation();
  const now = new Date();
  const discovered = discoverPdfInputs(repo, { sourceDir: rule.sourceDir });
  const discoveredKeys = discovered.map(pdfInboxKey);
  const known = new Set(rule.knownKeys);
  const newItems = discovered.filter((item) => !known.has(pdfInboxKey(item)));
  const due =
    rule.timerTriggerEnabled &&
    (!rule.lastRunAt || now.getTime() - new Date(rule.lastRunAt).getTime() >= rule.intervalMinutes * 60_000);

  const checked = writePdfInboxAutomation({
    ...rule,
    knownKeys: [...new Set([...rule.knownKeys, ...discoveredKeys])],
    lastCheckedAt: now.toISOString()
  });

  if (reason !== "manual" && (!checked.enabled || (!checked.eventTriggerEnabled && !checked.timerTriggerEnabled))) {
    return { runId: null, matched: discovered.length, reason };
  }
  if (reason === "event" && newItems.length === 0) return { runId: null, matched: discovered.length, reason };
  if (reason === "timer" && !due) return { runId: null, matched: discovered.length, reason };
  if (discovered.length === 0) return { runId: null, matched: 0, reason };

  const run = workflows.startWorkflow(
    WorkflowStartRequestSchema.parse({
      type: "pdf-markdown-processing",
      projectId: checked.projectId,
      providerId: "local-heuristic",
      model: null,
      options: {
        sourceDir: checked.sourceDir,
        force: checked.force
      }
    })
  );
  writePdfInboxAutomation({ ...checked, lastRunAt: new Date().toISOString() });
  return { runId: run.id, matched: discovered.length, reason };
}

app.get(
  "/api/status",
  asyncHandler((_req, res) => {
    const projects = repo.listProjects();
    const papers = repo.listGlobalPapers();
    res.json({
      repoRoot: repo.root,
      projects: projects.length,
      papers: papers.length,
      git: repo.gitStatus(),
      providers: []
    });
  })
);

app.get(
  "/api/projects",
  asyncHandler((_req, res) => {
    res.json(repo.listProjects());
  })
);

app.post(
  "/api/projects",
  asyncHandler((req, res) => {
    const project = repo.createProject({
      name: String(req.body.name ?? "Untitled project"),
      description: String(req.body.description ?? ""),
      defaultProvider: String(req.body.defaultProvider ?? "codex"),
      researchQuestion: typeof req.body.researchQuestion === "string" ? req.body.researchQuestion : undefined
    });
    res.status(201).json(repo.getProjectDetails(project.id));
  })
);

app.get(
  "/api/projects/:id",
  asyncHandler((req, res) => {
    res.json(repo.getProjectDetails(routeParam(req, "id")));
  })
);

app.get(
  "/api/projects/:id/papers",
  asyncHandler((req, res) => {
    res.json(repo.listPapers(routeParam(req, "id")));
  })
);

app.get(
  "/api/projects/:id/notes",
  asyncHandler((req, res) => {
    res.json(repo.listNotes(routeParam(req, "id")));
  })
);

app.post(
  "/api/projects/:id/notes",
  asyncHandler((req, res) => {
    const note = repo.createNote(routeParam(req, "id"), CreateNoteRequestSchema.parse(req.body));
    res.status(201).json(note);
  })
);

app.get(
  "/api/projects/:id/notes/:noteId",
  asyncHandler((req, res) => {
    const note = repo.readNote(routeParam(req, "id"), routeParam(req, "noteId"));
    if (!note) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    res.json(note);
  })
);

app.patch(
  "/api/projects/:id/notes/:noteId",
  asyncHandler((req, res) => {
    res.json(repo.updateNote(routeParam(req, "id"), routeParam(req, "noteId"), UpdateNoteRequestSchema.parse(req.body)));
  })
);

app.delete(
  "/api/projects/:id/notes/:noteId",
  asyncHandler((req, res) => {
    res.json(repo.deleteNote(routeParam(req, "id"), routeParam(req, "noteId")));
  })
);

app.get(
  "/api/projects/:id/relevance-proposals",
  asyncHandler((req, res) => {
    const paperId = queryString(req, "paperId");
    const statusValue = queryString(req, "status");
    const status = statusValue ? ProposalReviewStatusSchema.parse(statusValue) : null;
    res.json(repo.listRelevanceProposals(routeParam(req, "id"), { paperId, status }));
  })
);

app.patch(
  "/api/projects/:id/relevance-proposals/:proposalId",
  asyncHandler((req, res) => {
    res.json(
      repo.reviewRelevanceProposal(
        routeParam(req, "id"),
        routeParam(req, "proposalId"),
        ReviewRelevanceProposalRequestSchema.parse(req.body)
      )
    );
  })
);

app.get(
  "/api/projects/:id/annotations",
  asyncHandler((req, res) => {
    const paperId = typeof req.query.paperId === "string" && req.query.paperId ? req.query.paperId : null;
    res.json(repo.listAnnotations(routeParam(req, "id"), paperId));
  })
);

app.post(
  "/api/projects/:id/annotations",
  asyncHandler((req, res) => {
    const annotation = repo.createAnnotation(
      CreateAnnotationRequestSchema.parse({ ...req.body, projectId: routeParam(req, "id") })
    );
    res.status(201).json(annotation);
  })
);

app.patch(
  "/api/projects/:id/annotations/:annotationId",
  asyncHandler((req, res) => {
    res.json(
      repo.updateAnnotation(
        routeParam(req, "id"),
        routeParam(req, "annotationId"),
        UpdateAnnotationRequestSchema.parse(req.body)
      )
    );
  })
);

app.delete(
  "/api/projects/:id/annotations/:annotationId",
  asyncHandler((req, res) => {
    res.json(repo.deleteAnnotation(routeParam(req, "id"), routeParam(req, "annotationId")));
  })
);

app.get(
  "/api/papers",
  asyncHandler((req, res) => {
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : null;
    res.json(repo.listPapers(projectId));
  })
);

app.post(
  "/api/papers/import",
  upload.single("file"),
  asyncHandler((req, res) => {
    const sourcePath = req.file?.path ?? (typeof req.body.sourcePath === "string" ? req.body.sourcePath : undefined);
    const projectId = typeof req.body.projectId === "string" && req.body.projectId ? req.body.projectId : null;
    const metadata = parseJsonField(req.body.metadata) ?? req.body.metadata ?? {};
    const subcollectionIds = parseJsonField(req.body.subcollectionIds) ?? [];
    const projectTags = parseJsonField(req.body.projectTags) ?? [];
    const request = ImportPaperRequestSchema.parse({
      sourcePath,
      projectId,
      metadata,
      subcollectionIds,
      projectTags
    });
    const result = repo.importPaper(request);
    if (req.file?.path) fs.rmSync(req.file.path, { force: true });
    indexPaper(result.paper.id);
    res.status(201).json(result);
  })
);

app.post(
  "/api/papers/:id/link-project",
  asyncHandler((req, res) => {
    const link = repo.linkPaperToProject(routeParam(req, "id"), LinkPaperRequestSchema.parse(req.body));
    res.status(201).json(link);
  })
);

app.get(
  "/api/papers/:id/metadata-proposals",
  asyncHandler((req, res) => {
    const statusValue = queryString(req, "status");
    const status = statusValue ? ProposalReviewStatusSchema.parse(statusValue) : null;
    res.json(repo.listMetadataProposals(routeParam(req, "id"), { status }));
  })
);

app.patch(
  "/api/papers/:id/metadata-proposals/:proposalId",
  asyncHandler((req, res) => {
    res.json(
      repo.reviewMetadataProposal(
        routeParam(req, "id"),
        routeParam(req, "proposalId"),
        ReviewMetadataProposalRequestSchema.parse(req.body)
      )
    );
  })
);

app.get(
  "/api/papers/:id/finding-proposals",
  asyncHandler((req, res) => {
    const projectId = queryString(req, "projectId");
    const statusValue = queryString(req, "status");
    const status = statusValue ? ProposalReviewStatusSchema.parse(statusValue) : null;
    res.json(
      repo.listResearchFindingProposals(
        routeParam(req, "id"),
        projectId ? { projectId, status } : { status }
      )
    );
  })
);

app.patch(
  "/api/papers/:id/finding-proposals/:proposalId",
  asyncHandler((req, res) => {
    res.json(
      repo.reviewResearchFindingProposal(
        routeParam(req, "id"),
        routeParam(req, "proposalId"),
        ReviewResearchFindingProposalRequestSchema.parse(req.body)
      )
    );
  })
);

app.get(
  "/api/papers/:id/findings",
  asyncHandler((req, res) => {
    const projectId = queryString(req, "projectId");
    res.json(repo.listResearchRecords(routeParam(req, "id"), projectId ?? undefined));
  })
);

app.post(
  "/api/papers/:id/convert",
  asyncHandler((req, res) => {
    const paperId = routeParam(req, "id");
    const result = convertPaperWithMarker(repo, paperId);
    indexPaper(paperId);
    res.json(result);
  })
);

app.get(
  "/api/pdf-inbox",
  asyncHandler((req, res) => {
    const only = typeof req.query.only === "string" && req.query.only ? [req.query.only] : [];
    const sourceDir = typeof req.query.sourceDir === "string" && req.query.sourceDir ? req.query.sourceDir : "pdfs";
    const limit = typeof req.query.limit === "string" && req.query.limit ? Number(req.query.limit) : undefined;
    res.json(discoverPdfInputs(repo, PdfProcessingOptionsSchema.parse({ sourceDir, only, limit })));
  })
);

app.get(
  "/api/workflow-automations/pdf-inbox",
  asyncHandler((_req, res) => {
    res.json(readPdfInboxAutomation());
  })
);

app.patch(
  "/api/workflow-automations/pdf-inbox",
  asyncHandler((req, res) => {
    const current = readPdfInboxAutomation();
    const patch = PdfInboxAutomationPatchSchema.parse(req.body);
    const definedPatch = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
    res.json(writePdfInboxAutomation({ ...current, ...definedPatch }));
  })
);

app.post(
  "/api/workflow-automations/pdf-inbox/run",
  asyncHandler((_req, res) => {
    res.status(201).json(runPdfInboxAutomation("manual"));
  })
);

app.get(
  "/api/papers/:id/pdf",
  asyncHandler((req, res) => {
    const pdfPath = repo.pdfPath(routeParam(req, "id"));
    if (!pdfPath || !fs.existsSync(pdfPath)) {
      res.status(404).json({ error: "PDF not found" });
      return;
    }
    const stat = fs.statSync(pdfPath);
    const range = req.headers.range;
    if (typeof range === "string") {
      const match = range.match(/^bytes=(\d*)-(\d*)$/);
      if (!match) {
        res.status(416).setHeader("Content-Range", `bytes */${stat.size}`).end();
        return;
      }
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Number(match[2]) : stat.size - 1;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || end >= stat.size) {
        res.status(416).setHeader("Content-Range", `bytes */${stat.size}`).end();
        return;
      }
      res.status(206);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Length", String(end - start + 1));
      res.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`);
      fs.createReadStream(pdfPath, { start, end }).pipe(res);
      return;
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Length", String(stat.size));
    fs.createReadStream(pdfPath).pipe(res);
  })
);

app.get(
  "/api/papers/:id/markdown",
  asyncHandler((req, res) => {
    const markdown = repo.readMarkdown(routeParam(req, "id"));
    if (!markdown) {
      res.status(404).json({ error: "Markdown not found" });
      return;
    }
    res.type("text/markdown").send(markdown);
  })
);

app.get(
  /^\/api\/papers\/([^/]+)\/markdown-assets\/(.+)$/,
  asyncHandler((req, res) => {
    const paperId = String(req.params[0] ?? "");
    const assetPath = normalizeMarkdownAssetPath(String(req.params[1] ?? ""));
    const assetRoot = path.resolve(repo.resolve(`library/markdown/${paperId}/assets`));
    const resolvedAsset = path.resolve(assetRoot, assetPath);
    if (!resolvedAsset.startsWith(assetRoot + path.sep) && resolvedAsset !== assetRoot) {
      res.status(400).json({ error: "Invalid asset path" });
      return;
    }
    if (!fs.existsSync(resolvedAsset)) {
      res.status(404).json({ error: "Markdown asset not found" });
      return;
    }
    const stat = fs.statSync(resolvedAsset);
    if (!stat.isFile()) {
      res.status(404).json({ error: "Markdown asset not found" });
      return;
    }
    res.setHeader("Content-Type", staticContentType(resolvedAsset));
    res.setHeader("Content-Length", String(stat.size));
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    const stream = fs.createReadStream(resolvedAsset);
    stream.on("error", (error) => {
      if (!res.headersSent) {
        res.status(500).json({ error: error.message });
        return;
      }
      res.destroy(error);
    });
    stream.pipe(res);
  })
);

app.get(
  "/api/papers/:id/passages",
  asyncHandler((req, res) => {
    res.json(repo.readPassages(routeParam(req, "id")));
  })
);

const citationTargetHandler = asyncHandler((req, res) => {
    const paperId = routeParam(req, "id");
    const passageId = routeParam(req, "passageId");
    const projectId = typeof req.query.projectId === "string" && req.query.projectId ? req.query.projectId : null;
    const target = repo.resolveCitationTarget({
      ...(req.method === "POST" ? req.body : {}), paperId, passageId, projectId
    });
    res.json({
      ...target,
      pdf: {
        ...target.pdf,
        url: target.pdf.available
          ? `/api/papers/${encodeURIComponent(paperId)}/pdf${target.pdf.page ? `#page=${target.pdf.page}` : ""}`
          : null
      },
      markdown: {
        ...target.markdown,
        url: target.markdown.available
          ? `/api/papers/${encodeURIComponent(paperId)}/markdown${
              target.markdown.startLine ? `#L${target.markdown.startLine}${target.markdown.endLine ? `-L${target.markdown.endLine}` : ""}` : ""
            }`
          : null
      }
    });
});
app.get("/api/papers/:id/passages/:passageId/target", citationTargetHandler);
app.post("/api/papers/:id/passages/:passageId/target", citationTargetHandler);

app.post(
  "/api/index/rebuild",
  asyncHandler((_req, res) => {
    index.rebuild(repo);
    res.json({ status: "ok" });
  })
);

app.post(
  "/api/search",
  asyncHandler((req, res) => {
    res.json(index.search(repo, SearchRequestSchema.parse(req.body)));
  })
);

app.get(
  "/api/qa/thread",
  asyncHandler((req, res) => {
    res.json(workflows.readQaThread(qaThreadScopeFromQuery(req)));
  })
);

app.delete(
  "/api/qa/thread",
  asyncHandler((req, res) => {
    const revision = queryString(req, "threadRevision");
    res.json(workflows.clearQaThread({
      ...qaThreadScopeFromQuery(req), ...(revision === null ? {} : { threadRevision: Number(revision) })
    }));
  })
);

app.post(
  "/api/qa",
  asyncHandler(async (req, res) => {
    const parsed = QaRequestSchema.parse(req.body);
    const { response } = await workflows.answerQuestionInThread(parsed);
    res.json(response);
  })
);

app.get(
  "/api/workflows",
  asyncHandler((_req, res) => {
    res.json(workflows.listRuns());
  })
);

app.get(
  "/api/comparisons",
  asyncHandler((req, res) => {
    res.json(workflows.listComparisonArtifacts(queryString(req, "projectId")));
  })
);

app.get(
  "/api/comparisons/:comparisonId",
  asyncHandler((req, res) => {
    const artifact = workflows.readComparisonArtifact(
      queryString(req, "projectId"),
      routeParam(req, "comparisonId")
    );
    if (!artifact) {
      res.status(404).json({ error: "Comparison artifact not found" });
      return;
    }
    res.json(artifact);
  })
);

app.patch(
  "/api/comparisons/:comparisonId",
  asyncHandler((req, res) => {
    res.json(workflows.reviewComparisonArtifact(
      queryString(req, "projectId"),
      routeParam(req, "comparisonId"),
      ReviewComparisonArtifactRequestSchema.parse(req.body)
    ));
  })
);

app.get(
  "/api/projects/:id/syntheses",
  asyncHandler((req, res) => {
    res.json(workflows.listSynthesisArtifacts(routeParam(req, "id")));
  })
);

app.patch(
  "/api/projects/:id/syntheses/:synthesisId",
  asyncHandler((req, res) => {
    res.json(workflows.reviewSynthesisArtifact(
      routeParam(req, "id"),
      routeParam(req, "synthesisId"),
      ReviewSynthesisArtifactRequestSchema.parse(req.body)
    ));
  })
);

app.post(
  "/api/workflows",
  asyncHandler((req, res) => {
    const run = workflows.startWorkflow(WorkflowStartRequestSchema.parse(req.body));
    res.status(201).json(run);
  })
);

app.get(
  "/api/workflows/:runId",
  asyncHandler((req, res) => {
    res.json(workflows.readRun(routeParam(req, "runId")));
  })
);

app.post(
  "/api/workflows/:runId/cancel",
  asyncHandler((req, res) => {
    res.json(workflows.cancelRun(routeParam(req, "runId")));
  })
);

app.get(
  "/api/exports/:projectId/bib",
  asyncHandler((req, res) => {
    const bibtex = repo.exportBibTeX(routeParam(req, "projectId"));
    res.type("text/x-bibtex").send(bibtex);
  })
);

app.get(
  "/api/provider-status",
  asyncHandler((_req, res) => {
    res.json(refreshProviders());
  })
);

app.get(
  "/api/converter-status",
  asyncHandler((_req, res) => {
    res.json({
      marker: markerRuntimeStatus()
    });
  })
);

app.get(
  "/api/settings/providers",
  asyncHandler((_req, res) => {
    res.json(refreshProviders());
  })
);

app.patch(
  "/api/settings/providers/:providerId",
  asyncHandler((req, res) => {
    const providerId = routeParam(req, "providerId");
    const definition = providers.definition(providerId);
    if (!definition) {
      res.status(404).json({ error: `Unknown provider: ${providerId}` });
      return;
    }
    providerSettings.patch(providerId, AgentProviderSettingsPatchSchema.parse(req.body), [definition]);
    res.json(refreshProviders());
  })
);

app.post(
  "/api/settings/providers/:providerId/connect",
  asyncHandler((req, res) => {
    const providerId = routeParam(req, "providerId");
    const provider = refreshProviders().find((candidate) => candidate.id === providerId);
    if (!provider) {
      res.status(404).json({ error: `Unknown provider: ${providerId}` });
      return;
    }
    if (!provider.installed) {
      res.status(400).json({ error: `${provider.label} command is not installed: ${provider.command}` });
      return;
    }
    providerSettings.patch(providerId, {
      enabled: true,
      connected: provider.authStatus !== "unavailable"
    }, [providers.definition(providerId)!]);
    res.json(refreshProviders());
  })
);

const webDist = path.resolve(__dirname, "../../web/dist");
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });
}

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof CitationSourceChangedError) {
    res.status(409).json({ error: error.message, code: error.code });
    return;
  }
  if (error instanceof QaThreadConflictError) {
    res.status(409).json({ error: error.message, code: error.code });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  res.status(500).json({ error: message });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on("connection", (socket, request) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const match = url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
  if (!match) {
    socket.close(1008, "Unsupported WebSocket path");
    return;
  }
  const runId = match[1];
  if (!runId) {
    socket.close(1008, "Missing run id");
    return;
  }
  let sent = 0;
  const sendEvents = () => {
    try {
      const { events } = workflows.readRun(runId);
      for (const event of events.slice(sent)) {
        socket.send(JSON.stringify(event));
      }
      sent = events.length;
    } catch (error) {
      socket.send(JSON.stringify({ type: "run.failed", message: error instanceof Error ? error.message : String(error) }));
    }
  };
  sendEvents();
  const timer = setInterval(sendEvents, 1000);
  socket.on("close", () => clearInterval(timer));
});

const automationTimer = setInterval(() => {
  try {
    runPdfInboxAutomation("event");
    runPdfInboxAutomation("timer");
  } catch (error) {
    console.warn("PDF inbox automation skipped:", error instanceof Error ? error.message : String(error));
  }
}, 60_000);
server.on("close", () => clearInterval(automationTimer));

server.listen(port, () => {
  console.log(`LitAgent server listening on http://localhost:${port}`);
  console.log(`Research repository: ${repo.root}`);
});
