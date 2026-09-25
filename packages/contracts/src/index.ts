import { z } from "zod";
export * from "./local-import";
export * from "./manuscripts";
export * from "./manuscript-comments";
export * from "./writing-candidates";

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
  markdownHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
  paperId: z.string(),
  passageId: z.string(),
  page: z.number().int().positive().nullable().default(null),
  paperTitle: z.string().default(""),
  section: z.string().default(""),
  quote: z.string(),
  confidence: z.number().min(0).max(1).nullable()
});
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

export const ProposalReviewStatusSchema = z.enum(["pending", "accepted", "rejected"]);
export type ProposalReviewStatus = z.infer<typeof ProposalReviewStatusSchema>;

export const ProposedRelevanceStateSchema = z.enum(["included", "excluded", "maybe", "not_found"]);
export type ProposedRelevanceState = z.infer<typeof ProposedRelevanceStateSchema>;

export const RelevanceProposalSchema = z.object({
  id: z.string(),
  runId: z.string(),
  projectId: z.string(),
  paperId: z.string(),
  researchQuestionId: z.string().nullable().default(null),
  question: z.string().min(1),
  proposedState: ProposedRelevanceStateSchema,
  relevanceScore: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
  projectTags: z.array(z.string()).default([]),
  evidence: z.array(EvidenceRefSchema).default([]),
  providerId: z.string(),
  model: z.string().nullable().default(null),
  status: ProposalReviewStatusSchema.default("pending"),
  reviewedAt: isoDateSchema.nullable().default(null),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});
export type RelevanceProposal = z.infer<typeof RelevanceProposalSchema>;

export const ReviewRelevanceProposalRequestSchema = z.object({
  decision: z.enum(["accepted", "rejected"]),
  proposedState: ProposedRelevanceStateSchema.optional(),
  rationale: z.string().min(1).optional(),
  projectTags: z.array(z.string()).optional()
});
export type ReviewRelevanceProposalRequest = z.infer<typeof ReviewRelevanceProposalRequestSchema>;
export type ReviewRelevanceProposalRequestInput = z.input<typeof ReviewRelevanceProposalRequestSchema>;

export const MetadataFieldNameSchema = z.enum(["title", "authors", "year", "doi", "arxivId", "zoteroKey", "tags"]);
export type MetadataFieldName = z.infer<typeof MetadataFieldNameSchema>;

export const MetadataFieldValueSchema = z.union([z.string(), z.number().int(), z.array(z.string()), z.null()]);
export type MetadataFieldValue = z.infer<typeof MetadataFieldValueSchema>;

export const MetadataFieldProposalSchema = z.object({
  field: MetadataFieldNameSchema,
  currentValue: MetadataFieldValueSchema,
  proposedValue: MetadataFieldValueSchema,
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
  evidence: z.array(EvidenceRefSchema).default([])
});
export type MetadataFieldProposal = z.infer<typeof MetadataFieldProposalSchema>;

export const MetadataProposalSchema = z.object({
  id: z.string(),
  runId: z.string(),
  projectId: z.string().nullable().default(null),
  paperId: z.string(),
  fields: z.array(MetadataFieldProposalSchema).min(1),
  providerId: z.string(),
  model: z.string().nullable().default(null),
  status: ProposalReviewStatusSchema.default("pending"),
  appliedFields: z.array(MetadataFieldNameSchema).default([]),
  reviewedAt: isoDateSchema.nullable().default(null),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});
export type MetadataProposal = z.infer<typeof MetadataProposalSchema>;

export const ReviewMetadataProposalRequestSchema = z.object({
  decision: z.enum(["accepted", "rejected"]),
  acceptedFields: z.array(MetadataFieldNameSchema).optional(),
  edits: z.partialRecord(MetadataFieldNameSchema, MetadataFieldValueSchema).default({})
});
export type ReviewMetadataProposalRequest = z.infer<typeof ReviewMetadataProposalRequestSchema>;
export type ReviewMetadataProposalRequestInput = z.input<typeof ReviewMetadataProposalRequestSchema>;

export const ResearchRecordKindSchema = z.enum([
  "finding",
  "method",
  "dataset",
  "result",
  "limitation",
  "reproducibility"
]);
export type ResearchRecordKind = z.infer<typeof ResearchRecordKindSchema>;

