import { z } from "zod";
import { ManuscriptPathSchema, ManuscriptNodePathSchema, ManuscriptEntryPathSchema, ManuscriptRevisionSchema, ManuscriptSchema } from "./manuscripts";

export const TexBuildRequestSchema = z.object({
  requestId: z.string().uuid(),
  revisions: z.record(ManuscriptNodePathSchema, ManuscriptRevisionSchema)
    .refine((files) => Object.keys(files).length > 0 && Object.keys(files).length <= 256),
  entryFile: ManuscriptEntryPathSchema.optional()
}).strict();
export const TexDiagnosticSchema = z.object({
  severity: z.enum(["error", "warning"]),
  message: z.string().max(2000),
  path: ManuscriptPathSchema.nullable(),
  line: z.number().int().positive().nullable()
});
export const TexBuildSchema = z.object({
  id: z.string().uuid(),
  manuscriptId: ManuscriptSchema.shape.id,
  revisions: TexBuildRequestSchema.shape.revisions,
  entryFile: ManuscriptEntryPathSchema.optional(),
  status: z.enum(["running", "succeeded", "failed", "cancelled", "interrupted"]),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
  phase: z.string().max(120).optional(),
  diagnostics: z.array(TexDiagnosticSchema).max(100),
  log: z.string().max(64_000)
});
export const TexBuildStateSchema = z.object({
  latest: TexBuildSchema.nullable(),
  lastSuccessful: TexBuildSchema.nullable()
});
export type TexBuildRequest = z.infer<typeof TexBuildRequestSchema>;
export type TexDiagnostic = z.infer<typeof TexDiagnosticSchema>;
export type TexBuild = z.infer<typeof TexBuildSchema>;
export type TexRuntimeStatus = { available: boolean; version: string | null; message: string; engine?: "tectonic" | "texlive" };
export type TexBuildState = z.infer<typeof TexBuildStateSchema> & { runtime: TexRuntimeStatus };
