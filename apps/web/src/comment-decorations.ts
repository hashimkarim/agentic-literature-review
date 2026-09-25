import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import type { ManuscriptCommentView, ManuscriptFile } from "@litagent/contracts";

export type CommentMark = { id: string; from: number; to: number; selected: boolean };
export function commentMarks(threads: ManuscriptCommentView[], file: ManuscriptFile | undefined, selected: string | null, saved: boolean): CommentMark[] {
  if (!file || !saved) return [];
  return threads.flatMap((thread) => {
    const location = thread.location;
    if (thread.status !== "open" || !location || location.path !== file.path || location.revision !== file.revision ||
      (location.state !== "attached" && location.state !== "moved") || location.from === null || location.to === null ||
      file.content.slice(location.from, location.to) !== thread.anchor?.quote) return [];
    return [{ id: thread.id, from: location.from, to: location.to, selected: thread.id === selected }];
  });
}
export const setCommentMarks = StateEffect.define<CommentMark[]>();
export const commentDecorations = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    decorations = decorations.map(transaction.changes);
    for (const effect of transaction.effects) if (effect.is(setCommentMarks)) {
      decorations = Decoration.set(effect.value.filter((mark) => mark.from >= 0 && mark.to > mark.from && mark.to <= transaction.state.doc.length).map((mark) => Decoration.mark({
        class: `cm-review-comment${mark.selected ? " cm-review-comment-selected" : ""}`,
        attributes: { "data-comment-id": mark.id, title: "Open comment thread" }
      }).range(mark.from, mark.to)), true);
    }
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field)
});
