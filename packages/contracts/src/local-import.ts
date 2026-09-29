import { z } from "zod";
import { WritingAttachmentInputSchema } from "./writing-context";
export const LocalFolderRequestSchema = z.object({ path: z.string().trim().min(1).max(4096), kind: z.enum(["pdf", "sources"]) }).strict();
export const LocalFolderPreviewSchema = z.object({
  id: z.string().uuid(), root: z.string(), kind: z.enum(["pdf", "sources"]), expiresAt: z.string().datetime(),
  files: z.array(z.object({ id: z.string().uuid(), path: z.string(), bytes: z.number().int().nonnegative() })),
  skipped: z.number().int().nonnegative(), truncated: z.boolean(),
});
export type LocalFolderPreview = z.infer<typeof LocalFolderPreviewSchema>;
export const ImportLocalEntrySchema = z.object({
  previewId: z.string().uuid(), entryId: z.string().uuid(),
  projectId: z.string().nullable().optional(), manuscriptId: z.string().optional(),
  sourceKind: z.enum(["code", "results", "notes", "benchmark"]).optional(),
  originUrl: WritingAttachmentInputSchema.shape.originUrl.optional(),
}).strict();

export const PaperFolderRequestSchema = z.object({
  path: z.string().trim().min(1).max(4096),
  markdownPath: z.string().trim().min(1).max(4096).optional(),
}).strict();
export const PaperFolderFileSchema = z.object({ id: z.string().uuid(), path: z.string(), bytes: z.number().int().nonnegative() });
export const PaperFolderPreviewSchema = z.object({
  id: z.string().uuid(), root: z.string(), markdownRoot: z.string(), expiresAt: z.string().datetime(),
  entries: z.array(z.object({
    id: z.string().uuid(), title: z.string(), pdf: PaperFolderFileSchema.nullable(), markdown: PaperFolderFileSchema.nullable(),
    match: z.enum(["path", "name"]).nullable(),
  })),
  markdownFiles: z.array(PaperFolderFileSchema), skipped: z.number().int().nonnegative(), truncated: z.boolean(),
});
export type PaperFolderPreview = z.infer<typeof PaperFolderPreviewSchema>;
export const ImportPaperFolderEntrySchema = z.object({
  previewId: z.string().uuid(), entryId: z.string().uuid(), markdownId: z.string().uuid().nullable().optional(),
  storage: z.enum(["copy", "linked-files"]), projectId: z.string().regex(/^[A-Za-z0-9_-]+$/).nullable().optional(),
}).strict();
export type ImportPaperFolderEntry = z.infer<typeof ImportPaperFolderEntrySchema>;
export const PaperLocalSourceStateSchema = z.object({
  available: z.boolean(), revision: z.string(), pdfRevision: z.string().nullable(),
  pdf: z.string().nullable(), markdown: z.string().nullable(), message: z.string().nullable(),
});
export type PaperLocalSourceState = z.infer<typeof PaperLocalSourceStateSchema>;