export const ResearchAttributeValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.null()
]);
export type ResearchAttributeValue = z.infer<typeof ResearchAttributeValueSchema>;

export const ResearchItemSchema = z.object({
  id: z.string(),
  kind: ResearchRecordKindSchema,
  title: z.string().min(1),
  content: z.string().min(1),
  attributes: z.record(z.string(), ResearchAttributeValueSchema).default({}),
  confidence: z.number().min(0).max(1),
  evidence: z.array(EvidenceRefSchema).min(1)
});
export type ResearchItem = z.infer<typeof ResearchItemSchema>;

export const ResearchFindingProposalSchema = z.object({
  id: z.string(),
  runId: z.string(),
  projectId: z.string().nullable().default(null),
  paperId: z.string(),
  items: z.array(ResearchItemSchema).min(1),
  providerId: z.string(),
  model: z.string().nullable().default(null),
  status: ProposalReviewStatusSchema.default("pending"),
  acceptedItemIds: z.array(z.string()).default([]),
  reviewedAt: isoDateSchema.nullable().default(null),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});
export type ResearchFindingProposal = z.infer<typeof ResearchFindingProposalSchema>;

export const ResearchRecordSchema = ResearchItemSchema.extend({
  paperId: z.string(),
  projectId: z.string().nullable().default(null),
  sourceRunId: z.string(),
  sourceProposalId: z.string(),
  sourceItemId: z.string(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});
export type ResearchRecord = z.infer<typeof ResearchRecordSchema>;

export const ComparisonCellStatusSchema = z.enum(["supported", "not_found"]);
export type ComparisonCellStatus = z.infer<typeof ComparisonCellStatusSchema>;

export const ComparisonCellSchema = z.object({
  paperId: z.string(),
  status: ComparisonCellStatusSchema,
  summary: z.string().min(1),
  recordIds: z.array(z.string()).default([]),
  evidence: z.array(EvidenceRefSchema).default([])
});
export type ComparisonCell = z.infer<typeof ComparisonCellSchema>;

export const ComparisonRowSchema = z.object({
  kind: ResearchRecordKindSchema,
  label: z.string().min(1),
  cells: z.array(ComparisonCellSchema).min(2)
});
export type ComparisonRow = z.infer<typeof ComparisonRowSchema>;

export const ComparisonArtifactStatusSchema = z.enum(["draft", "accepted", "rejected"]);
export type ComparisonArtifactStatus = z.infer<typeof ComparisonArtifactStatusSchema>;

export const ComparisonArtifactSchema = z.object({
  id: z.string(),
  runId: z.string(),
  projectId: z.string().nullable().default(null),
  title: z.string().min(1),
  summary: z.string().default(""),
  query: z.string().nullable().default(null),
  paperIds: z.array(z.string()).min(2),
  rows: z.array(ComparisonRowSchema).min(1),
  providerId: z.string(),
  model: z.string().nullable().default(null),
  status: ComparisonArtifactStatusSchema.default("draft"),
  outputPath: z.string(),
  reviewedAt: isoDateSchema.nullable().default(null),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});
export type ComparisonArtifact = z.infer<typeof ComparisonArtifactSchema>;

export const ReviewComparisonArtifactRequestSchema = z.object({
  decision: z.enum(["accepted", "rejected"]),
  title: z.string().min(1).optional(),
  summary: z.string().optional(),
  cellSummaries: z.record(z.string(), z.string().min(1)).default({})
});
export type ReviewComparisonArtifactRequest = z.infer<typeof ReviewComparisonArtifactRequestSchema>;
export type ReviewComparisonArtifactRequestInput = z.input<typeof ReviewComparisonArtifactRequestSchema>;

export const SynthesisClaimSchema = z.object({
  id: z.string(),
  text: z.string().min(1),
  recordIds: z.array(z.string()).min(1),
  evidence: z.array(EvidenceRefSchema).min(1)
});
export type SynthesisClaim = z.infer<typeof SynthesisClaimSchema>;

export const SynthesisSectionSchema = z.object({
  heading: z.string().min(1),
  claims: z.array(SynthesisClaimSchema).min(1)
});
export type SynthesisSection = z.infer<typeof SynthesisSectionSchema>;

export const SynthesisArtifactSchema = z.object({
  id: z.string(),
  runId: z.string(),
  projectId: z.string(),
  comparisonId: z.string(),
  title: z.string().min(1),
  summary: z.string().default(""),
  sections: z.array(SynthesisSectionSchema).min(1),
  providerId: z.string(),
  model: z.string().nullable().default(null),
  status: ComparisonArtifactStatusSchema.default("draft"),
  noteId: z.string().nullable().default(null),
  outputPath: z.string(),
  reviewedAt: isoDateSchema.nullable().default(null),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});
export type SynthesisArtifact = z.infer<typeof SynthesisArtifactSchema>;

export const ReviewSynthesisArtifactRequestSchema = z.object({
  decision: z.enum(["accepted", "rejected"]),
  title: z.string().min(1).optional(),
  summary: z.string().optional(),
  claimTexts: z.record(z.string(), z.string().min(1)).default({})
});
export type ReviewSynthesisArtifactRequest = z.infer<typeof ReviewSynthesisArtifactRequestSchema>;
export type ReviewSynthesisArtifactRequestInput = z.input<typeof ReviewSynthesisArtifactRequestSchema>;

export const ResearchItemEditSchema = z.object({
  kind: ResearchRecordKindSchema.optional(),
  title: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  attributes: z.record(z.string(), ResearchAttributeValueSchema).optional()
});

export const ReviewResearchFindingProposalRequestSchema = z.object({
  decision: z.enum(["accepted", "rejected"]),
  acceptedItemIds: z.array(z.string()).optional(),
  edits: z.record(z.string(), ResearchItemEditSchema).default({})
});
export type ReviewResearchFindingProposalRequest = z.infer<typeof ReviewResearchFindingProposalRequestSchema>;
export type ReviewResearchFindingProposalRequestInput = z.input<typeof ReviewResearchFindingProposalRequestSchema>;

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
  expectedQuote: z.string().optional(),
  expectedMarkdownHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
  paperId: z.string(),
  passageId: z.string(),
  projectId: z.string().nullable().default(null)
});
export type CitationTargetRequest = z.infer<typeof CitationTargetRequestSchema>;
export type CitationTargetRequestInput = z.input<typeof CitationTargetRequestSchema>;

