import type { ComponentType, CSSProperties, Dispatch, ReactNode, SetStateAction } from "react";
import { Children, isValidElement, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import * as Lucide from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import type { AgentProvider, CitationTarget, EvidenceRef, Passage, Project, QaResponse, WorkflowRun, WorkflowType } from "@litagent/contracts";
import { PdfReader, PdfUnavailable } from "@litagent/pdf";
import type { PdfAnnotation } from "@litagent/pdf";
import { workflowLabels } from "@litagent/ui";

import { API_BASE, api, type AppStatus, type ConverterStatus, type PaperEntry, type PdfInboxAutomationRule, type PdfInboxItem, type ProjectDetails } from "./api";

type Screen = "library" | "projects" | "search" | "settings" | "presets";
type WorkspaceTool = "papers" | "workflows" | "map" | "notes" | "exports";
type ReaderTab = "pdf" | "markdown" | "notes";
type SettingsSection = "providers" | "defaults" | "appearance" | "storage" | "about";

interface UiPaper {
  id: string;
  title: string;
  authors: string;
  firstAuthor: string;
  year: number | null;
  venue: string;
  type: string;
  citekey: string;
  doi: string;
  pages: number;
  added: string;
  tags: string[];
  projectTags: string[];
  methods: string[];
  projectIds: string[];
  projectNames: string[];
  screen: "include" | "exclude" | "maybe" | "unscreened";
  starred: boolean;
  abstract: string;
  entry: PaperEntry;
}

interface UiProject {
  id: string;
  name: string;
  sub: string;
  questions: Array<{ id: string; text: string; papers: number }>;
  subcollections: Array<{ id: string; name: string; n: number; icon: string }>;
  tags: string[];
  screen: { include: number; exclude: number; maybe: number; todo: number };
  raw: Project | null;
}

const iconAliases: Record<string, string> = {
  "library-big": "LibraryBig",
  "folder-kanban": "FolderKanban",
  "flask-conical": "FlaskConical",
  "folder-git-2": "FolderGit2",
  "git-commit-horizontal": "GitCommitHorizontal",
  "file-code": "FileCode",
  "moon-star": "MoonStar",
  "circle-help": "CircleHelp",
  "panel-left-open": "PanelLeftOpen",
  "panel-left-close": "PanelLeftClose",
  "panel-right-open": "PanelRightOpen",
  "panel-right-close": "PanelRightClose",
  "chevrons-up-down": "ChevronsUpDown",
  "arrow-up-down": "ArrowUpDown",
  "search-x": "SearchX",
  "file-plus": "FilePlus",
  "message-square-warning": "MessageSquareWarning",
  "function-square": "SquareFunction",
  "columns-3": "Columns3",
  "columns-2": "Columns2",
  "notebook-pen": "NotebookPen",
  "square-terminal": "SquareTerminal",
  "list-checks": "ListChecks",
  "list-ordered": "ListOrdered",
  "key-round": "KeyRound",
  "log-out": "LogOut",
  "refresh-cw": "RefreshCw",
  "folder-open": "FolderOpen",
  "book-open-check": "BookOpenCheck",
  "clipboard-copy": "ClipboardCopy",
  "alert-triangle": "AlertTriangle",
  "check-circle-2": "CheckCircle2",
  "x-circle": "XCircle",
  "trash-2": "Trash2",
  "sticky-note": "StickyNote",
  "shield-check": "ShieldCheck",
  "message-square": "MessageSquare",
  "highlighter": "Highlighter",
  "book-open": "BookOpen",
  "external-link": "ExternalLink",
  "hard-drive": "HardDrive",
  "sliders-horizontal": "SlidersHorizontal",
  "layout-grid": "LayoutGrid",
  "circle-dashed": "CircleDashed",
  "help-circle": "CircleHelp"
};

const lucideMap = Lucide as unknown as Record<string, ComponentType<Lucide.LucideProps>>;

function toPascal(name: string) {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function Icon({
  name,
  size = 16,
  stroke = 1.75,
  color,
  style,
  className
}: {
  name: string;
  size?: number;
  stroke?: number;
  color?: string;
  style?: CSSProperties;
  className?: string;
}) {
  const LucideIcon = lucideMap[iconAliases[name] ?? toPascal(name)] ?? Lucide.Circle;
  return (
    <span
      className={className}
      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: size, height: size, color, flexShrink: 0, ...style }}
    >
      <LucideIcon size={size} strokeWidth={stroke} />
    </span>
  );
}

function Btn({
  variant = "ghost",
  sm,
  icon,
  iconSize,
  children,
  onClick,
  disabled,
  title,
  style
}: {
  variant?: "ghost" | "primary" | "deep" | "subtle" | "danger";
  sm?: boolean;
  icon?: string;
  iconSize?: number;
  children?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  style?: CSSProperties | undefined;
}) {
  const cls = `la-btn la-btn-${variant}${sm ? " la-btn-sm" : ""}${!children && icon ? " la-btn-icon" : ""}`;
  return (
    <button type="button" className={cls} onClick={onClick} disabled={disabled} title={title} style={style}>
      {icon ? <Icon name={icon} size={iconSize || (sm ? 13 : 14)} /> : null}
      {children}
    </button>
  );
}

function Badge({ variant, dot, children, style }: { variant?: string | undefined; dot?: string | undefined; children: ReactNode; style?: CSSProperties | undefined }) {
  return (
    <span className={`la-badge${variant ? " la-badge-" + variant : ""}`} style={style}>
      {dot ? <span className="dot" style={{ background: dot }} /> : null}
      {children}
    </span>
  );
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return <button type="button" className={`la-toggle${on ? " on" : ""}`} onClick={onClick} aria-pressed={on} />;
}

function Seg<T extends string>({ options, value, onChange }: { options: Array<{ v: T; label: string; icon?: string }>; value: T; onChange: (value: T) => void }) {
  return (
    <div className="la-seg">
      {options.map((option) => (
        <button key={option.v} type="button" className={value === option.v ? "on" : ""} onClick={() => onChange(option.v)} title={option.label}>
          {option.icon ? <Icon name={option.icon} size={13} /> : null}
          {option.label}
        </button>
      ))}
    </div>
  );
}

const screenIcon = { include: "check", exclude: "x", maybe: "help-circle", unscreened: "circle-dashed" };
function ScreenChip({ state }: { state: UiPaper["screen"] }) {
  return (
    <span className={`la-screenchip ${state}`} title={state}>
      <Icon name={screenIcon[state]} size={11} />
    </span>
  );
}

function ConfBar({ value }: { value: number }) {
  const color = value >= 85 ? "var(--state-success)" : value >= 65 ? "var(--state-warning)" : "var(--state-error)";
  return (
    <span className="la-conf" title={`confidence ${value}%`}>
      <span className="la-confbar">
        <span style={{ width: value + "%", background: color }} />
      </span>
      <span className="mono" style={{ fontSize: 10, color: "var(--text-muted)" }}>
        {value}%
      </span>
    </span>
  );
}

function ModelPicker({
  providers,
  providerId,
  model,
  onProviderChange,
  onModelChange
}: {
  providers: AgentProvider[];
  providerId: string;
  model: string | null;
  onProviderChange: (providerId: string) => void;
  onModelChange: (model: string | null) => void;
}) {
  const provider = providers.find((candidate) => candidate.id === providerId) ?? null;
  return (
    <div className="la-modelpick" title="Provider and model">
      <Icon name="cpu" size={13} />
      <select value={providerId} onChange={(event) => onProviderChange(event.currentTarget.value)} style={nativeSelectStyle}>
        <option value="local-heuristic">Local heuristic</option>
        {providers.map((candidate) => (
          <option key={candidate.id} value={candidate.id} disabled={!candidate.installed || !candidate.enabled}>
            {candidate.label}
            {!candidate.installed ? " (missing)" : !candidate.enabled ? " (disabled)" : ""}
          </option>
        ))}
      </select>
      <span style={{ color: "var(--text-muted)" }}>·</span>
      <select value={model ?? ""} onChange={(event) => onModelChange(event.currentTarget.value || null)} style={nativeSelectStyle} disabled={!provider}>
        <option value="">CLI default</option>
        {provider?.models.map((candidate) => (
          <option key={candidate} value={candidate}>
            {candidate}
          </option>
        ))}
      </select>
    </div>
  );
}

const nativeSelectStyle: CSSProperties = {
  minWidth: 0,
  border: 0,
  outline: 0,
  background: "transparent",
  color: "var(--text-primary)",
  font: "inherit",
  maxWidth: 132
};

function PanelHead({ title, count, children }: { title: string; count?: number; children?: ReactNode }) {
  return (
    <div className="la-panelhead">
      <h3>{title}</h3>
      {count != null ? <span className="count">{count}</span> : null}
      <span className="spacer" />
      {children}
    </div>
  );
}

function Empty({ icon, title, desc }: { icon: string; title: string; desc?: string }) {
  return (
    <div className="la-empty">
      <Icon name={icon} size={30} />
      <div className="et">{title}</div>
      {desc ? <div className="ed">{desc}</div> : null}
    </div>
  );
}

const workflowRecipes: Array<{ type: WorkflowType; name: string; icon: string; desc: string }> = [
  { type: "relevance-tagging", name: "Relevance tagging", icon: "tag", desc: "Tag against RQs" },
  { type: "metadata-extraction", name: "Metadata extract", icon: "list", desc: "Patch proposals" },
  { type: "key-findings", name: "Key findings", icon: "key", desc: "Findings and limits" },
  { type: "compare-papers", name: "Comparison matrix", icon: "columns-3", desc: "Compare papers" },
  { type: "find-papers", name: "Find related", icon: "git-fork", desc: "Similar papers" },
  { type: "synthesis-note", name: "Synthesis note", icon: "notebook-pen", desc: "Generate note" },
  { type: "contradiction-finder", name: "Contradictions", icon: "split", desc: "Find conflicts" },
  { type: "dataset-method-extractor", name: "Data/method", icon: "database", desc: "Extract tables" },
  { type: "citation-needed", name: "Citation needed", icon: "quote", desc: "Flag claims" },
  { type: "screening", name: "Screening", icon: "list-checks", desc: "Include/maybe/exclude" }
];

function screenState(entry: PaperEntry): UiPaper["screen"] {
  switch (entry.link?.relevanceState) {
    case "included":
      return "include";
    case "excluded":
      return "exclude";
    case "maybe":
      return "maybe";
    default:
      return "unscreened";
  }
}

function makeCitekey(entry: PaperEntry) {
  if (entry.paper.zoteroKey) return entry.paper.zoteroKey;
  const firstAuthor = entry.paper.authors[0]?.split(/\s+/).at(-1)?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "paper";
  return `${firstAuthor}${entry.paper.year ?? ""}${entry.paper.id.slice(0, 5)}`;
}

function makeUiPaper(entry: PaperEntry, projects: Project[]): UiPaper {
  const projectIds = entry.link ? [entry.link.projectId] : [];
  const projectNames = projectIds.map((id) => projects.find((project) => project.id === id)?.name ?? id);
  const allTags = [...new Set([...entry.paper.tags, ...(entry.link?.projectTags ?? [])])];
  const abstract =
    allTags.length > 0
      ? `Indexed paper with tags ${allTags.join(", ")}. Convert to Markdown to expose full passages, evidence links, and extracted figures.`
      : "No abstract is stored yet. Convert or extract metadata to enrich this paper.";
  return {
    id: entry.paper.id,
    title: entry.paper.title,
    authors: entry.paper.authors.join(", ") || "Unknown authors",
    firstAuthor: entry.paper.authors[0]?.split(/\s+/)[0] ?? "Unknown",
    year: entry.paper.year,
    venue: entry.paper.arxivId ? "arXiv" : "Unspecified",
    type: entry.paper.arxivId ? "Preprint" : "Paper",
    citekey: makeCitekey(entry),
    doi: entry.paper.doi ?? entry.paper.arxivId ?? "not recorded",
    pages: 1,
    added: new Date(entry.paper.createdAt).toLocaleDateString(),
    tags: allTags,
    projectTags: entry.link?.projectTags ?? [],
    methods: allTags.slice(0, 3),
    projectIds,
    projectNames,
    screen: screenState(entry),
    starred: entry.link?.relevanceState === "included",
    abstract,
    entry
  };
}

function makeUiProject(project: Project | null, details: ProjectDetails | null, papers: UiPaper[]): UiProject {
  const tags = [...new Set(papers.flatMap((paper) => [...paper.projectTags, ...paper.tags]))];
  return {
    id: project?.id ?? "global",
    name: project?.name ?? "No project selected",
    sub: project ? `${papers.length} papers · updated ${new Date(project.updatedAt).toLocaleDateString()}` : "Select or create a project",
    questions:
      project?.researchQuestions.map((question, index) => ({
        id: question.id || `RQ${index + 1}`,
        text: question.text,
        papers: papers.filter((paper) => paper.tags.includes(question.id)).length
      })) ?? [],
    subcollections:
      details?.collections.map((collection, index) => ({
        id: collection.id,
        name: collection.name,
        n: collection.paperIds.length,
        icon: ["layers", "trending-up", "ruler", "message-square-warning"][index % 4] ?? "layers"
      })) ?? [],
    tags,
    screen: {
      include: papers.filter((paper) => paper.screen === "include").length,
      exclude: papers.filter((paper) => paper.screen === "exclude").length,
      maybe: papers.filter((paper) => paper.screen === "maybe").length,
      todo: papers.filter((paper) => paper.screen === "unscreened").length
    },
    raw: project
  };
}

function paperMatchesQuery(paper: UiPaper, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [paper.title, paper.authors, paper.venue, paper.type, paper.tags.join(" "), paper.projectNames.join(" "), paper.abstract].join(" ").toLowerCase().includes(q);
}

