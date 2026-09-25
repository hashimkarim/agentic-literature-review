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
