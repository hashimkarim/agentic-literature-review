import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9_-]+$/).max(160);
export const ReviewEvidenceScopeSchema = z.object({
  projectId: id.nullable(),
  sources: z.array(z.object({ paperId: id, markdownHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).min(1).max(500)
}).strict().refine((scope) => new Set(scope.sources.map((source) => source.paperId)).size === scope.sources.length, "Duplicate review source");
export type ReviewEvidenceScope = z.infer<typeof ReviewEvidenceScopeSchema>;

export const ReviewSearchInputSchema = z.object({ query: z.string().trim().min(1).max(2000), limit: z.number().int().min(1).max(30).default(10) }).strict();
export const ReviewPassageInputSchema = z.object({ paperId: id, passageId: id, quote: z.string().min(1).max(32_000).optional() }).strict();