export const DriverConnectionSchema = z.object({
  configured: z.boolean(),
  endpoint: z.string().nullable(),
  status: z.enum(["unconfigured", "ready", "error"]),
  code: z.string(),
  message: z.string(),
  checkedAt: isoDateSchema.nullable(),
  refreshing: z.boolean()
});
export type DriverConnection = z.infer<typeof DriverConnectionSchema>;

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
  connectCommand: z.string().nullable().default(null),
  driver: z.object({
    instanceId: z.string(),
    vendor: z.string(),
    authMode: z.enum(["api-key", "cli-session", "none", "unknown"]),
    available: z.boolean(),
    restrictedModels: z.boolean(),
    healthCode: z.string(),
    message: z.string(),
    accountLabel: z.string(),
    iconText: z.string()
  }).optional()
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
  "run.progress",
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
  paperIds: z.array(z.string()).default([]),
  collectionId: z.string().nullable().default(null),
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
  threadRevision: z.number().int().nonnegative().optional(),
  projectId: z.string().nullable().default(null),
  paperId: z.string().nullable().default(null),
  paperIds: z.array(z.string()).default([]),
  collectionId: z.string().nullable().default(null),
  providerId: z.string().default("local-heuristic"),
  model: z.string().nullable().default(null)
});
export type QaRequest = z.infer<typeof QaRequestSchema>;
export type QaRequestInput = z.input<typeof QaRequestSchema>;

export const QaStatusSchema = z.enum(["answered", "not_found"]);
export type QaStatus = z.infer<typeof QaStatusSchema>;

