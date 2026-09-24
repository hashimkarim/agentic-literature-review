import type {
  AgentProvider,
  ComparisonArtifact,
  Collection,
  Paper,
  PaperProjectLink,
  Passage,
  Project,
  MetadataProposal,
  Manuscript, ManuscriptDocument, ManuscriptFile, ManuscriptHistoryEntry, WriteManuscriptFileRequest,
  QaResponse,
  QaThread,
  RelevanceProposal,
  ResearchFindingProposal,
  ResearchRecord,
  ReviewMetadataProposalRequest,
  ReviewComparisonArtifactRequest,
  ReviewResearchFindingProposalRequest,
  ReviewRelevanceProposalRequest,
  ReviewSynthesisArtifactRequest,
  CitationTarget,
  SearchResult,
  SynthesisArtifact,
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

export interface PdfInboxItem {
  sourcePath: string;
  relativePath: string;
  size: number;
  modifiedAt: string;
}

export interface PdfInboxAutomationRule {
  id: "pdf-inbox";
  enabled: boolean;
  eventTriggerEnabled: boolean;
  timerTriggerEnabled: boolean;
  intervalMinutes: number;
  sourceDir: string;
  force: boolean;
  projectId: string | null;
  knownKeys: string[];
  lastCheckedAt: string | null;
  lastRunAt: string | null;
  updatedAt: string;
}

export interface ConverterStatus {
  marker: {
    available: boolean;
    source: "env" | "bundled" | "uvx";
    command: string;
    displayCommand: string;
    message: string;
  };
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new ApiError(error.error ?? response.statusText, response.status, error.code);
  }
  return (await response.json()) as T;
}

