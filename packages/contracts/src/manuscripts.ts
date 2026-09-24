import { z } from "zod";

export const ManuscriptNodePathSchema = z.string().min(1).max(240).refine((value) => {
  const parts = value.split("/");
  return parts.length <= 9 && parts.every((part) => part.length <= 120 &&
    /^[\p{L}\p{N}_][\p{L}\p{N}\p{M} _().-]*$/u.test(part) && !/[. ]$/.test(part) &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}, "Use a relative path without hidden folders, reserved names or special path characters.");
export const ManuscriptPathSchema = ManuscriptNodePathSchema.refine((value) =>
  /\.(tex|bib|sty|cls|bst|bbx|cbx|lbx|def|cfg|clo|fd|ltx|bbl|txt|csv|tsv|dat|md|py|sh|json|yaml|yml|toml)$/i.test(value) || /(?:^|\/)latexmkrc$/.test(value), "Unsupported editable source type.");
export const ManuscriptAssetPathSchema = ManuscriptNodePathSchema.refine((value) =>
  /\.(png|jpg|jpeg|pdf|eps|svg|webp|otf|ttf)$/i.test(value), "Unsupported figure or font type.");
export const ManuscriptEntryPathSchema = ManuscriptPathSchema.refine((value) => /\.tex$/i.test(value), "The main file must be a .tex file.");
export const ManuscriptRevisionSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const ManuscriptProjectIdSchema = z.string().regex(/^[A-Za-z0-9_-]+$/).max(100);
export const ManuscriptProjectIdsSchema = z.array(ManuscriptProjectIdSchema).max(100)
  .refine((ids) => new Set(ids).size === ids.length, "Project links must be unique.");
export const ManuscriptFileSchema = z.object({
  path: ManuscriptPathSchema,
  content: z.string().max(1_000_000),
  revision: ManuscriptRevisionSchema
});
export const ManuscriptSchema = z.object({
  id: z.string().regex(/^manuscript_[a-f0-9]{16}$/),
  projectIds: ManuscriptProjectIdsSchema,
  name: z.string().trim().min(1).max(160),
  entryFile: ManuscriptEntryPathSchema,
  createdAt: z.string().datetime()
});
export const ManuscriptDocumentSchema = ManuscriptSchema.extend({
  files: z.array(ManuscriptFileSchema).max(256),
  assets: z.array(z.object({ path: ManuscriptAssetPathSchema, revision: ManuscriptRevisionSchema, bytes: z.number().int().nonnegative() })).max(256).optional(),
  folders: z.array(ManuscriptNodePathSchema).max(256).optional(),
  treeRevision: ManuscriptRevisionSchema.optional()
});
export const ManuscriptTreeRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("folder"), path: ManuscriptNodePathSchema, expectedRevision: ManuscriptRevisionSchema }).strict(),
  z.object({ action: z.literal("move"), path: ManuscriptNodePathSchema, destination: ManuscriptNodePathSchema, expectedRevision: ManuscriptRevisionSchema }).strict(),
  z.object({ action: z.literal("delete"), path: ManuscriptNodePathSchema, expectedRevision: ManuscriptRevisionSchema }).strict(),
  z.object({ action: z.literal("entry"), path: ManuscriptEntryPathSchema, expectedRevision: ManuscriptRevisionSchema }).strict()
]);
export const ImportManuscriptRequestSchema = z.object({
  requestId: z.string().uuid(), name: ManuscriptSchema.shape.name, entryFile: ManuscriptEntryPathSchema,
  projectIds: ManuscriptProjectIdsSchema.default([])
}).strict();
export const ManuscriptImportPreviewSchema = z.object({
  files: z.array(z.object({ path: ManuscriptNodePathSchema, bytes: z.number().int().nonnegative(), kind: z.enum(["source", "asset"]) })),
  folders: z.array(ManuscriptNodePathSchema),
  entryCandidates: z.array(ManuscriptEntryPathSchema), suggestedEntry: ManuscriptEntryPathSchema.nullable(),
  rootFolder: z.string().nullable(), skipped: z.array(z.object({ path: z.string(), reason: z.string() })),
  warnings: z.array(z.string())
});
export const CreateManuscriptRequestSchema = z.object({
  name: ManuscriptSchema.shape.name,
  projectIds: ManuscriptProjectIdsSchema.default([])
}).strict();
export const UpdateManuscriptProjectsRequestSchema = z.object({
  projectIds: ManuscriptProjectIdsSchema,
  expectedProjectIds: ManuscriptProjectIdsSchema
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
export type ManuscriptTreeRequest = z.infer<typeof ManuscriptTreeRequestSchema>;
export type ImportManuscriptRequest = z.infer<typeof ImportManuscriptRequestSchema>;
export type ManuscriptImportPreview = z.infer<typeof ManuscriptImportPreviewSchema>;
