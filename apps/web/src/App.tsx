import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { AgentProvider, Passage, Project, QaResponse, WorkflowRun, WorkflowType } from "@litagent/contracts";
import { workflowLabels } from "@litagent/ui";

import { api, type AppStatus, type PaperEntry, type ProjectDetails } from "./api";
import { AgentPanel } from "./components/AgentPanel";
import { ConceptMap } from "./components/ConceptMap";
import { PaperList } from "./components/PaperList";
import { ProjectPanel } from "./components/ProjectPanel";
import { ReaderPanel } from "./components/ReaderPanel";
import { SettingsPage } from "./components/SettingsPage";
import { Sidebar, type NavKey } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { TopBar, type ThemeMode } from "./components/TopBar";

function initialTheme(): ThemeMode {
  const stored = window.localStorage.getItem("litagent-theme");
  return stored === "dark" || stored === "color" || stored === "light" ? stored : "dark";
}

export default function App() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectDetails, setProjectDetails] = useState<ProjectDetails | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [papers, setPapers] = useState<PaperEntry[]>([]);
  const [selectedPaperId, setSelectedPaperId] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [passages, setPassages] = useState<Passage[]>([]);
  const [qa, setQa] = useState<QaResponse | null>(null);
  const [workflows, setWorkflows] = useState<WorkflowRun[]>([]);
  const [providers, setProviders] = useState<AgentProvider[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState("local-heuristic");
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [activeNav, setActiveNav] = useState<NavKey>("projects");
  const [readerTab, setReaderTab] = useState<"pdf" | "markdown" | "notes">("markdown");
  const [searchQuery, setSearchQuery] = useState("");
  const [theme, setTheme] = useState<ThemeMode>(() => initialTheme());
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedPaper = useMemo(
    () => papers.find((entry) => entry.paper.id === selectedPaperId) ?? papers[0] ?? null,
    [papers, selectedPaperId]
  );

  const loadBase = useCallback(async () => {
    const [nextStatus, nextProjects, nextProviders, nextWorkflows] = await Promise.all([
      api.status(),
      api.projects(),
      api.providerStatus(),
      api.workflows()
    ]);
    setStatus(nextStatus);
    setProjects(nextProjects);
    setProviders(nextProviders);
    setWorkflows(nextWorkflows);
    setSelectedProjectId((current) => current ?? nextProjects[0]?.id ?? null);
  }, []);

  const loadProject = useCallback(async (projectId: string | null) => {
    const [details, nextPapers] = await Promise.all([
      projectId ? api.project(projectId) : Promise.resolve(null),
      api.papers(projectId)
    ]);
    setProjectDetails(details);
    setPapers(nextPapers);
    setSelectedPaperId((current) =>
      current && nextPapers.some((entry) => entry.paper.id === current) ? current : nextPapers[0]?.paper.id ?? null
    );
  }, []);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  useEffect(() => {
    const selectedProvider = providers.find((provider) => provider.id === selectedProviderId);
    if (selectedProviderId !== "local-heuristic" && (!selectedProvider || !selectedProvider.installed || !selectedProvider.enabled)) {
      const fallback = providers.find((provider) => provider.installed && provider.enabled);
      setSelectedProviderId(fallback?.id ?? "local-heuristic");
      setSelectedModel(fallback?.defaultModel ?? null);
      return;
    }
    if (selectedProvider && selectedModel === null && selectedProvider.defaultModel) {
      setSelectedModel(selectedProvider.defaultModel);
    }
  }, [providers, selectedModel, selectedProviderId]);

  useEffect(() => {
    if (!workflows.some((run) => run.status === "running" || run.status === "queued")) return;
    const timer = window.setInterval(() => {
      void api.workflows().then(setWorkflows);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [workflows]);

  useEffect(() => {
    void loadProject(activeNav === "global" ? null : selectedProjectId);
  }, [activeNav, loadProject, selectedProjectId]);

  useEffect(() => {
    if (!selectedPaper) {
      setMarkdown(null);
      setPassages([]);
      return;
    }
    void Promise.all([api.markdown(selectedPaper.paper.id), api.passages(selectedPaper.paper.id)]).then(
      ([nextMarkdown, nextPassages]) => {
        setMarkdown(nextMarkdown);
        setPassages(nextPassages);
      }
    );
  }, [selectedPaper]);

  const filteredPapers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return papers;
    return papers.filter(({ paper, link }) => {
      const haystack = [
        paper.title,
        paper.authors.join(" "),
        paper.tags.join(" "),
        link?.projectTags.join(" ") ?? ""
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [papers, searchQuery]);

  const runWorkflow = useCallback(
    (type: WorkflowType, query?: string) => {
      startTransition(() => {
        void api
          .startWorkflow({
            type,
            projectId: activeNav === "global" ? null : selectedProjectId,
            paperIds: selectedPaper ? [selectedPaper.paper.id] : [],
            query: (query ?? searchQuery) || null,
            providerId: selectedProviderId,
            model: selectedProviderId === "local-heuristic" ? null : selectedModel
          })
          .then(async () => {
            const [nextWorkflows, nextPapers] = await Promise.all([
              api.workflows(),
              api.papers(activeNav === "global" ? null : selectedProjectId)
            ]);
            setWorkflows(nextWorkflows);
            setPapers(nextPapers);
          });
      });
    },
    [activeNav, searchQuery, selectedModel, selectedPaper, selectedProjectId, selectedProviderId]
  );

  const askQuestion = useCallback(
    (question: string) => {
      startTransition(() => {
        void api
          .qa({
            question,
            projectId: activeNav === "global" ? null : selectedProjectId,
            paperId: selectedPaper?.paper.id ?? null,
            providerId: selectedProviderId,
            model: selectedProviderId === "local-heuristic" ? null : selectedModel
          })
          .then(setQa);
      });
    },
    [activeNav, selectedModel, selectedPaper, selectedProjectId, selectedProviderId]
  );

  const cancelWorkflow = useCallback((runId: string) => {
    startTransition(() => {
      void api.cancelWorkflow(runId).then(async () => {
        setWorkflows(await api.workflows());
      });
    });
  }, []);

  const connectProvider = useCallback(
    (providerId: string) => {
      startTransition(() => {
        void api.connectProvider(providerId).then((nextProviders) => {
          setProviders(nextProviders);
          const provider = nextProviders.find((candidate) => candidate.id === providerId);
          if (provider?.enabled && provider.installed) {
            setSelectedProviderId(providerId);
            setSelectedModel(provider.defaultModel ?? null);
          }
        });
      });
    },
    []
  );

  const saveProviderSettings = useCallback(
    (
      providerId: string,
      patch: {
        enabled?: boolean;
        command?: string;
        defaultModel?: string | null;
        customModels?: string[];
      }
    ) => {
      startTransition(() => {
        void api.updateProviderSettings(providerId, patch).then((nextProviders) => {
          setProviders(nextProviders);
          const provider = nextProviders.find((candidate) => candidate.id === providerId);
          if (providerId === selectedProviderId) setSelectedModel(provider?.defaultModel ?? null);
        });
      });
    },
    [selectedProviderId]
  );

  const convertSelected = useCallback(() => {
    if (!selectedPaper) return;
    startTransition(() => {
      void api.convert(selectedPaper.paper.id).then(async () => {
        const [nextMarkdown, nextPassages] = await Promise.all([
          api.markdown(selectedPaper.paper.id),
          api.passages(selectedPaper.paper.id)
        ]);
        setMarkdown(nextMarkdown);
        setPassages(nextPassages);
      });
    });
  }, [selectedPaper]);

  const importFile = useCallback(
    (file: File) => {
      startTransition(() => {
        void api.importPaper({ file, projectId: activeNav === "global" ? null : selectedProjectId }).then(async () => {
          await loadBase();
          await loadProject(activeNav === "global" ? null : selectedProjectId);
        });
      });
    },
    [activeNav, loadBase, loadProject, selectedProjectId]
  );

  const currentProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const workflowCountByLabel = workflows.slice(0, 6).map((run) => ({
    id: run.id,
    label: workflowLabels[run.type],
    status: run.status,
    createdAt: run.createdAt,
    providerId: run.providerId,
    model: run.model
  }));

  const changeTheme = useCallback((nextTheme: ThemeMode) => {
    setTheme(nextTheme);
    window.localStorage.setItem("litagent-theme", nextTheme);
  }, []);

  const changeProviderSelection = useCallback(
    (providerId: string) => {
      setSelectedProviderId(providerId);
      const provider = providers.find((candidate) => candidate.id === providerId);
      setSelectedModel(provider?.defaultModel ?? null);
    },
    [providers]
  );

  const researchWorkspace = (
    <section className="section-content research-section">
      <ProjectPanel
        activeNav={activeNav}
        project={currentProject}
        details={projectDetails}
        papers={papers}
        onProjectChange={setSelectedProjectId}
        projects={projects}
      />
      <main className="main-region">
        <PaperList
          papers={filteredPapers}
          selectedPaperId={selectedPaper?.paper.id ?? null}
          onSelectPaper={setSelectedPaperId}
          onConvertSelected={convertSelected}
        />
        <ReaderPanel
          paperEntry={selectedPaper}
          markdown={markdown}
          passages={passages}
          qa={qa}
          tab={readerTab}
          onTabChange={setReaderTab}
        />
      </main>
      <AgentPanel
        project={currentProject}
        providers={providers}
        workflows={workflowCountByLabel}
        qa={qa}
        passages={passages}
        selectedPaper={selectedPaper}
        selectedProviderId={selectedProviderId}
        selectedModel={selectedModel}
        onProviderChange={changeProviderSelection}
        onModelChange={setSelectedModel}
        onRunWorkflow={runWorkflow}
        onCancelWorkflow={cancelWorkflow}
        onAsk={askQuestion}
      />
    </section>
  );

  const settingsSection = (
    <section className="section-content single-section">
      <SettingsPage
        providers={providers}
        selectedProviderId={selectedProviderId}
        selectedModel={selectedModel}
        onProviderChange={changeProviderSelection}
        onModelChange={setSelectedModel}
        onConnectProvider={connectProvider}
        onSaveProvider={saveProviderSettings}
      />
    </section>
  );

  const workflowsSection = (
    <section className="section-content dashboard-section">
      <header className="section-header">
        <div>
          <h1>Workflows</h1>
          <p>Agentic and local workflow runs for the current workspace.</p>
        </div>
      </header>
      <div className="dashboard-list">
        {workflows.length ? (
          workflows.map((run) => (
            <article key={run.id} className="dashboard-row">
              <span>
                <b>{workflowLabels[run.type]}</b>
                <small>
                  {run.providerId}
                  {run.model ? ` / ${run.model}` : ""} · {new Date(run.createdAt).toLocaleString()}
                </small>
              </span>
              <span className="queue-actions">
                <em className={`status-${run.status}`}>{run.status}</em>
                {run.status === "running" || run.status === "queued" ? (
                  <button type="button" onClick={() => cancelWorkflow(run.id)}>
                    Cancel
                  </button>
                ) : null}
              </span>
            </article>
          ))
        ) : (
          <p className="empty-copy">No workflow runs yet.</p>
        )}
      </div>
    </section>
  );

  const notesSection = (
    <section className="section-content dashboard-section">
      <header className="section-header">
        <div>
          <h1>Notes</h1>
          <p>Project notes and generated outputs stay scoped to the selected project.</p>
        </div>
      </header>
      <div className="dashboard-grid">
        <article className="dashboard-card">
          <b>Project</b>
          <span>{currentProject?.name ?? "No project selected"}</span>
        </article>
        <article className="dashboard-card">
          <b>Linked Notes</b>
          <span>{projectDetails?.links.reduce((sum, link) => sum + link.notes.length, 0) ?? 0}</span>
        </article>
      </div>
    </section>
  );

  const exportsSection = (
    <section className="section-content dashboard-section">
      <header className="section-header">
        <div>
          <h1>Exports</h1>
          <p>BibTeX and bibliography outputs for the selected project.</p>
        </div>
      </header>
      {currentProject ? (
        <a className="export-link" href={api.exportBibUrl(currentProject.id)}>
          Download {currentProject.name} BibTeX
        </a>
      ) : (
        <p className="empty-copy">Select a project to export a bibliography.</p>
      )}
    </section>
  );

  const conceptSection = (
    <section className="section-content single-section">
      <ConceptMap
        project={currentProject}
        papers={papers}
        selectedPaperId={selectedPaper?.paper.id ?? null}
        onSelectPaper={setSelectedPaperId}
      />
    </section>
  );

  const activeSection =
    activeNav === "settings"
      ? settingsSection
      : activeNav === "concept"
        ? conceptSection
        : activeNav === "workflows"
          ? workflowsSection
          : activeNav === "notes"
            ? notesSection
            : activeNav === "exports"
              ? exportsSection
              : researchWorkspace;

  return (
    <div className="app-shell" data-theme={theme}>
      <input
        ref={fileInputRef}
        className="sr-only"
        type="file"
        accept="application/pdf"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) importFile(file);
          event.currentTarget.value = "";
        }}
      />
      <TopBar
        projects={projects}
        selectedProjectId={selectedProjectId}
        onProjectChange={setSelectedProjectId}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onImport={() => fileInputRef.current?.click()}
        onNewNote={() => setReaderTab("notes")}
        onSettings={() => setActiveNav("settings")}
        busy={isPending}
        theme={theme}
        onThemeChange={changeTheme}
      />
      <div className="workspace">
        <Sidebar
          active={activeNav}
          onChange={setActiveNav}
          projectsCount={projects.length}
          notesCount={projectDetails?.links.reduce((sum, link) => sum + link.notes.length, 0) ?? 0}
        />
        {activeSection}
      </div>
      <StatusBar status={status} project={currentProject} selectedPaper={selectedPaper} />
    </div>
  );
}
