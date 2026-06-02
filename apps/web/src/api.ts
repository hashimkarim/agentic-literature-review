import type {
  AgentProvider,
  Collection,
  Paper,
  PaperProjectLink,
  Passage,
  Project,
  QaResponse,
  SearchResult,
  WorkflowRun,
  WorkflowType
} from "@litagent/contracts";

export const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export interface PaperEntry {
  paper: Paper;
  link: PaperProjectLink | null;
}

export interface ProjectDetails {
  project: Project;
  collections: Collection[];
  links: PaperProjectLink[];
}

export interface AppStatus {
  repoRoot: string;
  projects: number;
  papers: number;
  git: {
    branch: string | null;
    clean: boolean;
    ahead: number;
    behind: number;
    gitAvailable: boolean;
    lfsAvailable: boolean;
  };
  providers: AgentProvider[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error ?? response.statusText);
  }
  return (await response.json()) as T;
}

export const api = {
  status: () => request<AppStatus>("/api/status"),
  projects: () => request<Project[]>("/api/projects"),
  project: (projectId: string) => request<ProjectDetails>(`/api/projects/${projectId}`),
  papers: (projectId: string | null) =>
    request<PaperEntry[]>(projectId ? `/api/papers?projectId=${encodeURIComponent(projectId)}` : "/api/papers"),
  markdown: async (paperId: string) => {
    const response = await fetch(`${API_BASE}/api/papers/${paperId}/markdown`);
    if (!response.ok) return null;
    return response.text();
  },
  passages: (paperId: string) => request<Passage[]>(`/api/papers/${paperId}/passages`),
  search: (body: { query: string; projectId: string | null; paperId?: string | null; limit?: number }) =>
    request<SearchResult[]>("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }),
  qa: (body: { question: string; projectId: string | null; paperId?: string | null; providerId?: string; model?: string | null }) =>
    request<QaResponse>("/api/qa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }),
  workflows: () => request<WorkflowRun[]>("/api/workflows"),
  startWorkflow: (body: {
    type: WorkflowType;
    projectId: string | null;
    paperIds?: string[];
    collectionIds?: string[];
    query?: string | null;
    providerId?: string;
    model?: string | null;
  }) =>
    request<WorkflowRun>("/api/workflows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }),
  workflow: (runId: string) => request<{ run: WorkflowRun; events: unknown[] }>(`/api/workflows/${runId}`),
  cancelWorkflow: (runId: string) =>
    request<WorkflowRun>(`/api/workflows/${runId}/cancel`, {
      method: "POST"
    }),
  convert: (paperId: string) =>
    request<{ status: string; message: string; passageCount: number }>(`/api/papers/${paperId}/convert`, {
      method: "POST"
    }),
  importPaper: (input: { file: File; projectId: string | null; title?: string }) => {
    const body = new FormData();
    body.set("file", input.file);
    if (input.projectId) body.set("projectId", input.projectId);
    body.set(
      "metadata",
      JSON.stringify({
        title: input.title ?? input.file.name.replace(/\.pdf$/i, ""),
        authors: []
      })
    );
    return request<PaperEntry>("/api/papers/import", { method: "POST", body });
  },
  exportBibUrl: (projectId: string) => `${API_BASE}/api/exports/${projectId}/bib`,
  providerStatus: () => request<AgentProvider[]>("/api/provider-status"),
  providerSettings: () => request<AgentProvider[]>("/api/settings/providers"),
  updateProviderSettings: (
    providerId: string,
    body: {
      enabled?: boolean;
      connected?: boolean;
      command?: string;
      defaultModel?: string | null;
      customModels?: string[];
    }
  ) =>
    request<AgentProvider[]>(`/api/settings/providers/${providerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }),
  connectProvider: (providerId: string) =>
    request<AgentProvider[]>(`/api/settings/providers/${providerId}/connect`, {
      method: "POST"
    })
};