function statusLabel(status: WorkflowRun["status"]) {
  return status === "completed" ? "done" : status;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

function App() {
  const [screen, setScreen] = useState<Screen>(() => (localStorage.getItem("la-screen") as Screen | null) ?? "projects");
  const [theme, setThemeState] = useState(() => localStorage.getItem("la-theme") || "comfy");
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectDetails, setProjectDetails] = useState<ProjectDetails | null>(null);
  const [libraryEntries, setLibraryEntries] = useState<PaperEntry[]>([]);
  const [projectEntries, setProjectEntries] = useState<PaperEntry[]>([]);
  const [providers, setProviders] = useState<AgentProvider[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowRun[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState("local-heuristic");
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [libraryPaperId, setLibraryPaperId] = useState<string | null>(null);
  const [projectPaperId, setProjectPaperId] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [markdownNotice, setMarkdownNotice] = useState<string | null>(null);
  const [passages, setPassages] = useState<Passage[]>([]);
  const [qa, setQa] = useState<QaResponse | null>(null);
  const [citationTarget, setCitationTarget] = useState<CitationTarget | null>(null);
  const [citationActivation, setCitationActivation] = useState(0);
  const [pdfAnnotations, setPdfAnnotations] = useState<PdfAnnotation[]>([]);
  const [activePdfAnnotation, setActivePdfAnnotation] = useState<{ id: string; version: number } | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const importProjectIdRef = useRef<string | null>(null);
  const seenTerminalWorkflowIdsRef = useRef<Set<string>>(new Set());

  const setTheme = useCallback((nextTheme: string) => {
    setThemeState(nextTheme);
    localStorage.setItem("la-theme", nextTheme);
  }, []);

  useEffect(() => {
    if (theme === "comfy") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("la-screen", screen);
  }, [screen]);

  const loadBase = useCallback(async () => {
    const [nextProjects, nextEntries] = await Promise.all([api.projects(), api.papers(null)]);
    setProjects(nextProjects);
    setLibraryEntries(nextEntries);
    setActiveProjectId((current) => current ?? nextProjects[0]?.id ?? null);
    setLibraryPaperId((current) => current ?? nextEntries[0]?.paper.id ?? null);
  }, []);

  const loadSecondaryStatus = useCallback(() => {
    void api.status().then(setStatus).catch(() => undefined);
    void api.workflows().then(setWorkflows).catch(() => undefined);
  }, []);

  const loadProviders = useCallback(() => {
    void api.providerStatus().then(setProviders).catch(() => undefined);
  }, []);

  const reloadPapers = useCallback(
    async (projectId: string | null) => {
      const [nextLibrary, nextProject] = await Promise.all([
        api.papers(null),
        projectId ? api.papers(projectId) : activeProjectId ? api.papers(activeProjectId) : Promise.resolve(projectEntries)
      ]);
      setLibraryEntries(nextLibrary);
      setProjectEntries(nextProject);
      if (nextLibrary.length) setLibraryPaperId((current) => current ?? nextLibrary[0]?.paper.id ?? null);
      if (nextProject.length) setProjectPaperId((current) => current && nextProject.some((entry) => entry.paper.id === current) ? current : nextProject[0]?.paper.id ?? null);
    },
    [activeProjectId, projectEntries]
  );

  const openImportPicker = useCallback((projectId: string | null) => {
    importProjectIdRef.current = projectId;
    fileInputRef.current?.click();
  }, []);

  const importSelectedFiles = useCallback(
    (files: FileList | null) => {
      const selected = Array.from(files ?? []).filter((file) => file.name.toLowerCase().endsWith(".pdf"));
      if (selected.length === 0) return;
      const projectId = importProjectIdRef.current;
      startTransition(() => {
        void (async () => {
          for (const file of selected) {
            await api.importPaper({ file, projectId });
          }
          await reloadPapers(projectId);
          if (projectId) setProjectDetails(await api.project(projectId));
        })();
      });
    },
    [reloadPapers]
  );

  const loadProject = useCallback(async (projectId: string | null) => {
    if (!projectId) {
      setProjectDetails(null);
      setProjectEntries([]);
      return;
    }
    const [details, entries] = await Promise.all([api.project(projectId), api.papers(projectId)]);
    setProjectDetails(details);
    setProjectEntries(entries);
    setProjectPaperId((current) => current && entries.some((entry) => entry.paper.id === current) ? current : entries[0]?.paper.id ?? null);
  }, []);

  useEffect(() => {
    void loadBase();
    loadSecondaryStatus();
    const timer = window.setTimeout(loadProviders, 500);
    return () => window.clearTimeout(timer);
  }, [loadBase, loadProviders, loadSecondaryStatus]);

  useEffect(() => {
    if (screen !== "settings") return;
    loadProviders();
  }, [loadProviders, screen]);

  useEffect(() => {
    void loadProject(activeProjectId);
  }, [activeProjectId, loadProject]);

  useEffect(() => {
    if (!workflows.some((run) => run.status === "running" || run.status === "queued")) return;
    const timer = window.setInterval(() => {
      void api.workflows().then(setWorkflows);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [workflows]);

  useEffect(() => {
    const provider = providers.find((candidate) => candidate.id === selectedProviderId);
    if (selectedProviderId !== "local-heuristic" && (!provider || !provider.installed || !provider.enabled)) {
      const fallback = providers.find((candidate) => candidate.installed && candidate.enabled);
      setSelectedProviderId(fallback?.id ?? "local-heuristic");
      setSelectedModel(fallback?.defaultModel ?? null);
      return;
    }
    if (provider && selectedModel === null && provider.defaultModel) setSelectedModel(provider.defaultModel);
  }, [providers, selectedModel, selectedProviderId]);

  const libraryPapers = useMemo(() => libraryEntries.map((entry) => makeUiPaper(entry, projects)), [libraryEntries, projects]);
  const projectPapers = useMemo(() => projectEntries.map((entry) => makeUiPaper(entry, projects)), [projectEntries, projects]);
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0] ?? null;
  const uiProject = useMemo(() => makeUiProject(activeProject, projectDetails, projectPapers), [activeProject, projectDetails, projectPapers]);
  const selectedPaper =
    screen === "library"
      ? libraryPapers.find((paper) => paper.id === libraryPaperId) ?? libraryPapers[0] ?? null
      : projectPapers.find((paper) => paper.id === projectPaperId) ?? projectPapers[0] ?? libraryPapers[0] ?? null;
  const selectedPaperId = selectedPaper?.id ?? null;

  const loadPaperArtifacts = useCallback(async (paperId: string) => {
    const [nextMarkdown, nextPassages] = await Promise.all([api.markdown(paperId), api.passages(paperId)]);
    setMarkdown(nextMarkdown);
    setPassages(nextPassages);
    return { markdown: nextMarkdown, passages: nextPassages };
  }, []);

  useEffect(() => {
    if (!selectedPaperId) {
      setMarkdown(null);
      setMarkdownNotice(null);
      setPassages([]);
      setCitationTarget(null);
      setCitationActivation(0);
      setPdfAnnotations([]);
      setActivePdfAnnotation(null);
      return;
    }
    setMarkdownNotice(null);
    setCitationTarget(null);
    setCitationActivation(0);
    setPdfAnnotations([]);
    setActivePdfAnnotation(null);
    void loadPaperArtifacts(selectedPaperId).then(({ markdown: nextMarkdown, passages: nextPassages }) => {
      setMarkdown(nextMarkdown);
      setPassages(nextPassages);
    });
  }, [loadPaperArtifacts, selectedPaperId]);

  useEffect(() => {
    if (!selectedPaperId) return;
    const terminalRuns = workflows.filter((run) =>
      (run.status === "completed" || run.status === "failed" || run.status === "cancelled") &&
      !seenTerminalWorkflowIdsRef.current.has(run.id)
    );
    if (!terminalRuns.length) return;
    for (const run of terminalRuns) seenTerminalWorkflowIdsRef.current.add(run.id);
    const markdownRun = terminalRuns.find((run) => run.type === "pdf-markdown-processing" && workflowMatchesPaper(run, selectedPaperId));
    if (!markdownRun) return;
    if (markdownRun.status !== "completed") {
      setMarkdownNotice(`PDF to Markdown ${statusLabel(markdownRun.status)}.`);
      return;
    }
    void (async () => {
      const [{ markdown: nextMarkdown }, nextLibrary, nextProject] = await Promise.all([
        loadPaperArtifacts(selectedPaperId),
        api.papers(null),
        activeProjectId ? api.papers(activeProjectId) : Promise.resolve(projectEntries)
      ]);
      setLibraryEntries(nextLibrary);
      setProjectEntries(nextProject);
      setMarkdownNotice(nextMarkdown ? "Markdown updated from the completed conversion." : "Conversion completed, but no Markdown file was found for this paper.");
    })();
  }, [activeProjectId, loadPaperArtifacts, projectEntries, selectedPaperId, workflows]);

  const jumpToPdfAnnotation = useCallback((id: string) => {
    setActivePdfAnnotation((current) => ({ id, version: (current?.version ?? 0) + 1 }));
  }, []);

  const deletePdfAnnotation = useCallback((id: string) => {
    setPdfAnnotations((current) => current.filter((annotation) => annotation.id !== id));
    setActivePdfAnnotation((current) => (current?.id === id ? null : current));
  }, []);

  const clearPdfAnnotations = useCallback(() => {
    setPdfAnnotations([]);
    setActivePdfAnnotation(null);
  }, []);

  const changeProviderSelection = useCallback(
    (providerId: string) => {
      setSelectedProviderId(providerId);
      const provider = providers.find((candidate) => candidate.id === providerId);
      setSelectedModel(provider?.defaultModel ?? null);
    },
    [providers]
  );

  const runWorkflow = useCallback(
    (type: WorkflowType, scopeProjectId: string | null, paperIds: string[] = [], query: string | null = null, options: Record<string, unknown> = {}) => {
      startTransition(() => {
        void api
          .startWorkflow({
            type,
            projectId: scopeProjectId,
            paperIds,
            query,
            options,
            providerId: selectedProviderId,
            model: selectedProviderId === "local-heuristic" ? null : selectedModel
          })
          .then(async () => {
            const [nextWorkflows, nextLibrary, nextProject] = await Promise.all([
              api.workflows(),
              api.papers(null),
              scopeProjectId ? api.papers(scopeProjectId) : Promise.resolve(projectEntries)
            ]);
            setWorkflows(nextWorkflows);
            setLibraryEntries(nextLibrary);
            setProjectEntries(nextProject);
          });
      });
    },
    [projectEntries, selectedModel, selectedProviderId]
  );

  const cancelWorkflow = useCallback((runId: string) => {
    startTransition(() => {
      void api.cancelWorkflow(runId).then(async () => setWorkflows(await api.workflows()));
    });
  }, []);

  const askQuestion = useCallback(
    (question: string, scopeProjectId: string | null, paperId: string | null) => {
      startTransition(() => {
        void api
          .qa({
            question,
            projectId: scopeProjectId,
            paperId,
            providerId: selectedProviderId,
            model: selectedProviderId === "local-heuristic" ? null : selectedModel
          })
          .then(setQa);
      });
    },
    [selectedModel, selectedProviderId]
  );

  const updateProvider = useCallback(
    (providerId: string, patch: { enabled?: boolean; command?: string; defaultModel?: string | null; customModels?: string[] }) => {
      startTransition(() => {
        void api.updateProviderSettings(providerId, patch).then(setProviders);
      });
    },
    []
  );

  const connectProvider = useCallback((providerId: string) => {
    startTransition(() => {
      void api.connectProvider(providerId).then(setProviders);
    });
  }, []);

  const convertPaper = useCallback((paperId: string) => {
    startTransition(() => {
      void api.convert(paperId).then(async () => {
        setMarkdown(await api.markdown(paperId));
        setPassages(await api.passages(paperId));
      });
    });
  }, []);

  const openCitation = useCallback((ref: EvidenceRef, scopeProjectId: string | null) => {
    startTransition(() => {
      void api.citationTarget(ref.paperId, ref.passageId, scopeProjectId).then((target) => {
        setCitationTarget(target);
        setCitationActivation((current) => current + 1);
        if (screen === "library") setLibraryPaperId(target.paperId);
        else setProjectPaperId(target.paperId);
      });
    });
  }, [screen]);

  const nav: Array<[Screen, string, string, string?]> = [
    ["library", "library-big", "Library"],
    ["projects", "folder-kanban", "Projects"],
    ["search", "search", "Search"],
    ["settings", "settings", "Settings"],
    ["presets", "flask-conical", "Presets", "WIP"]
  ];

  const crumb: Record<Screen, [string, string]> = {
    library: ["Global Library", "All papers"],
    projects: ["Projects", activeProject?.name ?? "No project"],
    search: ["Search", "Global index"],
    settings: ["Settings", "Providers"],
    presets: ["Presets", "Experimental"]
  };

  return (
    <div className="la-app">
      <div className="la-titlebar">
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          onChange={(event) => {
            importSelectedFiles(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />
        <div className="la-traffic">
          <span style={{ background: "#ff5f57" }} />
          <span style={{ background: "#febc2e" }} />
          <span style={{ background: "#28c840" }} />
        </div>
        <div className="la-wordmark">
          <span className="dot" />
          litagent
        </div>
        <div className="la-titlecenter">
          <Icon name="git-branch" size={13} />
          <span className="crumb">{crumb[screen][0]}</span>
          <Icon name="chevron-right" size={13} />
          <span style={{ color: "var(--text-secondary)" }}>{crumb[screen][1]}</span>
          {isPending ? <Badge variant="accent">working</Badge> : null}
        </div>
        <div className="la-titleactions">
          <div className="la-themeswitch">
            {([
              ["comfy", "moon-star"],
              ["dark", "moon"],
              ["light", "sun"]
            ] as const).map(([value, icon]) => (
              <button key={value} type="button" className={theme === value ? "on" : ""} onClick={() => setTheme(value)} title={value}>
                <Icon name={icon} size={13} />
              </button>
            ))}
          </div>
          <button type="button" className="la-iconbtn" title="Command palette">
            <Icon name="command" size={15} />
          </button>
          <button type="button" className="la-iconbtn" title="Notifications">
            <Icon name="bell" size={15} />
          </button>
        </div>
      </div>

      <div className="la-body">
        <nav className="la-nav" aria-label="Primary">
          {nav.map(([key, icon, label, wip]) => (
            <button key={key} type="button" className={`la-navbtn${screen === key ? " on" : ""}`} onClick={() => setScreen(key)}>
              {wip ? <span className="wip">{wip}</span> : null}
              <Icon name={icon} size={20} />
              <span>{label}</span>
            </button>
          ))}
          <div className="la-navspace" />
          <button type="button" className="la-navbtn" title="Help">
            <Icon name="circle-help" size={20} />
            <span>Help</span>
          </button>
          <div className="la-navavatar" title="Researcher">
            RK
          </div>
        </nav>

        {screen === "library" ? (
          <LibraryScreen
            papers={libraryPapers}
            projects={projects}
            selectedPaperId={libraryPaperId}
            onSelectPaper={setLibraryPaperId}
            selectedPaper={selectedPaper}
            markdown={markdown}
            markdownNotice={markdownNotice}
            citationTarget={citationTarget}
            citationActivation={citationActivation}
            pdfAnnotations={pdfAnnotations}
            setPdfAnnotations={setPdfAnnotations}
            activePdfAnnotationId={activePdfAnnotation?.id ?? null}
            activePdfAnnotationKey={activePdfAnnotation?.version ?? 0}
            onJumpPdfAnnotation={jumpToPdfAnnotation}
            onDeletePdfAnnotation={deletePdfAnnotation}
            onClearPdfAnnotations={clearPdfAnnotations}
            passages={passages}
            qa={qa}
            providers={providers}
            selectedProviderId={selectedProviderId}
            selectedModel={selectedModel}
            onProviderChange={changeProviderSelection}
            onModelChange={setSelectedModel}
            workflows={workflows}
            onRefreshWorkflows={loadSecondaryStatus}
            onRunWorkflow={(type, paperIds, query, options) => runWorkflow(type, null, paperIds, query, options)}
            onCancelWorkflow={cancelWorkflow}
            onAsk={(question, paperId) => askQuestion(question, null, paperId)}
            onConvert={convertPaper}
            onImportPapers={openImportPicker}
            onOpenCitation={openCitation}
          />
        ) : null}
        {screen === "projects" ? (
          <ProjectScreen
            projects={projects}
            project={uiProject}
            activeProjectId={activeProjectId}
            onProjectChange={setActiveProjectId}
            papers={projectPapers}
            selectedPaperId={projectPaperId}
            onSelectPaper={setProjectPaperId}
            selectedPaper={selectedPaper}
            markdown={markdown}
            markdownNotice={markdownNotice}
            citationTarget={citationTarget}
            citationActivation={citationActivation}
            pdfAnnotations={pdfAnnotations}
            setPdfAnnotations={setPdfAnnotations}
            activePdfAnnotationId={activePdfAnnotation?.id ?? null}
            activePdfAnnotationKey={activePdfAnnotation?.version ?? 0}
            onJumpPdfAnnotation={jumpToPdfAnnotation}
            onDeletePdfAnnotation={deletePdfAnnotation}
            onClearPdfAnnotations={clearPdfAnnotations}
            passages={passages}
            qa={qa}
            providers={providers}
            selectedProviderId={selectedProviderId}
            selectedModel={selectedModel}
            onProviderChange={changeProviderSelection}
            onModelChange={setSelectedModel}
            workflows={workflows}
            onRefreshWorkflows={loadSecondaryStatus}
            onRunWorkflow={(type, paperIds, query, options) => runWorkflow(type, activeProjectId, paperIds, query, options)}
            onCancelWorkflow={cancelWorkflow}
            onAsk={(question, paperId) => askQuestion(question, activeProjectId, paperId)}
            onConvert={convertPaper}
            onImportPapers={openImportPicker}
            onOpenCitation={openCitation}
          />
        ) : null}
        {screen === "search" ? (
          <SearchScreen
            papers={libraryPapers}
            onOpenPaper={(paperId) => {
              setLibraryPaperId(paperId);
              setScreen("library");
            }}
          />
        ) : null}
        {screen === "settings" ? (
          <SettingsScreen
            theme={theme}
            setTheme={setTheme}
            providers={providers}
            selectedProviderId={selectedProviderId}
            selectedModel={selectedModel}
            onProviderChange={changeProviderSelection}
            onModelChange={setSelectedModel}
            onUpdateProvider={updateProvider}
            onConnectProvider={connectProvider}
            status={status}
          />
        ) : null}
        {screen === "presets" ? <PresetsScreen /> : null}
      </div>

      <div className="la-status">
        <span className="la-stitem accent" style={{ minWidth: 0, flexShrink: 1, maxWidth: 260 }}>
          <Icon name="folder-git-2" size={12} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {screen === "library" ? "global library" : activeProject?.name ?? status?.repoRoot ?? "workspace"}
          </span>
        </span>
        <span className="la-stitem">
          <Icon name="files" size={12} />
          {libraryPapers.length} papers · {projectPapers.length} linked
        </span>
        <span className="spacer" />
        <span className={status?.git.clean ? "la-stitem ok" : "la-stitem warn"}>
          <span className="la-stdot" style={{ background: status?.git.clean ? "var(--state-success)" : "var(--state-warning)" }} />
          git {status?.git.branch ?? "unknown"} · {status?.git.clean ? "clean" : "changes"}
        </span>
        <span className={status?.git.lfsAvailable ? "la-stitem ok" : "la-stitem warn"}>
          <Icon name="git-commit-horizontal" size={12} />
          LFS {status?.git.lfsAvailable ? "available" : "missing"}
        </span>
        <span className="la-stitem ok">
          <Icon name="database" size={12} />
          FTS indexed
        </span>
        <span className="la-stitem">
          <Icon name="cpu" size={12} />
          {selectedProviderId}
          {selectedModel ? `/${selectedModel}` : ""}
        </span>
      </div>
    </div>
  );
}

function LibraryScreen(props: WorkspaceProps & { projects: Project[] }) {
  const [tool, setTool] = useState<WorkspaceTool>("papers");
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const tagOptions = useMemo(() => [...new Set(props.papers.flatMap((paper) => paper.tags))].slice(0, 16), [props.papers]);
  const filtered = useMemo(
    () =>
      props.papers.filter(
        (paper) => (typeFilter.length === 0 || typeFilter.includes(paper.type)) && (tagFilter.length === 0 || tagFilter.some((tag) => paper.tags.includes(tag)))
      ),
    [props.papers, tagFilter, typeFilter]
  );
  return (
    <WorkspaceShell
      tool={tool}
      setTool={setTool}
      primaryAction={<Btn variant="primary" sm icon="upload" onClick={() => props.onImportPapers(null)}>Import</Btn>}
    >
      {tool === "papers" ? (
        <div className="la-content">
          <LibraryFilters
            papers={props.papers}
            typeFilter={typeFilter}
            setTypeFilter={setTypeFilter}
            tagOptions={tagOptions}
            tagFilter={tagFilter}
            toggleTag={(tag) => setTagFilter((current) => (current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]))}
            onImportPapers={() => props.onImportPapers(null)}
          />
          <PaperListPane
            papers={filtered}
            selId={props.selectedPaperId}
            onSelect={props.onSelectPaper}
            title="All papers"
            showScreen={false}
            filterNote={[...typeFilter, ...tagFilter].length ? `Filtered · ${[...typeFilter, ...tagFilter].join(", ")}` : null}
          />
          <div className="la-col" style={{ flex: 1, minWidth: 320 }}>
            <Reader
              paper={props.selectedPaper}
              markdown={props.markdown}
              markdownNotice={props.markdownNotice}
              citationTarget={props.citationTarget}
              citationActivation={props.citationActivation}
              pdfAnnotations={props.pdfAnnotations}
              setPdfAnnotations={props.setPdfAnnotations}
              activePdfAnnotationId={props.activePdfAnnotationId}
              activePdfAnnotationKey={props.activePdfAnnotationKey}
            />
          </div>
          <AgentPanel {...props} contextLabel="Global Library" scopeProjectId={null} />
        </div>
      ) : (
        <ScopedToolView tool={tool} contextLabel="Global Library" scopeProjectId={null} {...props} />
      )}
    </WorkspaceShell>
  );
}

interface WorkspaceProps {
  papers: UiPaper[];
  selectedPaperId: string | null;
  onSelectPaper: (paperId: string) => void;
  selectedPaper: UiPaper | null;
  markdown: string | null;
  markdownNotice: string | null;
  citationTarget: CitationTarget | null;
  citationActivation: number;
  pdfAnnotations: PdfAnnotation[];
  setPdfAnnotations: Dispatch<SetStateAction<PdfAnnotation[]>>;
  activePdfAnnotationId: string | null;
  activePdfAnnotationKey: number;
  onJumpPdfAnnotation: (id: string) => void;
  onDeletePdfAnnotation: (id: string) => void;
  onClearPdfAnnotations: () => void;
  passages: Passage[];
  qa: QaResponse | null;
  providers: AgentProvider[];
  selectedProviderId: string;
  selectedModel: string | null;
  onProviderChange: (providerId: string) => void;
  onModelChange: (model: string | null) => void;
  workflows: WorkflowRun[];
  onRefreshWorkflows: () => void;
  onRunWorkflow: (type: WorkflowType, paperIds?: string[], query?: string | null, options?: Record<string, unknown>) => void;
  onCancelWorkflow: (runId: string) => void;
  onAsk: (question: string, paperId: string | null) => void;
  onConvert: (paperId: string) => void;
  onImportPapers: (projectId: string | null) => void;
  onOpenCitation: (ref: EvidenceRef, projectId: string | null) => void;
}

function ProjectScreen(props: WorkspaceProps & { projects: Project[]; project: UiProject; activeProjectId: string | null; onProjectChange: (projectId: string) => void }) {
  const [tool, setTool] = useState<WorkspaceTool>("papers");
  const [activeRq, setActiveRq] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const filtered = useMemo(
    () => props.papers.filter((paper) => (!activeRq || paper.tags.includes(activeRq)) && (tagFilter.length === 0 || tagFilter.some((tag) => paper.tags.includes(tag)))),
    [activeRq, props.papers, tagFilter]
  );
  return (
    <WorkspaceShell
      tool={tool}
      setTool={setTool}
      primaryAction={<Btn variant="primary" sm icon="plus" onClick={() => props.onImportPapers(props.activeProjectId)} disabled={!props.activeProjectId}>Add papers</Btn>}
      secondaryAction={<Btn variant="ghost" sm icon="users">Share</Btn>}
    >
      {tool === "papers" ? (
        <div className="la-content">
          <ProjectContext
            project={props.project}
            projects={props.projects}
            activeProjectId={props.activeProjectId}
            onProjectChange={props.onProjectChange}
            activeRq={activeRq}
            setRq={setActiveRq}
            tagFilter={tagFilter}
            toggleTag={(tag) => setTagFilter((current) => (current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]))}
          />
          <PaperListPane
            papers={filtered}
            selId={props.selectedPaperId}
            onSelect={props.onSelectPaper}
            title={activeRq ? `${activeRq} papers` : "Project papers"}
            filterNote={activeRq ? `Filtered to ${activeRq}` : tagFilter.length ? `Tags: ${tagFilter.join(", ")}` : null}
          />
          <div className="la-col" style={{ flex: 1, minWidth: 320 }}>
            <Reader
              paper={props.selectedPaper}
              markdown={props.markdown}
              markdownNotice={props.markdownNotice}
              citationTarget={props.citationTarget}
              citationActivation={props.citationActivation}
              pdfAnnotations={props.pdfAnnotations}
              setPdfAnnotations={props.setPdfAnnotations}
              activePdfAnnotationId={props.activePdfAnnotationId}
              activePdfAnnotationKey={props.activePdfAnnotationKey}
            />
          </div>
          <AgentPanel {...props} contextLabel={props.project.name} scopeProjectId={props.activeProjectId} />
        </div>
      ) : (
        <ScopedToolView tool={tool} contextLabel={props.project.name} scopeProjectId={props.activeProjectId} {...props} />
      )}
    </WorkspaceShell>
  );
}

function WorkspaceShell({
  tool,
  setTool,
  primaryAction,
  secondaryAction,
  children
}: {
  tool: WorkspaceTool;
  setTool: (tool: WorkspaceTool) => void;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
  children: ReactNode;
}) {
  const tools: Array<[WorkspaceTool, string, string]> = [
    ["papers", "library", "Papers"],
    ["workflows", "workflow", "Workflows"],
    ["map", "share-2", "Concept Map"],
    ["notes", "sticky-note", "Notes"],
    ["exports", "download", "Exports"]
  ];
  return (
    <div className="la-screen">
      <div className="la-toolstrip">
        {tools.map(([key, toolIcon, label]) => (
          <button key={key} type="button" className={`la-tool${tool === key ? " on" : ""}`} onClick={() => setTool(key)}>
            <Icon name={toolIcon} size={15} />
            {label}
          </button>
        ))}
        <span className="spacer" />
        {secondaryAction}
        {primaryAction}
      </div>
      {children}
    </div>
  );
}

function LibraryFilters({
  papers,
  typeFilter,
  setTypeFilter,
  tagOptions,
  tagFilter,
  toggleTag,
  onImportPapers
}: {
  papers: UiPaper[];
  typeFilter: string[];
  setTypeFilter: (updater: (current: string[]) => string[]) => void;
  tagOptions: string[];
  tagFilter: string[];
  toggleTag: (tag: string) => void;
  onImportPapers: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const types = [...new Set(papers.map((paper) => paper.type))];
  if (collapsed) {
    return <CollapsedRail title="Library filters" icon="library-big" side="left" onExpand={() => setCollapsed(false)} />;
  }
  return (
    <div className="la-col la-colborder-r" style={{ width: 232, background: "var(--bg-secondary)" }}>
      <div className="la-panelhead">
        <h3>Library</h3>
        <span className="spacer" />
        <button type="button" className="la-iconbtn" title="Minimize filters" onClick={() => setCollapsed(true)}>
          <Icon name="panel-left-close" size={15} />
        </button>
      </div>
      <div className="scroll" style={{ flex: 1 }}>
        <div style={{ padding: "10px 12px" }}>
          <Btn variant="primary" icon="upload" style={{ width: "100%" }} onClick={onImportPapers}>
            Import papers
          </Btn>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <Btn variant="ghost" sm icon="file-plus" style={{ flex: 1 }}>
              DOI
            </Btn>
            <Btn variant="ghost" sm icon="link" style={{ flex: 1 }}>
              arXiv
            </Btn>
            <Btn variant="ghost" sm icon="library" style={{ flex: 1 }}>
              Zotero
            </Btn>
          </div>
        </div>
        <div className="la-sectionlabel">Collections</div>
        {[
          ["All papers", "layers", papers.length],
          ["Starred", "star", papers.filter((paper) => paper.starred).length],
          ["Unfiled", "inbox", papers.filter((paper) => paper.projectIds.length === 0).length],
          ["Recently added", "clock", Math.min(4, papers.length)]
        ].map(([name, itemIcon, count], index) => (
          <div key={name} className={`la-subcol${index === 0 ? " on" : ""}`} style={index === 0 ? { background: "var(--surface-selection)" } : undefined}>
            <Icon name={String(itemIcon)} size={14} />
            <span style={{ flex: 1, minWidth: 0 }}>{name}</span>
            <span className="n">{count}</span>
          </div>
        ))}
        <div className="la-sectionlabel">Source type</div>
        {types.map((type) => (
          <label key={type} className="la-subcol" style={{ cursor: "pointer" }}>
            <span
              onClick={() => setTypeFilter((current) => (current.includes(type) ? current.filter((item) => item !== type) : [...current, type]))}
              style={{
                width: 14,
                height: 14,
                borderRadius: 4,
                border: "1.5px solid var(--border-line)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: typeFilter.includes(type) ? "var(--accent-primary)" : "transparent",
                borderColor: typeFilter.includes(type) ? "var(--accent-primary)" : "var(--border-line)"
              }}
            >
              {typeFilter.includes(type) ? <Icon name="check" size={10} color="#fff" /> : null}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>{type}</span>
            <span className="n">{papers.filter((paper) => paper.type === type).length}</span>
          </label>
        ))}
        <div className="la-sectionlabel">Tags</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, padding: "0 12px 16px" }}>
          {tagOptions.length ? tagOptions.map((tag) => <span key={tag} className={`la-tag${tagFilter.includes(tag) ? " on" : ""}`} onClick={() => toggleTag(tag)}>{tag}</span>) : <span className="la-tag">no tags yet</span>}
        </div>
      </div>
      <div style={{ borderTop: "1px solid var(--border-deep)", padding: "9px 12px", font: "var(--text-caption)", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6 }}>
        <Icon name="hard-drive" size={12} />
        Stored globally · {papers.length} papers
      </div>
    </div>
  );
}

function ProjectContext({
  project,
  projects,
  activeProjectId,
  onProjectChange,
  activeRq,
  setRq,
  tagFilter,
  toggleTag
}: {
  project: UiProject;
  projects: Project[];
  activeProjectId: string | null;
  onProjectChange: (projectId: string) => void;
  activeRq: string | null;
  setRq: (rq: string | null) => void;
  tagFilter: string[];
  toggleTag: (tag: string) => void;
}) {
  const [projOpen, setProjOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  if (collapsed) return <CollapsedRail title={project.name} icon="folder-kanban" side="left" onExpand={() => setCollapsed(false)} />;
  return (
    <div className="la-col la-colborder-r" style={{ width: 240, background: "var(--bg-secondary)" }}>
      <div className="la-projsel" onClick={() => setProjOpen((open) => !open)}>
        <span className="pdot" />
        <span className="ptit">
          <span className="nm">{project.name}</span>
          <span className="sub">{project.sub}</span>
        </span>
        <button type="button" className="la-iconbtn" title="Minimize project panel" style={{ padding: 4 }} onClick={(event) => { event.stopPropagation(); setCollapsed(true); }}>
          <Icon name="panel-left-close" size={15} />
        </button>
        <Icon name="chevrons-up-down" size={15} color="var(--text-muted)" />
      </div>
      {projOpen ? (
        <div className="fade-in" style={{ borderBottom: "1px solid var(--border-deep)", background: "var(--bg-tertiary)" }}>
          {projects.map((candidate) => (
            <div
              key={candidate.id}
              className="la-subcol"
              style={{ padding: "8px 12px", color: candidate.id === activeProjectId ? "var(--text-high)" : "var(--text-secondary)" }}
              onClick={() => onProjectChange(candidate.id)}
            >
              <Icon name={candidate.id === activeProjectId ? "check" : "folder"} size={14} />
              {candidate.name}
            </div>
          ))}
          <div className="la-subcol" style={{ padding: "8px 12px", color: "var(--accent-bright)" }}>
            <Icon name="plus" size={14} />
            New project...
          </div>
        </div>
      ) : null}

      <div className="scroll" style={{ flex: 1 }}>
        <div className="la-sectionlabel">Research questions</div>
        {project.questions.length ? (
          project.questions.map((question) => (
            <div key={question.id} className={`la-rq${activeRq === question.id ? " on" : ""}`} onClick={() => setRq(activeRq === question.id ? null : question.id)}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span className="rqid">{question.id}</span>
                <span className="spacer" style={{ flex: 1 }} />
                <span className="mono" style={{ font: "var(--text-caption)", color: "var(--text-muted)" }}>{question.papers}</span>
              </div>
              <div className="rqtext">{question.text}</div>
            </div>
          ))
        ) : (
          <p className="empty-copy" style={{ padding: "0 12px", color: "var(--text-muted)", font: "var(--text-caption)" }}>
            No research questions yet.
          </p>
        )}

        <div className="la-sectionlabel">Screening</div>
        <div className="la-screencounts">
          <div className="la-sc include"><span className="num">{project.screen.include}</span><span className="lbl">incl</span></div>
          <div className="la-sc maybe"><span className="num">{project.screen.maybe}</span><span className="lbl">maybe</span></div>
          <div className="la-sc exclude"><span className="num">{project.screen.exclude}</span><span className="lbl">excl</span></div>
          <div className="la-sc todo"><span className="num">{project.screen.todo}</span><span className="lbl">todo</span></div>
        </div>

        <div className="la-sectionlabel">Subcollections</div>
        {project.subcollections.map((subcollection) => (
          <div key={subcollection.id} className="la-subcol">
            <Icon name={subcollection.icon} size={14} />
            <span style={{ flex: 1, minWidth: 0 }}>{subcollection.name}</span>
            <span className="n">{subcollection.n}</span>
          </div>
        ))}

        <div className="la-sectionlabel">Project tags</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, padding: "0 12px 16px" }}>
          {project.tags.length ? project.tags.map((tag) => <span key={tag} className={`la-tag${tagFilter.includes(tag) ? " on" : ""}`} onClick={() => toggleTag(tag)}>{tag}</span>) : <span className="la-tag">no tags yet</span>}
        </div>
      </div>
    </div>
  );
}

function CollapsedRail({ title, icon, side, onExpand }: { title: string; icon: string; side: "left" | "right"; onExpand: () => void }) {
  return (
    <div
      className={side === "left" ? "la-col la-colborder-r" : "la-agent la-colborder-l"}
      style={{ width: 42, alignItems: "center", background: "var(--bg-secondary)", cursor: "pointer" }}
      onClick={onExpand}
      title={`Expand ${title}`}
    >
      <button type="button" className="la-iconbtn" style={{ marginTop: 7 }} onClick={onExpand}>
        <Icon name={side === "left" ? "panel-left-open" : "panel-right-open"} size={16} />
      </button>
      <div style={{ writingMode: "vertical-rl", transform: side === "left" ? "rotate(180deg)" : undefined, font: "var(--text-label)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginTop: 14, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 8 }}>
        <Icon name={icon} size={14} color="var(--accent-soft)" />
        {title}
      </div>
    </div>
  );
}

function PaperListPane({ papers, selId, onSelect, title, showScreen = true, filterNote }: { papers: UiPaper[]; selId: string | null; onSelect: (paperId: string) => void; title: string; showScreen?: boolean; filterNote?: string | null }) {
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = papers.filter((paper) => paperMatchesQuery(paper, query));
  if (collapsed) return <CollapsedRail title={title} icon="files" side="left" onExpand={() => setCollapsed(false)} />;
  return (
    <div className="la-col la-colborder-r" style={{ width: 304 }}>
      <PanelHead title={title} count={filtered.length}>
        <button type="button" className="la-iconbtn" title="Sort"><Icon name="arrow-up-down" size={15} /></button>
        <button type="button" className="la-iconbtn" title="Minimize paper list" onClick={() => setCollapsed(true)}><Icon name="panel-left-close" size={15} /></button>
      </PanelHead>
      <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border-deep)" }}>
        <div className="la-field" style={{ padding: "6px 10px" }}>
          <Icon name="search" size={14} />
          <input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Filter papers..." />
        </div>
      </div>
      {filterNote ? (
        <div style={{ padding: "7px 12px", font: "var(--text-caption)", color: "var(--accent-bright)", background: "var(--surface-highlight-alt)", display: "flex", alignItems: "center", gap: 6, borderBottom: "1px solid var(--border-light)" }}>
          <Icon name="filter" size={11} />
          {filterNote}
        </div>
      ) : null}
      <div className="la-paperlist">
        {filtered.length === 0 ? <Empty icon="search-x" title="No papers match" desc="Adjust filters or clear the active research question." /> : null}
        {filtered.map((paper) => (
          <div key={paper.id} className={`la-paper${selId === paper.id ? " on" : ""}`} onClick={() => onSelect(paper.id)}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              {showScreen ? <ScreenChip state={paper.screen} /> : null}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="ptitle">{paper.title}</div>
                <div className="pmeta">
                  <span>{paper.firstAuthor} et al.</span>
                  {paper.year ? <span className="yr">{paper.year}</span> : null}
                  <span>·</span>
                  <span>{paper.venue}</span>
                  {paper.starred ? <Icon name="star" size={11} color="var(--state-warning)" /> : null}
                </div>
                <div className="ptags">
                  {paper.tags.slice(0, 3).map((tag) => (
                    <span key={tag} className="la-tag" style={{ pointerEvents: "none", padding: "1px 6px" }}>
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Reader({
  paper,
  markdown,
  markdownNotice,
  citationTarget,
  citationActivation,
  pdfAnnotations,
  setPdfAnnotations,
  activePdfAnnotationId,
  activePdfAnnotationKey
}: {
  paper: UiPaper | null;
  markdown: string | null;
  markdownNotice: string | null;
  citationTarget: CitationTarget | null;
  citationActivation: number;
  pdfAnnotations: PdfAnnotation[];
  setPdfAnnotations: Dispatch<SetStateAction<PdfAnnotation[]>>;
  activePdfAnnotationId: string | null;
  activePdfAnnotationKey: number;
}) {
  const [tab, setTab] = useState<ReaderTab>("pdf");
  const [side, setSide] = useState(false);
  useEffect(() => setSide(false), [paper?.id]);
  useEffect(() => {
    if (!citationTarget || citationTarget.paperId !== paper?.id) return;
    setTab(citationTarget.pdf.available ? "pdf" : "markdown");
    setSide(false);
  }, [citationTarget, paper?.id]);
  useEffect(() => {
    if (!activePdfAnnotationId) return;
    setTab("pdf");
    setSide(false);
  }, [activePdfAnnotationId, activePdfAnnotationKey]);
  if (!paper) return <Empty icon="file-search" title="No paper selected" desc="Import or select a paper to open the reader." />;
  return (
    <div className="la-reader">
      <div className="la-readertabs">
        {([
          ["pdf", "file", "PDF"],
          ["markdown", "file-text", "Markdown"],
          ["notes", "sticky-note", "Notes"]
        ] as const).map(([key, tabIcon, label]) => (
          <button key={key} type="button" className={`la-rtab${tab === key && !side ? " on" : ""}`} onClick={() => { setTab(key as ReaderTab); setSide(false); }}>
            <Icon name={tabIcon} size={14} />
            {label}
          </button>
        ))}
        <span className="spacer" />
        <div className="rtools">
          <button type="button" className="la-iconbtn" title="Side-by-side PDF + Markdown" onClick={() => setSide((current) => !current)} style={side ? { color: "var(--accent-bright)", background: "var(--overlay-hover)" } : undefined}>
            <Icon name="columns-2" size={15} />
          </button>
          <button type="button" className="la-iconbtn" title="Highlight"><Icon name="highlighter" size={15} /></button>
          <button type="button" className="la-iconbtn" title="Search in document"><Icon name="search" size={15} /></button>
        </div>
      </div>
      {side ? (
        <div className="la-readerbody" style={{ display: "flex", overflow: "hidden" }}>
          <div className="scroll" style={{ flex: 1, borderRight: "1px solid var(--border-deep)" }}>
            <PdfView
              paper={paper}
              citationTarget={citationTarget}
              citationActivation={citationActivation}
              pdfAnnotations={pdfAnnotations}
              setPdfAnnotations={setPdfAnnotations}
              activePdfAnnotationId={activePdfAnnotationId}
              activePdfAnnotationKey={activePdfAnnotationKey}
            />
          </div>
          <div className="scroll" style={{ flex: 1 }}><MarkdownView paper={paper} markdown={markdown} notice={markdownNotice} /></div>
        </div>
      ) : (
        <div className="la-readerbody">
          {citationTarget && citationTarget.paperId === paper.id ? <CitationTargetBanner target={citationTarget} /> : null}
          {tab === "pdf" ? (
            <PdfView
              paper={paper}
              citationTarget={citationTarget}
              citationActivation={citationActivation}
              pdfAnnotations={pdfAnnotations}
              setPdfAnnotations={setPdfAnnotations}
              activePdfAnnotationId={activePdfAnnotationId}
              activePdfAnnotationKey={activePdfAnnotationKey}
            />
          ) : null}
          {tab === "markdown" ? <MarkdownView paper={paper} markdown={markdown} notice={markdownNotice} /> : null}
          {tab === "notes" ? <NotesView paper={paper} /> : null}
        </div>
      )}
    </div>
  );
}

function CitationTargetBanner({ target }: { target: CitationTarget }) {
  return (
    <div className="la-citationtarget">
      <div className="ct-head">
        <Icon name="quote" size={14} />
        <span>Resolved citation</span>
        <Badge variant="accent">p.{target.page ?? "?"}</Badge>
      </div>
      <div className="ct-meta">
        <span>PDF {target.pdf.available ? `page ${target.pdf.page ?? "?"}` : "not attached"}</span>
        <span>Markdown {target.markdown.available ? `L${target.markdown.startLine ?? "?"}-L${target.markdown.endLine ?? "?"}` : "not generated"}</span>
        <span>Rects: {target.pdf.rectSource}</span>
      </div>
      <div className="ct-quote">"{target.quote}"</div>
    </div>
  );
}

function PdfView({
  paper,
  citationTarget,
  citationActivation,
  pdfAnnotations,
  setPdfAnnotations,
  activePdfAnnotationId,
  activePdfAnnotationKey
}: {
  paper: UiPaper;
  citationTarget?: CitationTarget | null;
  citationActivation: number;
  pdfAnnotations: PdfAnnotation[];
  setPdfAnnotations: Dispatch<SetStateAction<PdfAnnotation[]>>;
  activePdfAnnotationId: string | null;
  activePdfAnnotationKey: number;
}) {
  const pdfPath = paper.entry.paper.filePaths.pdf;
  const citationHighlight =
    citationTarget && citationTarget.paperId === paper.id && citationTarget.pdf.available
      ? [
          {
            id: citationTarget.passageId,
            activationKey: citationActivation,
            page: citationTarget.pdf.page ?? citationTarget.page ?? 1,
            quote: citationTarget.quote,
            color: "yellow" as const,
            active: true,
            rects: citationTarget.pdf.rects.map((rect) => ({
              page: rect.page,
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height
            }))
          }
        ]
      : [];
  if (pdfPath) {
    return (
      <div className="la-pdfwrap">
        <PdfReader
          source={`${API_BASE}/api/papers/${paper.id}/pdf`}
          highlights={citationHighlight}
          annotations={pdfAnnotations}
          onAnnotationsChange={setPdfAnnotations}
          activeAnnotationId={activePdfAnnotationId}
          activeAnnotationKey={activePdfAnnotationKey}
          fallback={<div className="pdf-loading">Loading {paper.title}...</div>}
        />
      </div>
    );
  }
  return (
    <div className="la-pdfwrap">
      <PdfUnavailable title={paper.title} />
      <PdfPage paper={paper} />
    </div>
  );
}

function PdfPage({ paper }: { paper: UiPaper }) {
  return (
    <div className="la-pdfwrap">
      <div className="la-pdfpage">
        <div className="pp-title">{paper.title}</div>
        <div className="pp-authors">{paper.authors}</div>
        <div className="pp-venue">{paper.venue} {paper.year ?? ""} · {paper.doi}</div>
        <div className="pp-h" style={{ textAlign: "center" }}>Abstract</div>
        <div className="pp-abstract">{paper.abstract}</div>
        <div className="pp-col">
          <div className="pp-h">1&nbsp;&nbsp;Import status</div>
          <p className="pp-p">This paper is stored in the global LitAgent library. PDF rendering is available when a local PDF is present; otherwise this page previews known metadata.</p>
          <p className="pp-p">Converted Markdown, extracted assets, passages, evidence references, and notes are versioned in the local research repository.</p>
          <div className="pp-h">2&nbsp;&nbsp;Tags</div>
          <p className="pp-p">{paper.tags.length ? paper.tags.join(", ") : "No tags yet."}</p>
        </div>
        <div className="la-pdfnum">1 / {paper.pages}</div>
      </div>
    </div>
  );
}

function isExternalMarkdownUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("#");
}

function splitMarkdownUrlSuffix(value: string): { path: string; suffix: string } {
  const suffixIndex = value.search(/[?#]/);
  if (suffixIndex === -1) return { path: value, suffix: "" };
  return {
    path: value.slice(0, suffixIndex),
    suffix: value.slice(suffixIndex)
  };
}

function relativeMarkdownAssetPath(src: string): string | null {
  const { path: srcPath } = splitMarkdownUrlSuffix(src);
  const normalized = srcPath.replaceAll("\\", "/").replace(/^\/+/, "").replace(/^(\.\/)+/, "");
  if (!normalized) return null;
  const parts = normalized.split("/").filter(Boolean);
  const assetsIndex = parts.findIndex((part) => part === "assets");
  if (assetsIndex >= 0) return parts.slice(assetsIndex + 1).join("/") || null;
  const onlyPart = parts[0];
  if (parts.length === 1 && onlyPart && /\.(apng|avif|bmp|gif|jpe?g|jfif|pjpeg|pjp|png|svgz?|tiff?|webp)$/i.test(onlyPart)) return onlyPart;
  return null;
}

function markdownAssetUrl(paperId: string, src: string | undefined): string | undefined {
  if (!src) return src;
  const trimmed = src.trim();
  if (!trimmed || isExternalMarkdownUrl(trimmed) || trimmed.startsWith("/api/")) return trimmed;
  const { suffix } = splitMarkdownUrlSuffix(trimmed);
  const assetPath = relativeMarkdownAssetPath(trimmed);
  if (!assetPath) return trimmed;
  const encodedAssetPath = assetPath.split("/").map(encodeURIComponent).join("/");
  return `${API_BASE}/api/papers/${encodeURIComponent(paperId)}/markdown-assets/${encodedAssetPath}${suffix}`;
}

function escapeMarkdownLinkLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function cleanMarkdownLinkText(value: string): string {
  return value
    .replace(/\\\\_/g, "_")
    .replace(/\\([\\`*_[\]{}()#+\-.!])/g, "$1")
    .replace(/\s+/g, "");
}

function normalizeSplitMarkdownLinks(line: string): string {
  const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  const matches = [...line.matchAll(linkPattern)];
  if (matches.length < 2) return line;

  let output = "";
  let cursor = 0;
  let index = 0;
  while (index < matches.length) {
    const first = matches[index];
    if (!first || typeof first.index !== "number") break;
    const href = first[2] ?? "";
    const run = [first];
    let runEnd = first.index + first[0].length;
    let nextIndex = index + 1;

    while (nextIndex < matches.length) {
      const next = matches[nextIndex];
      if (!next || typeof next.index !== "number" || next[2] !== href) break;
      const between = line.slice(runEnd, next.index);
      if (!/^\s*$/.test(between)) break;
      run.push(next);
      runEnd = next.index + next[0].length;
      nextIndex += 1;
    }

    output += line.slice(cursor, first.index);
    if (run.length > 1) {
      output += `[${escapeMarkdownLinkLabel(href)}](${href})`;
      cursor = runEnd;
      index = nextIndex;
    } else {
      output += first[0];
      cursor = runEnd;
      index += 1;
    }
  }
  return output + line.slice(cursor);
}

function normalizeBareSplitUrls(line: string): string {
  return line.replace(
    /(^|[\s>])((?:https?:\/\/)[^\s<>()]+\/)\s+((?=[A-Za-z0-9_.-]*[._])[A-Za-z0-9_.-]+(?:\/[^\s<>()]*)?)/g,
    (_match, prefix: string, base: string, suffix: string) => `${prefix}<${base}${suffix}>`
  );
}

function normalizeMarkdownMath(markdown: string): string {
  let inFence: string | null = null;
  return markdown
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      const fenceMatch = trimmed.match(/^(```+|~~~+)/);
      if (fenceMatch) {
        const fence = fenceMatch[1] ?? "";
        inFence = inFence && fence.startsWith(inFence[0] ?? "") ? null : fence;
        return line;
      }
      if (inFence) return line;
      const displayMath = line.match(/^(\s*)\$\$(.+)\$\$(\s*)$/);
      if (displayMath) {
        const indent = displayMath[1] ?? "";
        const expression = displayMath[2]?.trim() ?? "";
        if (expression) return `${indent}$$\n${indent}${expression}\n${indent}$$`;
      }
      return normalizeBareSplitUrls(normalizeSplitMarkdownLinks(line));
    })
    .join("\n");
}

function plainTextFromNode(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(plainTextFromNode).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return plainTextFromNode(node.props.children);
  return "";
}

function cleanUrlLabel(value: string): string {
  return cleanMarkdownLinkText(value).replace(/^mailto:/, "");
}

const subscriptChars: Record<string, string> = {
  "0": "₀",
  "1": "₁",
  "2": "₂",
  "3": "₃",
  "4": "₄",
  "5": "₅",
  "6": "₆",
  "7": "₇",
  "8": "₈",
  "9": "₉",
  "+": "₊",
  "-": "₋",
  "=": "₌",
  "(": "₍",
  ")": "₎",
  i: "ᵢ",
  j: "ⱼ",
  k: "ₖ",
  n: "ₙ"
};

function subscript(value: string): string {
  return [...value].map((char) => subscriptChars[char] ?? char).join("");
}

function accentExpression(value: string, accent: "\u0302" | "\u0304"): string {
  return `${value}${accent}`;
}

function formatAlgorithmCode(value: string): string {
  return value
    .replace(/\\widehat\{([^}]+)\}/g, (_match, expression: string) => accentExpression(expression, "\u0302"))
    .replace(/\\hat\{([^}]+)\}/g, (_match, expression: string) => accentExpression(expression, "\u0302"))
    .replace(/\\bar\{([^}]+)\}/g, (_match, expression: string) => accentExpression(expression, "\u0304"))
    .replace(/\\leftarrow/g, "←")
    .replace(/\\cdots/g, "⋯")
    .replace(/\\dots/g, "…")
    .replace(/\\Delta/g, "Δ")
    .replace(/\\in/g, "∈")
    .replace(/\\\{/g, "{")
    .replace(/\\\}/g, "}")
    .replace(/\b([A-Za-z])_\{([^}]+)\}/g, (_match, base: string, expression: string) => `${base}${subscript(expression)}`)
    .replace(/\b([A-Za-z])_([A-Za-z0-9+-]+)/g, (_match, base: string, expression: string) => `${base}${subscript(expression)}`)
    .replace(/Δ\s+B/g, "ΔB")
    .replace(/\s+/g, " ")
    .trim();
}

type AlgorithmRow = {
  code: string;
  comment: string | null;
  indent: number;
  kind: "statement" | "keyword" | "comment";
};

function isAlgorithmCode(value: string): boolean {
  return /\\leftarrow|\\hat\{|\\bar\{|\\widehat\{|end for|end if|for .+ do/.test(value);
}

function parseAlgorithmRows(source: string): AlgorithmRow[] {
  const rows: AlgorithmRow[] = [];
  const lines = source.replace(/\n+$/g, "").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, "    ").replace(/\s+$/g, "");
    const trimmed = line.trim();
    if (!trimmed) continue;
    const indent = Math.min(5, Math.floor((line.match(/^\s*/)?.[0].length ?? 0) / 4));
    const commentSplit = trimmed.split(/[▶⊳]/);
    const rawCode = (commentSplit[0] ?? "").trim();
    const rawComment = commentSplit.slice(1).join(" ").trim();
    const commentOnly = !rawCode || (!/\\leftarrow|←|for\b|if\b|end\b|append|\[|\]/.test(rawCode) && /\s/.test(rawCode));

    if (commentOnly) {
      const comment = formatAlgorithmCode(rawComment || rawCode);
      const previous = rows.at(-1);
      if (previous && !previous.comment) {
        previous.comment = comment;
      } else {
        rows.push({ code: "", comment, indent, kind: "comment" });
      }
      continue;
    }

    const code = formatAlgorithmCode(rawCode);
    const keyword = /^(for|if|end\b)/.test(code);
    rows.push({
      code,
      comment: rawComment ? formatAlgorithmCode(rawComment) : null,
      indent,
      kind: keyword ? "keyword" : "statement"
    });
  }
  return rows;
}

function AlgorithmBlock({ source }: { source: string }) {
  const rows = useMemo(() => parseAlgorithmRows(source), [source]);
  return (
    <figure className="la-algo" aria-label="Algorithm pseudocode">
      <ol>
        {rows.map((row, index) => (
          <li key={`${index}-${row.code || row.comment}`} className={`la-algo-row ${row.kind}`} style={{ "--indent": row.indent } as CSSProperties}>
            <span className="la-algo-num">{index + 1}</span>
            <span className="la-algo-code">{row.code}</span>
            {row.comment ? <span className="la-algo-comment">{row.comment}</span> : null}
          </li>
        ))}
      </ol>
    </figure>
  );
}

function MarkdownView({ paper, markdown, notice }: { paper: UiPaper; markdown: string | null; notice?: string | null }) {
  const renderedMarkdown = useMemo(() => (markdown ? normalizeMarkdownMath(markdown) : null), [markdown]);
  if (markdown) {
    return (
      <div className="la-md">
        <div className="la-md-head">
          <h1>{paper.title}</h1>
          <div className="byline">{paper.authors} · converted Markdown · <code>library/markdown/{paper.id}/paper.md</code></div>
        </div>
        {notice ? (
          <div className="la-md-notice">
            <Icon name="check-circle-2" size={13} />
            {notice}
          </div>
        ) : null}
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeRaw, rehypeKatex]}
          disallowedElements={["script", "style", "iframe", "object", "embed"]}
          components={{
            pre: ({ children, ...props }) => {
              const source = plainTextFromNode(Children.toArray(children)).replace(/\n$/g, "");
              if (isAlgorithmCode(source)) return <AlgorithmBlock source={source} />;
              return <pre {...props}>{children}</pre>;
            },
            code: ({ className, children, ...props }) => (
              <code {...props} className={className}>
                {children}
              </code>
            ),
            img: ({ src, alt, ...props }) => (
              <img {...props} src={markdownAssetUrl(paper.id, src)} alt={alt ?? ""} loading="lazy" />
            ),
            a: ({ href, children, ...props }) => {
              const rawLabel = plainTextFromNode(children);
              const isHttp = !!href && /^https?:\/\//i.test(href);
              const displayAsUrl = isHttp && (/^https?:\/\//i.test(cleanMarkdownLinkText(rawLabel)) || rawLabel.includes("\\_"));
              const className = `${props.className ?? ""}${displayAsUrl ? " la-url" : ""}`.trim() || undefined;
              return (
              <a
                {...props}
                className={className}
                href={href ?? undefined}
                target={isHttp ? "_blank" : undefined}
                rel={isHttp ? "noreferrer" : undefined}
                title={isHttp ? href : props.title}
              >
                {displayAsUrl && href ? cleanUrlLabel(href) : children}
              </a>
              );
            }
          }}
        >
          {renderedMarkdown}
        </ReactMarkdown>
      </div>
    );
  }
  return (
    <div className="la-md">
      <h1>{paper.title}</h1>
      <div className="byline">{paper.authors} · {paper.venue} {paper.year ?? ""}</div>
      {notice ? (
        <div className="la-md-notice warn">
          <Icon name="alert-triangle" size={13} />
          {notice}
        </div>
      ) : null}
      <h2>Markdown not generated yet</h2>
      <p>Run PDF to Markdown conversion to create a versioned Markdown file, assets, passage records, and search index entries for this paper.</p>
      <h2>Known metadata</h2>
      <ul>
        <li>Citekey: <code>{paper.citekey}</code></li>
        <li>DOI/arXiv: <code>{paper.doi}</code></li>
        <li>Tags: {paper.tags.length ? paper.tags.join(", ") : "none"}</li>
      </ul>
    </div>
  );
}

function NotesView({ paper }: { paper: UiPaper }) {
  return (
    <div className="la-md">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <Badge variant="accent" dot="var(--accent-bright)">Note</Badge>
        <span style={{ font: "var(--text-caption)", color: "var(--text-muted)" }} className="mono">
          projects/*/notes/{paper.citekey}.md
        </span>
      </div>
      <h1>Reading note - {paper.citekey}</h1>
      <h2>Key findings</h2>
      <p>Notes are Markdown files linked to papers, passages, annotations, workflow runs, and research questions.</p>
      <blockquote>Agent-generated notes should cite indexed passages and remain editable before acceptance.</blockquote>
    </div>
  );
}

function PaperInspector({ paper }: { paper: UiPaper }) {
  const [accepted, setAccepted] = useState(false);
  useEffect(() => setAccepted(false), [paper.id]);
  return (
    <div className="scroll" style={{ flex: 1 }}>
      <div className="la-meta">
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          <Btn variant="subtle" sm icon="quote">Cite</Btn>
          <Btn variant="subtle" sm icon="external-link">DOI</Btn>
          <Btn variant="subtle" sm icon="star" style={paper.starred ? { color: "var(--state-warning)" } : undefined}>Star</Btn>
        </div>
        <div className="la-metarow"><span className="k">Authors</span><span className="v">{paper.authors}</span></div>
        <div className="la-metarow"><span className="k">Venue</span><span className="v">{paper.venue} · {paper.year ?? "unknown"}</span></div>
        <div className="la-metarow"><span className="k">Type</span><span className="v"><Badge variant="outline">{paper.type}</Badge></span></div>
        <div className="la-metarow"><span className="k">Citekey</span><span className="v mono">{paper.citekey}</span></div>
        <div className="la-metarow"><span className="k">DOI</span><span className="v mono" style={{ color: "var(--accent-soft)" }}>{paper.doi}</span></div>
        <div className="la-metarow"><span className="k">Added</span><span className="v mono">{paper.added}</span></div>
      </div>

      <div className="la-sectionlabel">Tags</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, padding: "0 12px 4px" }}>
        {paper.tags.map((tag) => <span key={tag} className="la-tag on">{tag}<Icon name="x" size={11} className="x" /></span>)}
        <span className="la-tag"><Icon name="plus" size={11} />add</span>
      </div>

      <div className="la-sectionlabel">Methods</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, padding: "0 12px 8px" }}>
        {paper.methods.length ? paper.methods.map((method) => <span key={method} className="la-tag"><Icon name="function-square" size={11} />{method}</span>) : <span className="la-tag">extract methods</span>}
      </div>

      {!accepted ? (
        <div style={{ padding: "4px 12px 16px" }}>
          <div className="la-proposal">
            <div className="ph"><Icon name="sparkles" size={13} />Proposed by agent</div>
            <div className="pbody">Agent-generated tags and metadata are staged as proposals before they update canonical records.</div>
            <div style={{ font: "var(--text-caption)", color: "var(--text-muted)", marginBottom: 9, display: "flex", alignItems: "center", gap: 6 }}>
              <Icon name="link" size={11} /> evidence-backed changes appear here
            </div>
            <div className="pactions">
              <Btn variant="primary" sm icon="check" onClick={() => setAccepted(true)}>Accept</Btn>
              <Btn variant="ghost" sm icon="pencil">Edit</Btn>
              <Btn variant="ghost" sm icon="x">Reject</Btn>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ padding: "4px 12px 16px", color: "var(--state-success)", font: "var(--text-caption)", display: "flex", alignItems: "center", gap: 7 }}>
          <Icon name="check-circle-2" size={13} /> Proposal accepted
        </div>
      )}
    </div>
  );
}

function AgentPanel({
  selectedPaper,
  contextLabel,
  scopeProjectId,
  providers,
  selectedProviderId,
  selectedModel,
  onProviderChange,
  onModelChange,
  workflows,
  passages,
  qa,
  pdfAnnotations,
  activePdfAnnotationId,
  onJumpPdfAnnotation,
  onDeletePdfAnnotation,
  onClearPdfAnnotations,
  onRunWorkflow,
  onCancelWorkflow,
  onAsk,
  onOpenCitation
}: WorkspaceProps & { contextLabel: string; scopeProjectId: string | null }) {
  const [tab, setTab] = useState<"details" | "ask" | "evidence" | "annotations" | "queue">("details");
  const [input, setInput] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  if (collapsed) return <CollapsedRail title="Evidence & agent" icon="sparkles" side="right" onExpand={() => setCollapsed(false)} />;
  const evidence: EvidenceRef[] = qa?.evidence.length ? qa.evidence : passages.slice(0, 5).map((passage) => ({ passageId: passage.id, paperId: passage.paperId, page: passage.page, quote: passage.quote, confidence: 0.75 }));
  const queueWorkflows = workflows.filter((run) => workflowMatchesContext(run, selectedPaper, scopeProjectId));
  const queueRunning = queueWorkflows.filter((run) => run.status === "running" || run.status === "queued").length;
  const renderTab = (
    id: "details" | "ask" | "evidence" | "annotations" | "queue",
    label: string,
    count?: number,
    countStyle?: CSSProperties
  ) => (
    <button type="button" className={`la-atab${tab === id ? " on" : ""}`} onClick={() => setTab(id)} title={label}>
      <span className="la-atab-label">{label}</span>
      {count !== undefined && (count > 0 || id === "annotations") ? <span className="n" style={countStyle}>{count}</span> : null}
    </button>
  );
  return (
    <div className="la-agent la-colborder-l">
      <div className="la-agenttabs">
        {renderTab("details", "Details")}
        {renderTab("ask", "Ask")}
        {renderTab("evidence", "Evidence", evidence.length)}
        {renderTab("annotations", "Annotations", pdfAnnotations.length)}
        {renderTab("queue", "Queue", queueRunning > 0 ? queueRunning : undefined, { color: "var(--accent-bright)" })}
        <button type="button" className="la-iconbtn" title="Minimize panel" onClick={() => setCollapsed(true)}><Icon name="panel-right-close" size={15} /></button>
      </div>
      {tab === "ask" || tab === "evidence" ? (
        <div className="la-modelbar">
          <ModelPicker providers={providers} providerId={selectedProviderId} model={selectedModel} onProviderChange={onProviderChange} onModelChange={onModelChange} />
          <button type="button" className="la-iconbtn" title="Agent settings"><Icon name="sliders-horizontal" size={15} /></button>
        </div>
      ) : null}
      {tab === "details" && selectedPaper ? (
        <div className="la-agentbody fade-in" style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 12px", borderBottom: "1px solid var(--border-light)" }}>
            <span style={{ font: "var(--text-caption)", color: "var(--text-muted)", flex: 1 }}>Screening</span>
            <button type="button" className="la-iconbtn" title="Include" style={{ color: "var(--state-success)" }}><Icon name="check" size={15} /></button>
            <button type="button" className="la-iconbtn" title="Maybe" style={{ color: "var(--state-warning)" }}><Icon name="help-circle" size={15} /></button>
            <button type="button" className="la-iconbtn" title="Exclude" style={{ color: "var(--state-error)" }}><Icon name="x" size={15} /></button>
          </div>
          <PaperInspector paper={selectedPaper} />
        </div>
      ) : null}
      {tab === "ask" ? (
        <>
          <div className="la-agentbody fade-in" style={{ display: "flex", flexDirection: "column" }}>
            <div className="la-sectionlabel" style={{ paddingBottom: 0 }}>Workflows</div>
            <div className="la-wfgrid">
              {workflowRecipes.slice(0, 8).map((recipe) => (
                <button key={recipe.type} type="button" className="la-wfbtn" onClick={() => onRunWorkflow(recipe.type, selectedPaper ? [selectedPaper.id] : [], null)} title={recipe.desc}>
                  <Icon name={recipe.icon} size={15} />
                  <span>{recipe.name}</span>
                </button>
              ))}
            </div>
            <div className="la-sectionlabel">Cited Q&A · {contextLabel}</div>
            <div className="la-qa">
              {qa ? (
                <div className="la-amsg">
                  {qa.answer}
                  {qa.evidence.map((item, index) => (
                    <span key={item.passageId} className="cite" onClick={() => { setTab("evidence"); onOpenCitation(item, scopeProjectId); }}>{index + 1}</span>
                  ))}
                </div>
              ) : (
                <div className="la-amsg notfound">Ask a question. Answers must cite indexed passages and will say not found when retrieval has no evidence.</div>
              )}
            </div>
          </div>
          <div className="la-qabar">
            <div className="la-field">
              <Icon name="message-square" size={15} />
              <input
                value={input}
                onChange={(event) => setInput(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && input.trim()) {
                    onAsk(input.trim(), selectedPaper?.id ?? null);
                    setInput("");
                  }
                }}
                placeholder="Ask a question - answers are cited..."
              />
              <button type="button" className="la-iconbtn" onClick={() => { if (input.trim()) { onAsk(input.trim(), selectedPaper?.id ?? null); setInput(""); } }} style={{ color: "var(--accent-bright)" }}>
                <Icon name="send" size={15} />
              </button>
            </div>
            <div style={{ font: "var(--text-caption)", color: "var(--text-muted)", marginTop: 6, display: "flex", alignItems: "center", gap: 5 }}>
              <Icon name="shield-check" size={11} /> Answers cite passages · scope {scopeProjectId ? "project" : "global"}
            </div>
          </div>
        </>
      ) : null}
      {tab === "evidence" ? (
        <div className="la-agentbody fade-in" style={{ paddingTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 12px 10px" }}>
            <span style={{ font: "var(--text-caption)", color: "var(--text-muted)" }}>Evidence stack · {evidence.length} saved</span>
            <Btn variant="ghost" sm icon="download">Export</Btn>
          </div>
          {evidence.length ? evidence.map((item, index) => (
            <div key={item.passageId} className="la-evcard" onClick={() => onOpenCitation(item, scopeProjectId)} title="Open citation target">
              <div className="quote">"{item.quote}"</div>
              <div className="src">
                <span className="cite">{index + 1}</span>
                <span>{item.paperId}</span>
                <span className="pg">p.{item.page ?? "?"}</span>
                <span className="spacer" />
                <ConfBar value={Math.round(item.confidence * 100)} />
              </div>
            </div>
          )) : <Empty icon="quote" title="No evidence yet" desc="Convert and index papers, then ask a cited question." />}
        </div>
      ) : null}
      {tab === "annotations" ? (
        <AnnotationSidePanel
          annotations={pdfAnnotations}
          activeAnnotationId={activePdfAnnotationId}
          onJump={onJumpPdfAnnotation}
          onDelete={onDeletePdfAnnotation}
          onClear={onClearPdfAnnotations}
        />
      ) : null}
      {tab === "queue" ? (
        <div className="la-agentbody fade-in">
          <WorkflowQueue
            workflows={queueWorkflows}
            onCancelWorkflow={onCancelWorkflow}
            emptyTitle={selectedPaper ? "No runs for this paper" : "No runs in this scope"}
            emptyDesc={selectedPaper ? "Selected-paper workflow runs will appear here." : "Project or global workflow runs will appear here."}
          />
        </div>
      ) : null}
    </div>
  );
}

function AnnotationSidePanel({
  annotations,
  activeAnnotationId,
  onJump,
  onDelete,
  onClear
}: {
  annotations: PdfAnnotation[];
  activeAnnotationId: string | null;
  onJump: (id: string) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}) {
  const grouped = useMemo(() => {
    const byPage = new Map<number, PdfAnnotation[]>();
    for (const annotation of annotations) {
      const page = annotation.position.boundingRect.pageNumber || annotation.litPage || 1;
      const pageAnnotations = byPage.get(page) ?? [];
      pageAnnotations.push(annotation);
      byPage.set(page, pageAnnotations);
    }
    return [...byPage.entries()].sort(([left], [right]) => left - right);
  }, [annotations]);

  return (
    <div className="la-agentbody fade-in la-annbody">
      <div className="la-annbar">
        <span>Local annotations · {annotations.length}</span>
        <Btn variant="ghost" sm icon="trash-2" onClick={onClear} disabled={!annotations.length}>Clear</Btn>
      </div>
      {annotations.length ? (
        <div className="la-annlist">
          {grouped.map(([page, pageAnnotations]) => (
            <section key={page} className="la-annpage">
              <div className="la-annpagehead">
                <span>Page {page}</span>
                <span>{pageAnnotations.length}</span>
              </div>
              {pageAnnotations.map((annotation) => (
                <article key={annotation.id} className={`la-anncard${annotation.id === activeAnnotationId ? " on" : ""}`}>
                  <button type="button" className="la-annopen" onClick={() => onJump(annotation.id)} title="Jump to annotation">
                    <span className="kind">{pdfAnnotationLabel(annotation)}</span>
                    <span className="text">{truncatePdfAnnotation(annotation.litQuote || annotation.content?.text || pdfAnnotationLabel(annotation))}</span>
                  </button>
                  <button type="button" className="la-anndel" title="Delete annotation" onClick={() => onDelete(annotation.id)}>
                    <Icon name="trash-2" size={13} />
                  </button>
                </article>
              ))}
            </section>
          ))}
        </div>
      ) : (
        <Empty icon="highlighter" title="No annotations" desc="Use the PDF toolbar to highlight text, draw an area, or place a note." />
      )}
    </div>
  );
}

function pdfAnnotationLabel(annotation: PdfAnnotation): string {
  if (annotation.type === "freetext") return "Note";
  if (annotation.type === "area") return "Area";
  if (annotation.type === "drawing") return "Drawing";
  if (annotation.type === "shape") return annotation.content?.shape?.shapeType ?? "Shape";
  return "Text";
}

function truncatePdfAnnotation(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact;
}

function workflowMatchesPaper(run: WorkflowRun, paperId: string): boolean {
  return run.scope.paperIds.includes(paperId);
}

function workflowMatchesContext(run: WorkflowRun, paper: UiPaper | null, projectId: string | null): boolean {
  if (paper) return workflowMatchesPaper(run, paper.id);
  if (projectId) return run.projectId === projectId;
  return run.projectId === null;
}

function WorkflowQueue({
  workflows,
  onCancelWorkflow,
  emptyTitle = "No workflow runs yet",
  emptyDesc = "Run an agentic task from the Ask tab or Workflows tool."
}: {
  workflows: WorkflowRun[];
  onCancelWorkflow: (runId: string) => void;
  emptyTitle?: string;
  emptyDesc?: string;
}) {
  return (
    <div className="la-wfqueue">
      {workflows.length ? workflows.map((run) => (
        <div key={run.id} className="la-wfrun">
          <div className="wfh">
            {run.status === "running" ? <span className="la-runningdot" /> : run.status === "completed" ? <Icon name="check-circle-2" size={14} color="var(--state-success)" /> : run.status === "queued" ? <Icon name="clock" size={14} color="var(--text-muted)" /> : <Icon name="x-circle" size={14} color="var(--state-error)" />}
            <span className="name">{workflowLabels[run.type]}</span>
            {run.status === "running" || run.status === "queued" ? <button type="button" className="la-iconbtn" title="Cancel" onClick={() => onCancelWorkflow(run.id)}><Icon name="square" size={13} /></button> : null}
          </div>
          <div className="wfsub">
            {new Date(run.createdAt).toLocaleString()} · <span className="mono">{run.providerId}{run.model ? ` / ${run.model}` : ""}</span>
          </div>
          {(run.status === "running" || run.status === "queued") ? <div className="la-progress"><span style={{ width: run.status === "running" ? "62%" : "8%" }} /></div> : null}
          <Badge variant={run.status === "completed" ? "success" : run.status === "running" ? "accent" : run.status === "failed" ? "error" : undefined}>{statusLabel(run.status)}</Badge>
        </div>
      )) : <Empty icon="workflow" title={emptyTitle} desc={emptyDesc} />}
    </div>
  );
}

function ScopedToolView(props: WorkspaceProps & { tool: WorkspaceTool; contextLabel: string; scopeProjectId: string | null }) {
  if (props.tool === "workflows") return <WorkflowsView {...props} />;
  if (props.tool === "map") return <ConceptMapView papers={props.papers} />;
  if (props.tool === "notes") return <NotesToolView papers={props.papers} />;
  if (props.tool === "exports") return <ExportsView contextLabel={props.contextLabel} scopeProjectId={props.scopeProjectId} papers={props.papers} />;
  return null;
}

function WorkflowsView({ contextLabel, scopeProjectId, papers, selectedPaper, workflows, onRefreshWorkflows, onRunWorkflow, onCancelWorkflow }: WorkspaceProps & { contextLabel: string; scopeProjectId: string | null }) {
  const [sourceDir, setSourceDir] = useState("pdfs");
  const [force, setForce] = useState(false);
  const [intervalMinutes, setIntervalMinutes] = useState(15);
  const [inbox, setInbox] = useState<PdfInboxItem[]>([]);
  const [automation, setAutomation] = useState<PdfInboxAutomationRule | null>(null);
  const [converterStatus, setConverterStatus] = useState<ConverterStatus | null>(null);
  const [scanning, setScanning] = useState(false);
  const scanInbox = useCallback(() => {
    setScanning(true);
    void api
      .pdfInbox(sourceDir)
      .then(setInbox)
      .finally(() => setScanning(false));
  }, [sourceDir]);

  useEffect(() => {
    scanInbox();
  }, [scanInbox]);

  useEffect(() => {
    void api.pdfInboxAutomation().then((rule) => {
      setAutomation(rule);
      setSourceDir(rule.sourceDir);
      setForce(rule.force);
      setIntervalMinutes(rule.intervalMinutes);
    });
    void api.converterStatus().then(setConverterStatus);
  }, []);

  const patchAutomation = useCallback((patch: Parameters<typeof api.updatePdfInboxAutomation>[0]) => {
    void api.updatePdfInboxAutomation(patch).then((rule) => {
      setAutomation(rule);
      setSourceDir(rule.sourceDir);
      setForce(rule.force);
      setIntervalMinutes(rule.intervalMinutes);
    });
  }, []);

  const runAutomationTrigger = useCallback(() => {
    void api.runPdfInboxAutomation().then(async () => {
      const rule = await api.pdfInboxAutomation();
      setAutomation(rule);
      onRefreshWorkflows();
    });
  }, [onRefreshWorkflows]);

  const selectedPaperIds = selectedPaper ? [selectedPaper.id] : [];
  const scopePaperIds = papers.map((paper) => paper.id);
  const eventTriggerOn = Boolean(automation?.enabled && automation.eventTriggerEnabled);
  const timerTriggerOn = Boolean(automation?.enabled && automation.timerTriggerEnabled);
  const markdownRuns = workflows.filter((run) => run.type === "pdf-markdown-processing");
  const activeMarkdownRun = markdownRuns.find((run) => run.status === "running" || run.status === "queued") ?? null;
  const latestMarkdownRun = markdownRuns[0] ?? null;
  const contextWorkflows = workflows.filter((run) => workflowMatchesContext(run, selectedPaper, scopeProjectId));

  return (
    <div className="scroll" style={{ flex: 1 }}>
      <div style={{ maxWidth: 980, margin: "0 auto", padding: "24px 28px 50px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <h1 style={{ font: "var(--text-h1)", color: "var(--text-high)", margin: 0 }}>Workflows</h1>
          <Badge variant="accent" dot="var(--accent-bright)">{contextLabel}</Badge>
        </div>
        <p style={{ font: "var(--text-body-sm)", color: "var(--text-muted)", margin: "4px 0 22px" }}>
          Agentic document workflows. Generated tags and metadata are proposed first. Every claim stores evidence references.
        </p>

        <section className="la-workflow-section">
          <div className="la-workflow-sectionhead">
            <div>
              <h2>Automatic</h2>
              <p>Event and timer-style recipes for unattended processing.</p>
            </div>
            <Badge variant={inbox.length ? "accent" : undefined}>{scanning ? "scanning" : `${inbox.length} PDF${inbox.length === 1 ? "" : "s"}`}</Badge>
          </div>
          <div className="la-automation-card">
            <div className="la-workflow-icon"><Icon name="folder-open" size={17} /></div>
            <div className="la-auto-main">
              <div className="la-auto-title">
                <span>PDF inbox to Markdown</span>
                <Badge variant="success">Marker first pass</Badge>
                {activeMarkdownRun ? <Badge variant="accent">running</Badge> : latestMarkdownRun ? <Badge>{statusLabel(latestMarkdownRun.status)}</Badge> : null}
              </div>
              <div className={`la-converter-status${converterStatus?.marker.available ? " ok" : " warn"}`}>
                <Icon name={converterStatus?.marker.available ? "check-circle-2" : "alert-triangle"} size={12} />
                <span>{converterStatus?.marker.message ?? "Checking Marker runtime..."}</span>
                {converterStatus ? <span className="mono">{converterStatus.marker.source}</span> : null}
              </div>
              <div className="la-auto-grid">
                <label className="la-mini-field">
                  <span>Source</span>
                  <input
                    value={sourceDir}
                    onChange={(event) => setSourceDir(event.currentTarget.value)}
                    onBlur={() => patchAutomation({ sourceDir })}
                  />
                </label>
                <label className="la-mini-field">
                  <span>Every</span>
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    value={intervalMinutes}
                    onChange={(event) => setIntervalMinutes(Number(event.currentTarget.value))}
                    onBlur={() => patchAutomation({ intervalMinutes: Math.max(1, Math.min(1440, intervalMinutes || 15)) })}
                  />
                </label>
                <label className="la-mini-toggle">
                  <span>Force</span>
                  <Toggle
                    on={force}
                    onClick={() => {
                      const next = !force;
                      setForce(next);
                      patchAutomation({ force: next });
                    }}
                  />
                </label>
                <label className="la-mini-toggle">
                  <span>Event</span>
                  <Toggle
                    on={eventTriggerOn}
                    onClick={() => patchAutomation({ enabled: eventTriggerOn ? timerTriggerOn : true, eventTriggerEnabled: !eventTriggerOn })}
                  />
                </label>
                <label className="la-mini-toggle muted">
                  <span>Timer</span>
                  <Toggle
                    on={timerTriggerOn}
                    onClick={() => patchAutomation({ enabled: timerTriggerOn ? eventTriggerOn : true, timerTriggerEnabled: !timerTriggerOn })}
                  />
                </label>
              </div>
              <div className="la-inbox-list">
                {inbox.slice(0, 4).map((item) => (
                  <div key={item.sourcePath} className="la-inbox-row">
                    <Icon name="file-text" size={12} />
                    <span>{item.relativePath}</span>
                    <span className="mono">{formatBytes(item.size)}</span>
                  </div>
                ))}
                {!inbox.length ? <div className="la-inbox-empty">No PDFs found under {sourceDir}</div> : null}
                {inbox.length > 4 ? <div className="la-inbox-empty">+ {inbox.length - 4} more</div> : null}
              </div>
            </div>
            <div className="la-auto-actions">
              <Btn variant="ghost" sm icon="refresh-cw" onClick={scanInbox} disabled={scanning}>Scan</Btn>
              <Btn
                variant="primary"
                sm
                icon="play"
                onClick={runAutomationTrigger}
                disabled={!inbox.length || Boolean(activeMarkdownRun)}
              >
                Run trigger
              </Btn>
            </div>
          </div>
        </section>

        <section className="la-workflow-section">
          <div className="la-workflow-sectionhead">
            <div>
              <h2>Manual</h2>
              <p>Run a workflow on the selected paper or current scope.</p>
            </div>
            <Badge>{scopeProjectId ? "project scoped" : "global scoped"}</Badge>
          </div>
          <div className={`la-workflow-target${selectedPaper ? "" : " empty"}`}>
            <div className="la-workflow-target-icon">
              <Icon name={selectedPaper ? "file-text" : "circle-dashed"} size={16} />
            </div>
            <div className="la-workflow-target-main">
              <div className="la-workflow-target-label">Selected paper</div>
              <div className="la-workflow-target-title">{selectedPaper?.title ?? "No paper selected"}</div>
              <div className="la-workflow-target-meta">
                {selectedPaper ? `${selectedPaper.authors} · ${selectedPaper.year ?? "unknown year"} · ${selectedPaper.venue}` : "Pick a paper from the list before running selected-paper workflows."}
              </div>
            </div>
            <Badge variant={selectedPaper ? "accent" : undefined}>{selectedPaper ? selectedPaper.id.slice(0, 12) : "none"}</Badge>
          </div>
          <div className="la-manual-grid">
            <div className="la-workflow-card">
              <div className="la-workflow-icon"><Icon name="file-code" size={17} /></div>
              <div style={{ flex: 1 }}>
                <div style={{ font: "var(--text-body-sm)", fontWeight: 500, color: "var(--text-primary)" }}>Convert selected</div>
                <div style={{ font: "var(--text-caption)", color: "var(--text-muted)", marginTop: 2 }}>Marker pass, assets, passages, index</div>
              </div>
              <Btn variant="subtle" sm icon="play" onClick={() => onRunWorkflow("pdf-markdown-processing", selectedPaperIds, null, { force })} disabled={!selectedPaper || Boolean(activeMarkdownRun)}>Run</Btn>
            </div>
            <div className="la-workflow-card">
              <div className="la-workflow-icon"><Icon name="files" size={17} /></div>
              <div style={{ flex: 1 }}>
                <div style={{ font: "var(--text-body-sm)", fontWeight: 500, color: "var(--text-primary)" }}>Convert scope</div>
                <div style={{ font: "var(--text-caption)", color: "var(--text-muted)", marginTop: 2 }}>{scopePaperIds.length} paper{scopePaperIds.length === 1 ? "" : "s"} in scope</div>
              </div>
              <Btn variant="subtle" sm icon="play" onClick={() => onRunWorkflow("pdf-markdown-processing", scopePaperIds, null, { force })} disabled={!scopePaperIds.length || Boolean(activeMarkdownRun)}>Run</Btn>
            </div>
            <div className="la-workflow-card">
              <div className="la-workflow-icon"><Icon name="sparkles" size={17} /></div>
              <div style={{ flex: 1 }}>
                <div style={{ font: "var(--text-body-sm)", fontWeight: 500, color: "var(--text-primary)" }}>Refine Markdown</div>
                <div style={{ font: "var(--text-caption)", color: "var(--text-muted)", marginTop: 2 }}>Targeted LLM cleanup proposals</div>
              </div>
              <Btn variant="subtle" sm icon="play" onClick={() => onRunWorkflow("markdown-refinement", selectedPaperIds, null, { targeted: true })} disabled={!selectedPaper}>Run</Btn>
            </div>
            {workflowRecipes.map((recipe) => (
              <div key={recipe.type} className="la-workflow-card">
                <div className="la-workflow-icon"><Icon name={recipe.icon} size={17} /></div>
                <div style={{ flex: 1 }}>
                  <div style={{ font: "var(--text-body-sm)", fontWeight: 500, color: "var(--text-primary)" }}>{recipe.name}</div>
                  <div style={{ font: "var(--text-caption)", color: "var(--text-muted)", marginTop: 2 }}>{recipe.desc}</div>
                </div>
                <Btn variant="subtle" sm icon="play" onClick={() => onRunWorkflow(recipe.type, selectedPaper ? [selectedPaper.id] : [], null)}>Run</Btn>
              </div>
            ))}
          </div>
        </section>

        <h2 style={{ font: "var(--text-h2)", color: "var(--text-high)", margin: "28px 0 12px" }}>Recent runs</h2>
        <WorkflowQueue
          workflows={contextWorkflows}
          onCancelWorkflow={onCancelWorkflow}
          emptyTitle={selectedPaper ? "No runs for this paper" : "No runs in this scope"}
          emptyDesc={selectedPaper ? "Run a selected-paper workflow to populate this history." : "Run a project or global workflow to populate this history."}
        />
      </div>
    </div>
  );
}

function ConceptMapView({ papers }: { papers: UiPaper[] }) {
  const [sel, setSel] = useState(papers[0]?.id ?? "tags");
  const nodes = [
    ...papers.slice(0, 7).map((paper, index) => ({ id: paper.id, type: "paper", label: `${paper.firstAuthor} ${paper.year ?? ""}`, x: 18 + (index % 4) * 20, y: 28 + Math.floor(index / 4) * 28, icon: "file" })),
    ...[...new Set(papers.flatMap((paper) => paper.tags))].slice(0, 5).map((tag, index) => ({ id: `tag-${tag}`, type: "tag", label: `#${tag}`, x: 24 + index * 14, y: 76, icon: "tag" }))
  ];
  const selNode = nodes.find((node) => node.id === sel) ?? nodes[0];
  return (
    <div className="la-content">
      <div className="la-conceptmap">
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 1 }}>
          {nodes.slice(1).map((node, index) => (
            <line key={node.id} x1={`${nodes[0]?.x ?? 50}%`} y1={`${nodes[0]?.y ?? 50}%`} x2={`${node.x}%`} y2={`${node.y}%`} stroke={index === 0 ? "var(--accent-primary)" : "var(--border-line)"} strokeWidth={index === 0 ? 1.6 : 1} opacity={0.65} />
          ))}
        </svg>
        {nodes.map((node) => (
          <div key={node.id} className={`la-cmnode ${node.type}${sel === node.id ? " sel" : ""}`} style={{ left: node.x + "%", top: node.y + "%" }} onClick={() => setSel(node.id)}>
            <Icon name={node.icon} size={13} />
            {node.label}
          </div>
        ))}
      </div>
      <div className="la-col" style={{ width: 300, background: "var(--bg-secondary)", borderLeft: "1px solid var(--border-deep)" }}>
        <div className="la-panelhead"><h3>Selected node</h3></div>
        <div style={{ padding: "12px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <Icon name={selNode?.icon ?? "share-2"} size={16} color="var(--accent-soft)" />
            <span style={{ font: "var(--text-h3)", color: "var(--text-high)" }}>{selNode?.label ?? "No node"}</span>
          </div>
          <p style={{ font: "var(--text-body-sm)", color: "var(--text-muted)", margin: "0 0 12px" }}>
            Concept-map data is derived from papers and tags. Saved layouts and richer edge types can be wired later.
          </p>
        </div>
      </div>
    </div>
  );
}

function NotesToolView({ papers }: { papers: UiPaper[] }) {
  const [sel, setSel] = useState(papers[0]?.id ?? "");
  const paper = papers.find((candidate) => candidate.id === sel) ?? papers[0];
  return (
    <div className="la-noteslayout">
      <div className="la-noteslist">
        <div className="la-panelhead"><h3>Notes</h3><span className="count">{papers.length}</span><span className="spacer" /><button type="button" className="la-iconbtn"><Icon name="plus" size={15} /></button></div>
        <div className="scroll" style={{ flex: 1 }}>
          {papers.map((candidate) => (
            <div key={candidate.id} className={`la-noteitem${sel === candidate.id ? " on" : ""}`} onClick={() => setSel(candidate.id)}>
              <div className="nt">{candidate.title}</div>
              <div className="nd"><Icon name="sticky-note" size={11} />reading note · <Icon name="link" size={11} />{candidate.tags.length} · {candidate.added}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="la-reader">
        <div className="la-readerbody">{paper ? <NotesView paper={paper} /> : <Empty icon="sticky-note" title="No notes yet" desc="Create a note from a selected paper or workflow artifact." />}</div>
      </div>
    </div>
  );
}

function ExportsView({ contextLabel, scopeProjectId, papers }: { contextLabel: string; scopeProjectId: string | null; papers: UiPaper[] }) {
  const bibUrl = scopeProjectId ? api.exportBibUrl(scopeProjectId) : null;
  return (
    <div className="la-exports">
      <div className="la-exportsinner">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <h1 style={{ font: "var(--text-h1)", color: "var(--text-high)", margin: 0 }}>Exports</h1>
          <Badge variant="accent" dot="var(--accent-bright)">{contextLabel}</Badge>
        </div>
        <p style={{ font: "var(--text-body-sm)", color: "var(--text-muted)", margin: "4px 0 22px" }}>Generate a bibliography from the current scope. Zotero write-back is disabled in MVP.</p>
        <div style={{ display: "flex", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div className="la-sectionlabel" style={{ padding: "0 0 8px" }}>Format</div>
            <div className="la-exportrow" style={{ margin: 0, borderColor: "var(--accent-deep)" }}>
              <div className="ei"><Icon name="file-code" size={17} /></div>
              <div className="et"><div className="name">BibTeX</div><div className="sub">.bib · {papers.length} entries</div></div>
              <Badge variant="success" dot="var(--state-success)">available</Badge>
            </div>
          </div>
          <div style={{ flex: 1.2, minWidth: 300 }}>
            <div className="la-sectionlabel" style={{ padding: "0 0 8px" }}>Actions</div>
            <div style={{ display: "flex", gap: 8 }}>
              {bibUrl ? <a className="la-btn la-btn-primary" href={bibUrl}><Icon name="download" size={14} />Download .bib</a> : <Btn variant="ghost" icon="download" disabled>Project export only</Btn>}
              <Btn variant="ghost" icon="clipboard-copy">Copy</Btn>
            </div>
          </div>
        </div>
        <div className="la-sectionlabel" style={{ padding: "0 0 8px" }}>Preview</div>
        <div className="la-codeblock">{papers.slice(0, 3).map((paper) => `@misc{${paper.citekey},\n  title = {${paper.title}},\n  author = {${paper.authors}},\n  year = {${paper.year ?? "n.d."}}\n}`).join("\n\n") || "No papers in scope."}</div>
      </div>
    </div>
  );
}

function SearchScreen({ papers, onOpenPaper }: { papers: UiPaper[]; onOpenPaper: (paperId: string) => void }) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("global");
  const [facets, setFacets] = useState(["passages", "abstracts", "notes"]);
  const results = useMemo(() => papers.filter((paper) => paperMatchesQuery(paper, query)).slice(0, 20), [papers, query]);
  const toggleFacet = (facet: string) => setFacets((current) => (current.includes(facet) ? current.filter((item) => item !== facet) : [...current, facet]));
  return (
    <div className="la-screen">
      <div className="la-searchwrap">
        <div className="la-searchinner">
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 18, color: "var(--text-muted)", font: "var(--text-label)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            <Icon name="search" size={15} color="var(--accent-soft)" />Search everything
          </div>
          <div className="la-searchbig">
            <Icon name="search" size={20} />
            <input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Search papers, passages, authors, tags, notes, evidence..." autoFocus />
            <kbd>Ctrl K</kbd>
          </div>
          <div className="la-scopes">
            {([
              ["global", "globe", "Global library"],
              ["project", "folder", "Current project"],
              ["paper", "file", "Current paper"],
              ["notes", "sticky-note", "Notes"],
              ["evidence", "quote", "Evidence"]
            ] as const).map(([key, scopeIcon, label]) => (
              <span key={key} className={`la-tag${scope === key ? " on" : ""}`} onClick={() => setScope(key)} style={{ padding: "5px 10px" }}>
                <Icon name={scopeIcon} size={12} />
                {label}
              </span>
            ))}
          </div>
          <div className="la-scopes" style={{ marginTop: 8 }}>
            <span style={{ font: "var(--text-caption)", color: "var(--text-muted)", alignSelf: "center", marginRight: 4 }}>in:</span>
            {["titles", "abstracts", "passages", "metadata", "authors", "tags", "notes", "outputs"].map((facet) => (
              <span key={facet} className={`la-tag${facets.includes(facet) ? " on" : ""}`} onClick={() => toggleFacet(facet)} style={{ padding: "4px 9px" }}>{facet}</span>
            ))}
          </div>
          <div className="la-resultcount">{results.length} results · {scope} · FTS index</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {results.map((paper) => (
              <div key={paper.id} className="la-result" onClick={() => onOpenPaper(paper.id)}>
                <div className="rtitle">{paper.title}</div>
                <div className="rmeta">
                  <Badge variant="outline">{paper.type}</Badge>
                  <span>{paper.firstAuthor} et al.</span>
                  <span className="mono">{paper.year ?? "n.d."}</span>
                  {paper.projectNames.map((project) => <span key={project} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Icon name="folder" size={11} color="var(--accent-soft)" />{project}</span>)}
                  <span className="spacer" style={{ flex: 1 }} />
                  <span style={{ font: "var(--text-caption)", color: "var(--text-muted)" }}>paper · metadata</span>
                </div>
                <div className="rmatch">{paper.abstract}</div>
                <div className="ractions">
                  <Btn variant="subtle" sm icon="book-open">Open</Btn>
                  <Btn variant="ghost" sm icon="quote">Cite</Btn>
                  <Btn variant="ghost" sm icon="bookmark">Save as evidence</Btn>
                </div>
              </div>
            ))}
            {!results.length ? <Empty icon="search-x" title="No results" desc="Try a broader query or rebuild the index." /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProviderCard({ provider, onUpdateProvider, onConnectProvider }: { provider: AgentProvider; onUpdateProvider: (providerId: string, patch: { enabled?: boolean; command?: string; defaultModel?: string | null; customModels?: string[] }) => void; onConnectProvider: (providerId: string) => void }) {
  const [open, setOpen] = useState(provider.id === "gemini" || provider.id === "claude");
  const [enabled, setEnabled] = useState(provider.enabled);
  const [command, setCommand] = useState(provider.command);
  const [defaultModel, setDefaultModel] = useState(provider.defaultModel ?? "");
  const statusKind = !provider.installed ? "err" : provider.connected || provider.authStatus === "authenticated" ? "ok" : "warn";
  const statusText = !provider.installed ? "Not installed" : provider.connected || provider.authStatus === "authenticated" ? "Connected" : "Auth required";
  useEffect(() => {
    setEnabled(provider.enabled);
    setCommand(provider.command);
    setDefaultModel(provider.defaultModel ?? "");
  }, [provider]);
  return (
    <div className="la-provider">
      <div className="phead">
        <div className="picon"><Icon name="terminal" size={19} /></div>
        <div className="pinfo">
          <div className="pname">
            {provider.label}
            <Badge variant={statusKind === "ok" ? "success" : statusKind === "warn" ? "warning" : "error"} dot={statusKind === "ok" ? "var(--state-success)" : statusKind === "warn" ? "var(--state-warning)" : "var(--state-error)"}>{statusText}</Badge>
            {!provider.installed ? <Badge variant="outline">missing</Badge> : null}
          </div>
          <div className="pstatus">
            <span><Icon name="git-branch" size={11} style={{ verticalAlign: "-2px", marginRight: 3 }} />v{provider.version ?? "unknown"}</span>
            <span className="mono">{provider.command}</span>
          </div>
        </div>
        <Toggle on={enabled} onClick={() => setEnabled((current) => !current)} />
        <button type="button" className="la-iconbtn" onClick={() => setOpen((current) => !current)} title="Configure"><Icon name={open ? "chevron-up" : "chevron-down"} size={16} /></button>
      </div>
      <div className={`pbody${open ? "" : " collapsed"}`}>
        <div className="la-fieldgroup">
          <label>Command path</label>
          <div className="la-field" style={{ padding: "7px 10px" }}><Icon name="terminal" size={14} /><input className="mono" value={command} onChange={(event) => setCommand(event.currentTarget.value)} style={{ fontSize: 12 }} /></div>
        </div>
        <div className="la-fieldgroup">
          <label>Default model</label>
          <div className="la-field" style={{ padding: "7px 10px" }}><Icon name="cpu" size={14} color="var(--accent-soft)" /><input className="mono" value={defaultModel} onChange={(event) => setDefaultModel(event.currentTarget.value)} placeholder="CLI default" style={{ fontSize: 12 }} /></div>
        </div>
        <div className="la-fieldgroup full">
          <label>Models</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {provider.models.length ? provider.models.map((model) => <span key={model} className="la-tag mono" style={{ fontSize: 11 }}>{model}<Icon name="x" size={11} className="x" /></span>) : <span style={{ font: "var(--text-caption)", color: "var(--text-muted)" }}>none configured</span>}
            <span className="la-tag"><Icon name="plus" size={11} />add model</span>
          </div>
        </div>
      </div>
      <div className="pfoot">
        <span style={{ display: "flex", alignItems: "center", gap: 6, font: "var(--text-caption)", color: "var(--text-muted)" }}>
          <Icon name="info" size={12} />{provider.connectCommand ?? "CLI provider harness"}
        </span>
        <span className="spacer" />
        <Btn variant="ghost" sm icon="refresh-cw" onClick={() => onUpdateProvider(provider.id, {})}>Refresh status</Btn>
        {provider.connected ? <Btn variant="ghost" sm icon="log-out">Disconnect</Btn> : <Btn variant="primary" sm icon="key-round" onClick={() => onConnectProvider(provider.id)}>Connect / Auth</Btn>}
        <Btn variant="deep" sm icon="save" onClick={() => onUpdateProvider(provider.id, { enabled, command, defaultModel: defaultModel.trim() || null })}>Save</Btn>
      </div>
    </div>
  );
}

function SettingsScreen({
  theme,
  setTheme,
  providers,
  selectedProviderId,
  selectedModel,
  onProviderChange,
  onModelChange,
  onUpdateProvider,
  onConnectProvider,
  status
}: {
  theme: string;
  setTheme: (theme: string) => void;
  providers: AgentProvider[];
  selectedProviderId: string;
  selectedModel: string | null;
  onProviderChange: (providerId: string) => void;
  onModelChange: (model: string | null) => void;
  onUpdateProvider: (providerId: string, patch: { enabled?: boolean; command?: string; defaultModel?: string | null; customModels?: string[] }) => void;
  onConnectProvider: (providerId: string) => void;
  status: AppStatus | null;
}) {
  const [section, setSection] = useState<SettingsSection>("providers");
  return (
    <div className="la-screen">
      <div className="la-settings">
        <div className="la-settingsinner">
          <div className="la-settingshead">
            <h1>Settings</h1>
            <p>Connect and configure agent providers, model defaults, and the local research repository.</p>
          </div>
          <div className="la-settingsnav">
            {[
              ["providers", "Providers"],
              ["defaults", "Defaults"],
              ["appearance", "Appearance"],
              ["storage", "Storage"],
              ["about", "About"]
            ].map(([key, label]) => <button key={key} type="button" className={section === key ? "on" : ""} onClick={() => setSection(key as SettingsSection)}>{label}</button>)}
          </div>
          {section === "providers" ? (
            <div className="fade-in">
              <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
                <div>
                  <div style={{ font: "var(--text-h3)", color: "var(--text-high)" }}>Agent providers</div>
                  <div style={{ font: "var(--text-caption)", color: "var(--text-muted)", marginTop: 2 }}>CLI agent harnesses used for document workflows and cited Q&A.</div>
                </div>
                <span style={{ flex: 1 }} />
                <Btn variant="ghost" sm icon="refresh-cw">Re-scan PATH</Btn>
              </div>
              {providers.map((provider) => <ProviderCard key={provider.id} provider={provider} onUpdateProvider={onUpdateProvider} onConnectProvider={onConnectProvider} />)}
            </div>
          ) : null}
          {section === "defaults" ? (
            <div className="fade-in">
              <div className="la-defaultcard">
                <div className="la-defaultrow">
                  <div className="dlabel"><div className="t">Default provider</div><div className="d">Used when a workflow does not specify one.</div></div>
                  <ModelPicker providers={providers} providerId={selectedProviderId} model={selectedModel} onProviderChange={onProviderChange} onModelChange={onModelChange} />
                </div>
                <div className="la-defaultrow"><div className="dlabel"><div className="t">Proposed changes require review</div><div className="d">Agent tags and metadata are staged as proposals, never auto-applied.</div></div><Toggle on={true} onClick={() => {}} /></div>
                <div className="la-defaultrow"><div className="dlabel"><div className="t">Refuse without evidence</div><div className="d">Q&A answers not found in selected sources when retrieval is empty.</div></div><Toggle on={true} onClick={() => {}} /></div>
              </div>
            </div>
          ) : null}
          {section === "appearance" ? (
            <div className="fade-in">
              <div className="la-defaultcard">
                <div className="la-defaultrow">
                  <div className="dlabel"><div className="t">Theme</div><div className="d">Comfy is the supplied color theme. Dark is near-black. Light is bright.</div></div>
                  <Seg options={[{ v: "comfy", label: "Comfy", icon: "moon-star" }, { v: "dark", label: "Dark", icon: "moon" }, { v: "light", label: "Light", icon: "sun" }]} value={theme as "comfy" | "dark" | "light"} onChange={setTheme} />
                </div>
              </div>
            </div>
          ) : null}
          {section === "storage" ? (
            <div className="fade-in">
              <div className="la-defaultcard">
                <div className="la-defaultrow"><div className="dlabel"><div className="t">Research repo</div><div className="d mono">{status?.repoRoot ?? "not loaded"}</div></div><Btn variant="ghost" sm icon="folder-open">Change...</Btn></div>
                <div className="la-defaultrow"><div className="dlabel"><div className="t">Git versioning</div><div className="d">PDFs, assets, Markdown, metadata and notes versioned.</div></div><Badge variant={status?.git.clean ? "success" : "warning"}>{status?.git.branch ?? "unknown"}</Badge></div>
                <div className="la-defaultrow"><div className="dlabel"><div className="t">Git LFS</div><div className="d">Large binaries tracked via LFS.</div></div><Badge variant={status?.git.lfsAvailable ? "success" : "warning"}>{status?.git.lfsAvailable ? "available" : "missing"}</Badge></div>
              </div>
            </div>
          ) : null}
          {section === "about" ? (
            <div className="fade-in">
              <div className="la-defaultcard">
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 44, height: 44, borderRadius: "var(--radius-md)", background: "linear-gradient(135deg, var(--accent-profile), var(--accent-primary))", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}><Icon name="book-open-check" size={22} /></div>
                  <div><div style={{ font: "var(--text-h2)", color: "var(--text-high)" }}>LitAgent</div><div className="mono" style={{ font: "var(--text-caption)", color: "var(--text-muted)" }}>local-first · web + desktop shell</div></div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PresetsScreen() {
  const presets = [
    ["Screening Preset", "list-checks", "Title/abstract screening with include, exclude, maybe and reasons tied to RQs.", "Claude Code", true],
    ["Relevance Tagging Preset", "tag", "Score papers against active project research questions and propose reviewable tags.", "Claude Code", true],
    ["Metadata Extraction Preset", "list", "Extract venue, year, DOI and authors from PDF and propose canonical metadata patches.", "Codex", true],
    ["Comparison Preset", "columns-3", "Build a comparison matrix across selected papers on method, dataset, metric and result.", "Claude Code", false],
    ["Synthesis Note Preset", "notebook-pen", "Draft a cited synthesis note for a research question from the evidence stack.", "Gemini CLI", false],
    ["Custom Command Preset", "square-terminal", "Wrap a shell agent harness with inputs, artifacts and evidence refs.", "Custom", false]
  ] as const;
  return (
    <div className="la-screen">
      <div className="la-presets">
        <div className="la-presetsinner">
          <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 4 }}>
            <h1 style={{ font: "var(--text-h1)", color: "var(--text-high)", margin: 0 }}>Presets</h1>
            <Badge variant="warning"><Icon name="flask-conical" size={11} />Experimental</Badge>
          </div>
          <p style={{ font: "var(--text-body-sm)", color: "var(--text-muted)", margin: "4px 0 22px" }}>Reusable workflow recipes and provider defaults. Apply a preset to any project to run a standard pipeline.</p>
          <div className="la-wipbanner"><Icon name="construction" size={18} /><div><div className="t">This area is a work in progress</div><div className="d">Presets are previewable but not yet runnable end-to-end.</div></div></div>
          <div className="la-presetgrid">
            {presets.map(([name, icon, desc, provider, enabled]) => (
              <div key={name} className={`la-presetcard${enabled ? "" : " disabled"}`}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div className="pc-icon"><Icon name={icon} size={18} /></div>
                  {enabled ? <Badge variant="accent" dot="var(--accent-bright)">ready</Badge> : <Badge variant="outline">draft</Badge>}
                </div>
                <div className="pc-name">{name}</div>
                <div className="pc-desc">{desc}</div>
                <div className="pc-foot"><span><Icon name="cpu" size={12} />{provider}</span></div>
                <div style={{ display: "flex", gap: 6, marginTop: 2 }}><Btn variant="subtle" sm icon="play" disabled={!enabled}>Apply</Btn><Btn variant="ghost" sm icon="pencil">Edit</Btn></div>
              </div>
            ))}
            <div className="la-presetcard" style={{ borderStyle: "dashed", alignItems: "center", justifyContent: "center", textAlign: "center", color: "var(--text-muted)", cursor: "pointer", minHeight: 180 }}>
              <div className="pc-icon"><Icon name="plus" size={18} /></div>
              <div className="pc-name" style={{ color: "var(--text-secondary)" }}>New preset</div>
              <div className="pc-desc" style={{ flex: "none" }}>Compose a custom recipe from workflow steps.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