export const QaScopeSchema = z.object({
  type: z.enum(["global", "project", "collection", "paper", "selection"]).default("global"),
  projectId: z.string().nullable().default(null),
  collectionId: z.string().nullable().default(null),
  paperId: z.string().nullable().default(null),
  paperIds: z.array(z.string()).default([]),
  paperCount: z.number().int().nonnegative().default(0),
  passageCount: z.number().int().nonnegative().default(0)
});
export type QaScope = z.infer<typeof QaScopeSchema>;

export const QaContextSourceSchema = z.object({
  paperId: z.string(),
  paperTitle: z.string(),
  markdownHash: z.string().nullable(),
  totalChars: z.number().int().nonnegative(),
  includedChars: z.number().int().nonnegative(),
  totalPassages: z.number().int().nonnegative(),
  includedPassages: z.number().int().nonnegative(),
  coverage: z.enum(["full", "truncated", "omitted", "missing", "placeholder"]),
  readiness: z.enum(["missing", "placeholder", "limited", "ready"])
});
export type QaContextSource = z.infer<typeof QaContextSourceSchema>;

export const QaDiagnosticsSchema = z.object({
  retrievedCount: z.number().int().nonnegative().default(0),
  evidenceCount: z.number().int().nonnegative().default(0),
  providerId: z.string().default("local-heuristic"),
  model: z.string().nullable().default(null),
  contextMode: z.enum(["passage-search", "markdown-context"]).default("passage-search"),
  contextChars: z.number().int().nonnegative().default(0),
  sources: z.array(QaContextSourceSchema).default([]),
  evidenceMode: z.enum(["passage-search", "provider-passages", "claim-match"]).default("passage-search"),
  evidenceVersion: z.number().int().positive().default(1),
  validation: z.object({
    method: z.literal("provider-review"),
    attempts: z.number().int().min(1).max(2),
    reason: z.string(),
    claims: z.array(z.object({
      index: z.number().int().nonnegative(),
      supported: z.boolean(),
      reason: z.string()
    }))
  }).nullable().default(null),
  message: z.string().default("")
});
export type QaDiagnostics = z.infer<typeof QaDiagnosticsSchema>;

export const QaResponseSchema = z.object({
  answer: z.string(),
  evidence: z.array(EvidenceRefSchema),
  runId: z.string().nullable().default(null),
  threadId: z.string().nullable().default(null),
  threadRevision: z.number().int().nonnegative().nullable().default(null),
  messageId: z.string().nullable().default(null),
  question: z.string().default(""),
  status: QaStatusSchema.default("answered"),
  scope: QaScopeSchema.default({
    type: "global",
    projectId: null,
    collectionId: null,
    paperId: null,
    paperIds: [],
    paperCount: 0,
    passageCount: 0
  }),
  diagnostics: QaDiagnosticsSchema.default(() => QaDiagnosticsSchema.parse({}))
});
export type QaResponse = z.infer<typeof QaResponseSchema>;

export const QaThreadRequestSchema = z.object({
  projectId: z.string().nullable().default(null),
  paperId: z.string().nullable().default(null),
  paperIds: z.array(z.string()).default([]),
  collectionId: z.string().nullable().default(null)
});
export type QaThreadRequest = z.infer<typeof QaThreadRequestSchema>;
export type QaThreadRequestInput = z.input<typeof QaThreadRequestSchema>;

export const ClearQaThreadRequestSchema = QaThreadRequestSchema.extend({
  threadRevision: z.number().int().nonnegative().optional()
});
export type ClearQaThreadRequestInput = z.input<typeof ClearQaThreadRequestSchema>;

export const QaThreadMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  createdAt: isoDateSchema,
  response: QaResponseSchema.nullable().default(null)
});
export type QaThreadMessage = z.infer<typeof QaThreadMessageSchema>;

export const QaThreadSchema = z.object({
  id: z.string(),
  revision: z.number().int().nonnegative().default(0),
  title: z.string().default("Q&A thread"),
  projectId: z.string().nullable().default(null),
  paperId: z.string().nullable().default(null),
  paperIds: z.array(z.string()).default([]),
  collectionId: z.string().nullable().default(null),
  messages: z.array(QaThreadMessageSchema).default([]),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});
export type QaThread = z.infer<typeof QaThreadSchema>;

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
export * from "./tex-builds";
export * from "./writing-context";
export * from "./review-evidence";
