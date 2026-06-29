import { z } from "zod";

export const isoDateSchema = z.string().datetime();

export const ResearchQuestionSchema = z.object({
  id: z.string(),
  text: z.string().min(1),
  inclusionCriteria: z.array(z.string()).default([]),
  exclusionCriteria: z.array(z.string()).default([]),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});
export type ResearchQuestion = z.infer<typeof ResearchQuestionSchema>;

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  description: z.string().default(""),
  defaultProvider: z.string().default("codex"),
  researchQuestions: z.array(ResearchQuestionSchema).default([]),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});
export type Project = z.infer<typeof ProjectSchema>;

export const CollectionSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string().min(1),
  parentId: z.string().nullable().default(null),
  filters: z.record(z.string(), z.unknown()).default({}),
  paperIds: z.array(z.string()).default([]),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});
export type Collection = z.infer<typeof CollectionSchema>;

export const PaperSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  authors: z.array(z.string()).default([]),
  year: z.number().int().nullable().default(null),
  doi: z.string().nullable().default(null),
  arxivId: z.string().nullable().default(null),
  zoteroKey: z.string().nullable().default(null),
  tags: z.array(z.string()).default([]),
  filePaths: z.object({
    pdf: z.string().nullable().default(null),
    markdown: z.string().nullable().default(null),
    assets: z.string().nullable().default(null)
  }),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});
export type Paper = z.infer<typeof PaperSchema>;

export const RelevanceStateSchema = z.enum([
  "unreviewed",
  "included",
  "excluded",
  "maybe",
  "not_found"
]);
export type RelevanceState = z.infer<typeof RelevanceStateSchema>;

export const PaperProjectLinkSchema = z.object({
  paperId: z.string(),
  projectId: z.string(),
  subcollectionIds: z.array(z.string()).default([]),
  projectTags: z.array(z.string()).default([]),
  relevanceState: RelevanceStateSchema.default("unreviewed"),
  notes: z.array(z.string()).default([]),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});
export type PaperProjectLink = z.infer<typeof PaperProjectLinkSchema>;

export const PdfRectSchema = z.object({
  page: z.number().int().positive(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number()
});
export type PdfRect = z.infer<typeof PdfRectSchema>;

export const PassageSchema = z.object({
  id: z.string(),
  paperId: z.string(),
  page: z.number().int().positive().nullable().default(null),
  section: z.string().default(""),
  markdownStart: z.number().int().nonnegative().nullable().default(null),
  markdownEnd: z.number().int().nonnegative().nullable().default(null),
  quote: z.string(),
  rects: z.array(PdfRectSchema).default([])
});
export type Passage = z.infer<typeof PassageSchema>;

export const AnnotationSchema = z.object({
  id: z.string(),
  paperId: z.string(),
  projectId: z.string(),
  page: z.number().int().positive(),
  rects: z.array(PdfRectSchema).default([]),
  quote: z.string().default(""),
  color: z.string().default("yellow"),
  noteId: z.string().nullable().default(null),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});
export type Annotation = z.infer<typeof AnnotationSchema>;

export const NoteSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string().min(1),
  path: z.string(),
  paperId: z.string().nullable().default(null),
  passageIds: z.array(z.string()).default([]),
  annotationIds: z.array(z.string()).default([]),
  workflowRunIds: z.array(z.string()).default([]),
  researchQuestionIds: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});
export type Note = z.infer<typeof NoteSchema>;

export const NoteWithContentSchema = NoteSchema.extend({
  content: z.string().default("")
});
export type NoteWithContent = z.infer<typeof NoteWithContentSchema>;

export const WorkflowTypeSchema = z.enum([
  "pdf-markdown-processing",
  "markdown-refinement",
  "relevance-tagging",
  "metadata-extraction",
  "key-findings",
  "compare-papers",
  "ask-with-citations",
  "find-papers",
  "synthesis-note",
  "bib-export",
  "contradiction-finder",
  "screening",
  "dataset-method-extractor",
  "reproducibility-checklist",
  "citation-needed"
]);
export type WorkflowType = z.infer<typeof WorkflowTypeSchema>;

export const WorkflowStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled"
]);
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;

