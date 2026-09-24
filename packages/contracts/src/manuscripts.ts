import { z } from "zod";

export const ManuscriptPathSchema = z.string().max(240).regex(
  /^(?:[A-Za-z0-9][A-Za-z0-9_-]*\/){0,5}[A-Za-z0-9][A-Za-z0-9._-]*\.(tex|bib)$/,
  "Use a relative .tex or .bib path with letters, numbers, hyphens and underscores."
);
export const ManuscriptRevisionSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const ManuscriptFileSchema = z.object({
  path: ManuscriptPathSchema,
  content: z.string().max(250_000),
  revision: ManuscriptRevisionSchema
});
export const ManuscriptSchema = z.object({
  id: z.string().regex(/^manuscript_[a-f0-9]{16}$/),
  projectId: z.string().regex(/^[A-Za-z0-9_-]+$/).max(100),
  name: z.string().trim().min(1).max(160),
  entryFile: ManuscriptPathSchema,
  createdAt: z.string().datetime()
});
export const ManuscriptDocumentSchema = ManuscriptSchema.extend({
  files: z.array(ManuscriptFileSchema).max(64)
});
export const CreateManuscriptRequestSchema = z.object({
  name: ManuscriptSchema.shape.name
}).strict();
export const WriteManuscriptFileRequestSchema = z.object({
  path: ManuscriptPathSchema,
  content: ManuscriptFileSchema.shape.content,
  expectedRevision: ManuscriptRevisionSchema.nullable()
}).strict();
export const DeleteManuscriptFileRequestSchema = WriteManuscriptFileRequestSchema.omit({ content: true }).extend({
  expectedRevision: ManuscriptRevisionSchema
});
export const ManuscriptHistoryEntrySchema = z.object({
  id: z.string().regex(/^version_[a-f0-9]{16}$/),
  path: ManuscriptPathSchema,
  revision: ManuscriptRevisionSchema,
  savedAt: z.string().datetime(),
  reason: z.enum(["created", "saved", "external", "restored", "checkpoint", "deleted", "candidate"]),
  label: z.string().trim().min(1).max(120).nullable()
});
export const ManuscriptCheckpointRequestSchema = z.object({
  path: ManuscriptPathSchema,
  expectedRevision: ManuscriptRevisionSchema,
  label: z.string().trim().min(1).max(120)
}).strict();
export const RestoreManuscriptFileRequestSchema = z.object({
  path: ManuscriptPathSchema,
  versionId: ManuscriptHistoryEntrySchema.shape.id,
  expectedRevision: ManuscriptRevisionSchema.nullable()
}).strict();

export type Manuscript = z.infer<typeof ManuscriptSchema>;
export type ManuscriptFile = z.infer<typeof ManuscriptFileSchema>;
export type ManuscriptDocument = z.infer<typeof ManuscriptDocumentSchema>;
export type WriteManuscriptFileRequest = z.infer<typeof WriteManuscriptFileRequestSchema>;
export type ManuscriptHistoryEntry = z.infer<typeof ManuscriptHistoryEntrySchema>;
