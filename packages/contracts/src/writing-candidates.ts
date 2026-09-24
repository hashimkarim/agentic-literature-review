import { z } from "zod";
import { ManuscriptHistoryEntrySchema, ManuscriptPathSchema, ManuscriptRevisionSchema, ManuscriptSchema, ManuscriptProjectIdSchema } from "./manuscripts";

export const WritingTargetSchema = z.object({
  providerId: z.string().regex(/^driver\.[A-Za-z0-9_.-]+$/).max(180),
  model: z.string().trim().min(1).max(200),
  count: z.number().int().min(1).max(3)
}).strict();
export const CreateWritingCandidatesSchema = z.object({
  requestId: z.string().uuid(),
  path: ManuscriptPathSchema,
  expectedRevision: ManuscriptRevisionSchema,
  from: z.number().int().nonnegative(),
  to: z.number().int().positive(),
  instruction: z.string().trim().min(1).max(2000),
  audience: z.number().int().min(0).max(3),
  targets: z.array(WritingTargetSchema).min(1).max(3)
}).strict().refine((value) => value.to > value.from && value.to - value.from <= 8000, "Select between 1 and 8,000 characters.")
  .refine((value) => value.targets.reduce((sum, target) => sum + target.count, 0) <= 6, "Request at most six candidates.");
export const WritingCandidateSchema = z.object({
  id: z.string().regex(/^candidate_[a-f0-9]{16}$/),
  providerId: WritingTargetSchema.shape.providerId,
  model: WritingTargetSchema.shape.model,
  variant: z.number().int().positive(),
  status: z.enum(["queued", "running", "completed", "failed", "cancelled", "interrupted"]),
  text: z.string().max(32_000).nullable(),
  error: z.string().max(500).nullable()
});
const AcceptanceSchema = z.object({
  candidateId: WritingCandidateSchema.shape.id,
  revision: ManuscriptRevisionSchema,
  acceptedAt: z.string().datetime()
});
export const WritingCandidateBatchSchema = z.object({
  id: z.string().regex(/^candidates_[a-f0-9]{32}$/),
  // Kept only as provenance on batches created before documents became global.
  projectId: ManuscriptProjectIdSchema.optional(),
  manuscriptId: ManuscriptSchema.shape.id,
  createdAt: z.string().datetime(),
  status: z.enum(["running", "completed", "cancelled", "interrupted"]),
  request: CreateWritingCandidatesSchema,
  sourceVersionId: ManuscriptHistoryEntrySchema.shape.id,
  selectedText: z.string().min(1).max(8000),
  contextBefore: z.string().max(1500),
  contextAfter: z.string().max(1500),
  candidates: z.array(WritingCandidateSchema).min(1).max(6),
  accepting: AcceptanceSchema.nullable(),
  accepted: AcceptanceSchema.nullable()
});
export const WritingCandidateSummarySchema = WritingCandidateBatchSchema.pick({ id: true, createdAt: true, status: true, accepted: true }).extend({
  path: ManuscriptPathSchema,
  instruction: z.string(),
  completed: z.number().int().nonnegative(),
  total: z.number().int().positive()
});
export const AcceptWritingCandidateSchema = z.object({
  candidateId: WritingCandidateSchema.shape.id,
  expectedRevision: ManuscriptRevisionSchema
}).strict();
export type WritingTarget = z.infer<typeof WritingTargetSchema>;
export type CreateWritingCandidates = z.infer<typeof CreateWritingCandidatesSchema>;
export type WritingCandidateBatch = z.infer<typeof WritingCandidateBatchSchema>;
export type WritingCandidateSummary = z.infer<typeof WritingCandidateSummarySchema>;
export type AcceptWritingCandidate = z.infer<typeof AcceptWritingCandidateSchema>;