export const WorkflowRunSchema = z.object({
  id: z.string(),
  type: WorkflowTypeSchema,
  projectId: z.string().nullable().default(null),
  scope: z.object({
    paperIds: z.array(z.string()).default([]),
    collectionIds: z.array(z.string()).default([]),
    query: z.string().nullable().default(null),
    options: z.record(z.string(), z.unknown()).default({})
  }),
  providerId: z.string().default("local-heuristic"),
  model: z.string().nullable().default(null),
  status: WorkflowStatusSchema,
  eventsPath: z.string(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});
export type WorkflowRun = z.infer<typeof WorkflowRunSchema>;

export const EvidenceRefSchema = z.object({
  paperId: z.string(),
  passageId: z.string(),
  page: z.number().int().positive().nullable().default(null),
  quote: z.string(),
  confidence: z.number().min(0).max(1)
});
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

export const CitationRectSourceSchema = z.enum(["passage", "annotation", "none"]);
export type CitationRectSource = z.infer<typeof CitationRectSourceSchema>;

export const CitationTargetSchema = z.object({
  paperId: z.string(),
  passageId: z.string(),
  projectId: z.string().nullable().default(null),
  paperTitle: z.string(),
  quote: z.string(),
  page: z.number().int().positive().nullable().default(null),
  section: z.string().default(""),
  pdf: z.object({
    available: z.boolean(),
    path: z.string().nullable().default(null),
    url: z.string().nullable().default(null),
    page: z.number().int().positive().nullable().default(null),
    rects: z.array(PdfRectSchema).default([]),
    rectSource: CitationRectSourceSchema.default("none")
  }),
  markdown: z.object({
    available: z.boolean(),
    path: z.string().nullable().default(null),
    url: z.string().nullable().default(null),
    section: z.string().default(""),
    startLine: z.number().int().positive().nullable().default(null),
    endLine: z.number().int().positive().nullable().default(null)
  }),
  annotations: z.array(AnnotationSchema).default([])
});
export type CitationTarget = z.infer<typeof CitationTargetSchema>;

export const CitationTargetRequestSchema = z.object({
  paperId: z.string(),
  passageId: z.string(),
  projectId: z.string().nullable().default(null)
});
export type CitationTargetRequest = z.infer<typeof CitationTargetRequestSchema>;
export type CitationTargetRequestInput = z.input<typeof CitationTargetRequestSchema>;

export const AgentProviderSchema = z.object({
  id: z.string(),
  label: z.string(),
  command: z.string(),
  installed: z.boolean(),
  enabled: z.boolean().default(false),
  connected: z.boolean().default(false),
  authStatus: z.enum(["unknown", "authenticated", "unauthenticated", "unavailable"]),
  version: z.string().nullable().default(null),
  capabilities: z.array(z.string()).default([]),
  defaultModel: z.string().nullable().default(null),
  models: z.array(z.string()).default([]),
  customModels: z.array(z.string()).default([]),
  lastCheckedAt: isoDateSchema.nullable().default(null),
  connectCommand: z.string().nullable().default(null)
});
export type AgentProvider = z.infer<typeof AgentProviderSchema>;

export const AgentProviderSettingsSchema = z.object({
  providerId: z.string(),
  enabled: z.boolean().default(false),
  connected: z.boolean().default(false),
  command: z.string().default(""),
  defaultModel: z.string().nullable().default(null),
  customModels: z.array(z.string()).default([]),
  lastCheckedAt: isoDateSchema.nullable().default(null),
  updatedAt: isoDateSchema
});
export type AgentProviderSettings = z.infer<typeof AgentProviderSettingsSchema>;

export const AgentProviderSettingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  connected: z.boolean().optional(),
  command: z.string().optional(),
  defaultModel: z.string().nullable().optional(),
  customModels: z.array(z.string()).optional()
});
export type AgentProviderSettingsPatch = z.infer<typeof AgentProviderSettingsPatchSchema>;

export const RunEventTypeSchema = z.enum([
  "run.started",
  "model.delta",
  "tool.call",
  "tool.result",
  "evidence.found",
  "artifact.written",
  "run.failed",
  "run.completed"
]);
export type RunEventType = z.infer<typeof RunEventTypeSchema>;

export const NormalizedRunEventSchema = z.object({
  id: z.string(),
  runId: z.string(),
  type: RunEventTypeSchema,
  timestamp: isoDateSchema,
  providerId: z.string(),
  message: z.string().default(""),
  payload: z.record(z.string(), z.unknown()).default({})
});
export type NormalizedRunEvent = z.infer<typeof NormalizedRunEventSchema>;

