import type { ManuscriptCommentView, ManuscriptFile } from "@litagent/contracts";

export function suggestionIssue(thread: ManuscriptCommentView, file?: ManuscriptFile & { state?: string }): string | null {
  if (thread.status === "deleted" || thread.suggestion?.status !== "pending" || !thread.anchor) return "This suggestion has already been decided.";
  if (!file || file.path !== thread.anchor.path) return "The source file is unavailable. Reload files.";
  if (file.state && file.state !== "saved") return "Save or resolve your current source changes first.";
  if (file.revision !== thread.anchor.revision || file.content.slice(thread.anchor.from, thread.anchor.to) !== thread.anchor.quote) return "Source changed. Review and reattach the suggestion to a current selection.";
  return null;
}
