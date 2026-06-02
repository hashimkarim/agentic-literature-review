import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { AgentProvider, Passage, Project, QaResponse, WorkflowRun, WorkflowType } from "@litagent/contracts";
import { workflowLabels } from "@litagent/ui";

import { api, type AppStatus, type PaperEntry, type ProjectDetails } from "./api";
import { AgentPanel } from "./components/AgentPanel";
import { ConceptMap } from "./components/ConceptMap";
import { PaperList } from "./components/PaperList";
import { ProjectPanel } from "./components/ProjectPanel";
import { ReaderPanel } from "./components/ReaderPanel";
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
            providerId: providers.find((provider) => provider.installed)?.id ?? "local-heuristic"
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
    [activeNav, providers, searchQuery, selectedPaper, selectedProjectId]
  );

  const askQuestion = useCallback(
    (question: string) => {
      startTransition(() => {
        void api
          .qa({
            question,
            projectId: activeNav === "global" ? null : selectedProjectId,
            paperId: selectedPaper?.paper.id ?? null,
            providerId: providers.find((provider) => provider.installed)?.id ?? "local-heuristic"
          })
          .then(setQa);
      });
    },
    [activeNav, providers, selectedPaper, selectedProjectId]
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
    createdAt: run.createdAt
  }));

  const changeTheme = useCallback((nextTheme: ThemeMode) => {
    setTheme(nextTheme);
    window.localStorage.setItem("litagent-theme", nextTheme);
  }, []);

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
        <ProjectPanel
          activeNav={activeNav}
          project={currentProject}
          details={projectDetails}
          papers={papers}
          onProjectChange={setSelectedProjectId}
          projects={projects}
        />
        <main className="main-region">
          {activeNav === "concept" ? (
            <ConceptMap
              project={currentProject}
              papers={papers}
              selectedPaperId={selectedPaper?.paper.id ?? null}
              onSelectPaper={setSelectedPaperId}
            />
          ) : (
            <>
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
            </>
          )}
        </main>
        <AgentPanel
          project={currentProject}
          providers={providers}
          workflows={workflowCountByLabel}
          qa={qa}
          passages={passages}
          selectedPaper={selectedPaper}
          onRunWorkflow={runWorkflow}
          onAsk={askQuestion}
        />
      </div>
      <StatusBar status={status} project={currentProject} selectedPaper={selectedPaper} />
    </div>
  );
}
