import { z } from "zod";
import { ManuscriptPathSchema, ManuscriptRevisionSchema, ManuscriptSchema } from "./manuscripts";

export const CommentSelectionSchema = z.object({
  path: ManuscriptPathSchema, revision: ManuscriptRevisionSchema,
  from: z.number().int().min(0).max(1_000_000), to: z.number().int().min(1).max(1_000_000),
  quote: z.string().min(1).max(8000)
}).strict().refine((value) => value.to > value.from && value.to - value.from === value.quote.length, "Select up to 8,000 characters.");
export const CommentAnchorSchema = CommentSelectionSchema.safeExtend({ prefix: z.string().max(48), suffix: z.string().max(48) });
const Body = z.string().trim().min(1).max(8000);
export const CreateManuscriptCommentSchema = z.object({
  requestId: z.string().uuid(), selection: CommentSelectionSchema, body: Body
}).strict();
const operation = { requestId: z.string().uuid(), expectedVersion: z.number().int().positive() };
export const UpdateManuscriptCommentSchema = z.discriminatedUnion("action", [
  z.object({ ...operation, action: z.literal("reply"), body: Body }).strict(),
  z.object({ ...operation, action: z.literal("edit"), messageId: z.string().uuid(), body: Body }).strict(),
  z.object({ ...operation, action: z.literal("delete-message"), messageId: z.string().uuid() }).strict(),
  z.object({ ...operation, action: z.literal("resolve") }).strict(),
  z.object({ ...operation, action: z.literal("reopen") }).strict(),
  z.object({ ...operation, action: z.literal("delete") }).strict(),
  z.object({ ...operation, action: z.literal("reattach"), selection: CommentSelectionSchema }).strict()
]);
export const ManuscriptCommentSchema = z.object({
  id: z.string().regex(/^comment_[a-f0-9]{24}$/), manuscriptId: ManuscriptSchema.shape.id,
  version: z.number().int().positive(), status: z.enum(["open", "resolved", "deleted"]),
  anchor: CommentAnchorSchema.nullable(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  messages: z.array(z.object({
    id: z.string().uuid(), author: z.literal("local"), body: Body.nullable(),
    createdAt: z.string().datetime(), editedAt: z.string().datetime().nullable()
  })).max(100),
  creationHash: ManuscriptRevisionSchema,
  lastOperation: z.object({ id: z.string().uuid(), hash: ManuscriptRevisionSchema }).nullable()
});
export const CommentLocationSchema = z.object({
  state: z.enum(["attached", "moved", "outdated", "missing"]), path: ManuscriptPathSchema,
  revision: ManuscriptRevisionSchema.nullable(), from: z.number().int().nonnegative().nullable(),
  to: z.number().int().nonnegative().nullable(), line: z.number().int().positive().nullable()
});
export const ManuscriptCommentViewSchema = ManuscriptCommentSchema.omit({ creationHash: true, lastOperation: true }).extend({ location: CommentLocationSchema.nullable() });
export type CommentSelection = z.infer<typeof CommentSelectionSchema>;
export type CommentAnchor = z.infer<typeof CommentAnchorSchema>;
export type ManuscriptComment = z.infer<typeof ManuscriptCommentSchema>;
export type ManuscriptCommentView = z.infer<typeof ManuscriptCommentViewSchema>;
export type CreateManuscriptComment = z.infer<typeof CreateManuscriptCommentSchema>;
export type UpdateManuscriptComment = z.infer<typeof UpdateManuscriptCommentSchema>;
