import { z } from "zod";
import { ManuscriptNodePathSchema, ManuscriptPathSchema, ManuscriptRevisionSchema } from "./manuscripts";

export const WritingSourceKindSchema = z.enum(["code", "results", "notes", "benchmark"]);
export const WritingAttachmentInputSchema = z.object({
  path: ManuscriptNodePathSchema,
  kind: WritingSourceKindSchema,
  content: z.string().min(1).max(256_000),
  originUrl: z.string().max(2000).refine((value) => {
    try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.search; } catch { return false; }
  }, "Use an HTTPS source URL without credentials or query parameters.").nullable().default(null)
}).strict();
export const WritingAttachmentSchema = WritingAttachmentInputSchema.extend({
  id: z.string().regex(/^source_[a-f0-9]{24}$/),
  revision: ManuscriptRevisionSchema,
  createdAt: z.string().datetime()
});
export const WritingContextSelectionSchema = z.object({
  paperIds: z.array(z.string().regex(/^[A-Za-z0-9_-]+$/).max(100)).max(12).default([]),
  attachmentIds: z.array(WritingAttachmentSchema.shape.id).max(40).default([]),
  manuscriptPaths: z.array(ManuscriptPathSchema).max(20).default([])
}).strict();
export const WritingSourceCatalogSchema = z.object({
  papers: z.array(z.object({ id: z.string(), title: z.string(), converted: z.boolean(), year: z.number().nullable() })),
  attachments: z.array(WritingAttachmentSchema.omit({ content: true }).extend({ characters: z.number() })),
  files: z.array(z.object({ path: ManuscriptPathSchema, revision: ManuscriptRevisionSchema, characters: z.number() })),
  projectIds: z.array(z.string())
});
export const WritingSourceRefSchema = z.object({
  id: z.string().regex(/^ws_[a-f0-9]{24}$/),
  sourceId: z.string(), kind: z.enum(["literature", "manuscript", "code", "results", "notes", "benchmark"]),
  title: z.string(), revision: ManuscriptRevisionSchema,
  path: z.string().nullable(), originUrl: z.string().nullable(),
  paperId: z.string().nullable(), passageId: z.string().nullable(), page: z.number().int().positive().nullable(),
  startLine: z.number().int().positive().nullable(), endLine: z.number().int().positive().nullable(),
  quote: z.string().min(1).max(6000), citekey: z.string().nullable(), bibliography: z.string().nullable()
});
export const WritingContextSchema = z.object({
  revision: ManuscriptRevisionSchema,
  sources: z.array(WritingSourceRefSchema).max(160),
  coverage: z.array(z.object({
    sourceId: z.string(), title: z.string(), revision: ManuscriptRevisionSchema.nullable(),
    includedCharacters: z.number().int().nonnegative(), totalCharacters: z.number().int().nonnegative(),
    status: z.enum(["complete", "partial", "unavailable", "omitted"])
  })),
  characters: z.number().int().nonnegative(), limit: z.number().int().positive()
});
export const WritingActionSchema = z.enum(["draft", "outline", "storyline", "rewrite", "expand", "shorten", "simplify", "formalize", "grammar", "citations", "review"]);
export const WritingAssistantOptionsSchema = z.object({
  action: WritingActionSchema,
  context: WritingContextSelectionSchema,
  expectedContextRevision: ManuscriptRevisionSchema,
  wordBudget: z.number().int().min(30).max(2000).default(250),
  jargon: z.enum(["minimal", "define", "specialist"]).default("define"),
  math: z.enum(["conceptual", "equations", "derivation"]).default("conceptual"),
  language: z.string().trim().min(1).max(80).default("English"),
  style: z.string().max(2000).default("")
}).strict();
export const WritingClaimSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  kind: z.enum(["reported", "inference"]),
  evidence: z.array(z.object({ sourceId: WritingSourceRefSchema.shape.id, quote: z.string().min(4).max(2000) }).strict()).min(1).max(12)
}).strict();
export const WritingAssistantOutputSchema = z.object({
  text: z.string().trim().min(1).max(32_000),
  claims: z.array(WritingClaimSchema).max(40),
  warnings: z.array(z.string().min(1).max(1000)).max(20)
}).strict();
export const WritingSourceReviewSchema = z.object({
  supported: z.boolean(), reason: z.string().min(1).max(2000),
  claims: z.array(z.object({ index: z.number().int().nonnegative(), supported: z.boolean(), reason: z.string().min(1).max(1000) }).strict()).max(40)
}).strict();
export type WritingAttachment = z.infer<typeof WritingAttachmentSchema>;
export type WritingAttachmentInput = z.infer<typeof WritingAttachmentInputSchema>;
export type WritingContextSelection = z.infer<typeof WritingContextSelectionSchema>;
export type WritingContext = z.infer<typeof WritingContextSchema>;
export type WritingSourceRef = z.infer<typeof WritingSourceRefSchema>;
export type WritingAssistantOptions = z.infer<typeof WritingAssistantOptionsSchema>;
export type WritingAssistantOutput = z.infer<typeof WritingAssistantOutputSchema>;
export type WritingAction = z.infer<typeof WritingActionSchema>;
export type WritingSourceCatalog = z.infer<typeof WritingSourceCatalogSchema>;
