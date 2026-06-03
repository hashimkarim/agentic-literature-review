import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { WebSocketServer } from "ws";

import {
  AgentProviderSettingsPatchSchema,
  CreateAnnotationRequestSchema,
  CreateNoteRequestSchema,
  ImportPaperRequestSchema,
  LinkPaperRequestSchema,
  QaRequestSchema,
  SearchRequestSchema,
  UpdateAnnotationRequestSchema,
  UpdateNoteRequestSchema
} from "@litagent/contracts";
import { AgentProviderCatalog, AgentProviderSettingsStore } from "@litagent/agents";
import { SearchIndex } from "@litagent/indexer";
import { DEFAULT_REPO_ROOT, LitAgentRepository } from "@litagent/library";
import { WorkflowEngine, WorkflowStartRequestSchema, convertPaperWithMarker } from "@litagent/workflows";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.LITAGENT_PORT ?? 3874);
const repoRoot = process.env.LITAGENT_REPO ?? DEFAULT_REPO_ROOT;

const repo = new LitAgentRepository(repoRoot);
repo.init();
repo.seedDemoData();

const index = new SearchIndex(repo.resolve(".litagent/index.sqlite"));
index.rebuild(repo);

const providerSettings = new AgentProviderSettingsStore(repo.resolve(".litagent/provider-settings.json"));
const providers = new AgentProviderCatalog(undefined, providerSettings.read());
const workflows = new WorkflowEngine(repo, index, providers, undefined, providerSettings);
const upload = multer({ dest: repo.resolve(".litagent/cache/uploads") });

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

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

function indexPaper(paperId: string): void {
  const paper = repo.readPaper(paperId);
  if (!paper) return;
  index.indexPaper(paper, repo.readPassages(paperId));
}

function refreshProviders() {
  providers.setSettings(providerSettings.read());
  return providers.discover();
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
  "/api/papers/:id/passages",
  asyncHandler((req, res) => {
    res.json(repo.readPassages(routeParam(req, "id")));
  })
);

app.get(
  "/api/papers/:id/passages/:passageId/target",
  asyncHandler((req, res) => {
    const paperId = routeParam(req, "id");
    const passageId = routeParam(req, "passageId");
    const projectId = typeof req.query.projectId === "string" && req.query.projectId ? req.query.projectId : null;
    const target = repo.resolveCitationTarget({ paperId, passageId, projectId });
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
  })
);

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

app.post(
  "/api/qa",
  asyncHandler((req, res) => {
    res.json(workflows.answerQuestion(QaRequestSchema.parse(req.body)));
  })
);

app.get(
  "/api/workflows",
  asyncHandler((_req, res) => {
    res.json(workflows.listRuns());
  })
);

app.post(
  "/api/workflows",
  asyncHandler((req, res) => {
    const run = workflows.startWorkflow(WorkflowStartRequestSchema.parse(req.body));
    index.rebuild(repo);
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
  "/api/settings/providers",
  asyncHandler((_req, res) => {
    res.json(refreshProviders());
  })
);

app.patch(
  "/api/settings/providers/:providerId",
  asyncHandler((req, res) => {
    const providerId = routeParam(req, "providerId");
    providerSettings.patch(providerId, AgentProviderSettingsPatchSchema.parse(req.body));
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
    });
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

server.listen(port, () => {
  console.log(`LitAgent server listening on http://localhost:${port}`);
  console.log(`Research repository: ${repo.root}`);
});