export const SearchRequestSchema = z.object({
  query: z.string().default(""),
  projectId: z.string().nullable().default(null),
  paperId: z.string().nullable().default(null),
  limit: z.number().int().positive().max(50).default(12)
});
export type SearchRequest = z.infer<typeof SearchRequestSchema>;
export type SearchRequestInput = z.input<typeof SearchRequestSchema>;

export const SearchResultSchema = z.object({
  paper: PaperSchema,
  passage: PassageSchema.nullable().default(null),
  link: PaperProjectLinkSchema.nullable().default(null),
  score: z.number().default(0)
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

export const QaRequestSchema = z.object({
  question: z.string().min(1),
  projectId: z.string().nullable().default(null),
  paperId: z.string().nullable().default(null),
  collectionId: z.string().nullable().default(null),
  providerId: z.string().default("local-heuristic"),
  model: z.string().nullable().default(null)
});
export type QaRequest = z.infer<typeof QaRequestSchema>;
export type QaRequestInput = z.input<typeof QaRequestSchema>;

export const QaResponseSchema = z.object({
  answer: z.string(),
  evidence: z.array(EvidenceRefSchema),
  runId: z.string().nullable().default(null)
});
export type QaResponse = z.infer<typeof QaResponseSchema>;

export const ImportPaperRequestSchema = z.object({
  sourcePath: z.string().optional(),
  projectId: z.string().nullable().default(null),
  subcollectionIds: z.array(z.string()).default([]),
  projectTags: z.array(z.string()).default([]),
  metadata: PaperSchema.partial().extend({
    title: z.string().optional(),
    authors: z.array(z.string()).optional()
  }).default({})
});
export type ImportPaperRequest = z.infer<typeof ImportPaperRequestSchema>;
export type ImportPaperRequestInput = z.input<typeof ImportPaperRequestSchema>;

export const LinkPaperRequestSchema = z.object({
  projectId: z.string(),
  subcollectionIds: z.array(z.string()).default([]),
  projectTags: z.array(z.string()).default([]),
  relevanceState: RelevanceStateSchema.default("unreviewed")
});
export type LinkPaperRequest = z.infer<typeof LinkPaperRequestSchema>;
export type LinkPaperRequestInput = z.input<typeof LinkPaperRequestSchema>;

export const CreateNoteRequestSchema = z.object({
  title: z.string().min(1).default("Untitled note"),
  content: z.string().default(""),
  paperId: z.string().nullable().default(null),
  passageIds: z.array(z.string()).default([]),
  annotationIds: z.array(z.string()).default([]),
  workflowRunIds: z.array(z.string()).default([]),
  researchQuestionIds: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([])
});
export type CreateNoteRequest = z.infer<typeof CreateNoteRequestSchema>;
export type CreateNoteRequestInput = z.input<typeof CreateNoteRequestSchema>;

export const UpdateNoteRequestSchema = z.object({
  title: z.string().min(1).optional(),
  content: z.string().optional(),
  paperId: z.string().nullable().optional(),
  passageIds: z.array(z.string()).optional(),
  annotationIds: z.array(z.string()).optional(),
  workflowRunIds: z.array(z.string()).optional(),
  researchQuestionIds: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional()
});
export type UpdateNoteRequest = z.infer<typeof UpdateNoteRequestSchema>;
export type UpdateNoteRequestInput = z.input<typeof UpdateNoteRequestSchema>;

export const CreateAnnotationRequestSchema = z.object({
  projectId: z.string(),
  paperId: z.string(),
  page: z.number().int().positive(),
  rects: z.array(PdfRectSchema).default([]),
  quote: z.string().default(""),
  color: z.string().default("yellow"),
  noteId: z.string().nullable().default(null)
});
export type CreateAnnotationRequest = z.infer<typeof CreateAnnotationRequestSchema>;
export type CreateAnnotationRequestInput = z.input<typeof CreateAnnotationRequestSchema>;

export const UpdateAnnotationRequestSchema = z.object({
  page: z.number().int().positive().optional(),
  rects: z.array(PdfRectSchema).optional(),
  quote: z.string().optional(),
  color: z.string().optional(),
  noteId: z.string().nullable().optional()
});
export type UpdateAnnotationRequest = z.infer<typeof UpdateAnnotationRequestSchema>;
export type UpdateAnnotationRequestInput = z.input<typeof UpdateAnnotationRequestSchema>;