export const api = {
  manuscripts: (projectId: string) => request<Manuscript[]>(`/api/projects/${encodeURIComponent(projectId)}/manuscripts`),
  createManuscript: (projectId: string, name: string) => request<ManuscriptDocument>(`/api/projects/${encodeURIComponent(projectId)}/manuscripts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }),
  manuscript: (projectId: string, id: string) => request<ManuscriptDocument>(`/api/projects/${encodeURIComponent(projectId)}/manuscripts/${encodeURIComponent(id)}`),
  writeManuscriptFile: (projectId: string, id: string, body: WriteManuscriptFileRequest) => request<ManuscriptFile>(`/api/projects/${encodeURIComponent(projectId)}/manuscripts/${encodeURIComponent(id)}/files`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  deleteManuscriptFile: (projectId: string, id: string, path: string, expectedRevision: string) => request<{ ok: true }>(`/api/projects/${encodeURIComponent(projectId)}/manuscripts/${encodeURIComponent(id)}/files`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, expectedRevision }) }),
  manuscriptHistory: (projectId: string, id: string, path: string) => request<ManuscriptHistoryEntry[]>(`/api/projects/${encodeURIComponent(projectId)}/manuscripts/${encodeURIComponent(id)}/history?path=${encodeURIComponent(path)}`),
  manuscriptVersion: (projectId: string, id: string, path: string, versionId: string) => request<ManuscriptFile>(`/api/projects/${encodeURIComponent(projectId)}/manuscripts/${encodeURIComponent(id)}/history/${encodeURIComponent(versionId)}?path=${encodeURIComponent(path)}`),
  manuscriptCheckpoint: (projectId: string, id: string, path: string, expectedRevision: string, label: string) => request<ManuscriptHistoryEntry>(`/api/projects/${encodeURIComponent(projectId)}/manuscripts/${encodeURIComponent(id)}/checkpoints`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, expectedRevision, label }) }),
  restoreManuscriptFile: (projectId: string, id: string, path: string, versionId: string, expectedRevision: string | null) => request<ManuscriptFile>(`/api/projects/${encodeURIComponent(projectId)}/manuscripts/${encodeURIComponent(id)}/restore`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, versionId, expectedRevision }) }),
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
  citationTarget: (paperId: string, passageId: string, projectId: string | null, expectedQuote: string, expectedMarkdownHash?: string | null) =>
    request<CitationTarget>(
      `/api/papers/${encodeURIComponent(paperId)}/passages/${encodeURIComponent(passageId)}/target${
        projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""
      }`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedQuote, expectedMarkdownHash }) }
    ),
  search: (body: { query: string; projectId: string | null; paperId?: string | null; limit?: number }) =>
    request<SearchResult[]>("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }),
  qa: (body: {
    question: string;
    threadRevision?: number;
    projectId: string | null;
    paperId?: string | null;
    paperIds?: string[];
    collectionId?: string | null;
    providerId?: string;
    model?: string | null;
  }) =>
    request<QaResponse>("/api/qa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }),
  qaThread: (body: { projectId: string | null; paperId?: string | null; paperIds?: string[]; collectionId?: string | null }) => {
    const params = new URLSearchParams();
    if (body.projectId) params.set("projectId", body.projectId);
    if (body.paperId) params.set("paperId", body.paperId);
    if (body.collectionId) params.set("collectionId", body.collectionId);
    if (body.paperIds?.length) params.set("paperIds", body.paperIds.join(","));
    const query = params.toString();
    return request<QaThread>(`/api/qa/thread${query ? `?${query}` : ""}`);
  },
  clearQaThread: (body: { projectId: string | null; paperId?: string | null; paperIds?: string[]; collectionId?: string | null; threadRevision?: number }) => {
    const params = new URLSearchParams();
    if (body.projectId) params.set("projectId", body.projectId);
    if (body.paperId) params.set("paperId", body.paperId);
    if (body.collectionId) params.set("collectionId", body.collectionId);
    if (body.paperIds?.length) params.set("paperIds", body.paperIds.join(","));
    if (body.threadRevision !== undefined) params.set("threadRevision", String(body.threadRevision));
    const query = params.toString();
    return request<QaThread>(`/api/qa/thread${query ? `?${query}` : ""}`, { method: "DELETE" });
  },
  relevanceProposals: (projectId: string, paperId?: string | null) =>
    request<RelevanceProposal[]>(
      `/api/projects/${encodeURIComponent(projectId)}/relevance-proposals${paperId ? `?paperId=${encodeURIComponent(paperId)}` : ""}`
    ),
  reviewRelevanceProposal: (projectId: string, proposalId: string, body: ReviewRelevanceProposalRequest) =>
    request<RelevanceProposal>(
      `/api/projects/${encodeURIComponent(projectId)}/relevance-proposals/${encodeURIComponent(proposalId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }
    ),
  metadataProposals: (paperId: string) =>
    request<MetadataProposal[]>(`/api/papers/${encodeURIComponent(paperId)}/metadata-proposals`),
  reviewMetadataProposal: (paperId: string, proposalId: string, body: ReviewMetadataProposalRequest) =>
    request<MetadataProposal>(
      `/api/papers/${encodeURIComponent(paperId)}/metadata-proposals/${encodeURIComponent(proposalId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }
    ),
  researchFindingProposals: (paperId: string, projectId?: string | null) =>
    request<ResearchFindingProposal[]>(
      `/api/papers/${encodeURIComponent(paperId)}/finding-proposals${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`
    ),
  researchRecords: (paperId: string, projectId?: string | null) =>
    request<ResearchRecord[]>(
      `/api/papers/${encodeURIComponent(paperId)}/findings${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`
    ),
  reviewResearchFindingProposal: (paperId: string, proposalId: string, body: ReviewResearchFindingProposalRequest) =>
    request<ResearchFindingProposal>(
      `/api/papers/${encodeURIComponent(paperId)}/finding-proposals/${encodeURIComponent(proposalId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }
    ),
  workflows: () => request<WorkflowRun[]>("/api/workflows"),
  comparisons: (projectId: string | null) =>
    request<ComparisonArtifact[]>(`/api/comparisons${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`),
  comparison: (comparisonId: string, projectId: string | null) =>
    request<ComparisonArtifact>(
      `/api/comparisons/${encodeURIComponent(comparisonId)}${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`
    ),
  reviewComparison: (comparisonId: string, projectId: string | null, body: ReviewComparisonArtifactRequest) =>
    request<ComparisonArtifact>(
      `/api/comparisons/${encodeURIComponent(comparisonId)}${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }
    ),
  syntheses: (projectId: string) => request<SynthesisArtifact[]>(`/api/projects/${encodeURIComponent(projectId)}/syntheses`),
  reviewSynthesis: (projectId: string, synthesisId: string, body: ReviewSynthesisArtifactRequest) =>
    request<SynthesisArtifact>(`/api/projects/${encodeURIComponent(projectId)}/syntheses/${encodeURIComponent(synthesisId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }),
  pdfInbox: (sourceDir = "pdfs") =>
    request<PdfInboxItem[]>(`/api/pdf-inbox?sourceDir=${encodeURIComponent(sourceDir)}`),
  pdfInboxAutomation: () => request<PdfInboxAutomationRule>("/api/workflow-automations/pdf-inbox"),
  updatePdfInboxAutomation: (body: Partial<Pick<PdfInboxAutomationRule, "enabled" | "eventTriggerEnabled" | "timerTriggerEnabled" | "intervalMinutes" | "sourceDir" | "force" | "projectId">>) =>
    request<PdfInboxAutomationRule>("/api/workflow-automations/pdf-inbox", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }),
  runPdfInboxAutomation: () =>
    request<{ runId: string | null; matched: number; reason: string }>("/api/workflow-automations/pdf-inbox/run", {
      method: "POST"
    }),
  startWorkflow: (body: {
    type: WorkflowType;
    projectId: string | null;
    paperIds?: string[];
    collectionIds?: string[];
    query?: string | null;
    options?: Record<string, unknown>;
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
  converterStatus: () => request<ConverterStatus>("/api/converter-status"),
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
