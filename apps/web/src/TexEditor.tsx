import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { basicSetup, EditorView } from "codemirror";
import { Compartment, EditorState } from "@codemirror/state";
import { Decoration, keymap } from "@codemirror/view";
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { MergeView, unifiedMergeView } from "@codemirror/merge";
import { commentDecorations, setCommentMarks, type CommentMark } from "./comment-decorations";

const theme = EditorView.theme({
  "&": { height: "100%", color: "var(--text-primary)", backgroundColor: "var(--bg-primary)", fontSize: "14px" },
  ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-mono)", lineHeight: "1.75" },
  ".cm-content": { padding: "20px 0", caretColor: "var(--text-high)" },
  ".cm-line": { padding: "0 20px" },
  ".cm-gutters": { backgroundColor: "var(--bg-secondary)", color: "var(--text-muted)", borderColor: "var(--border-primary)" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--surface-highlight-alt)" },
  ".cm-cursor": { borderLeftColor: "var(--text-primary)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "var(--editor-selection-bg)" },
  ".cm-panels, .cm-tooltip": { color: "var(--text-primary)", backgroundColor: "var(--surface-elevated)", borderColor: "var(--border-line)" },
  ".cm-textfield, .cm-button": { color: "var(--text-primary)", background: "var(--surface-input)", border: "1px solid var(--border-line)" }
});
const highlightStyle = HighlightStyle.define([
  { tag: [tags.tagName, tags.keyword], color: "var(--accent-bright)" },
  { tag: [tags.atom, tags.number], color: "var(--state-warning)" },
  { tag: tags.comment, color: "var(--text-secondary)", fontStyle: "italic" },
  { tag: [tags.string, tags.special(tags.variableName)], color: "var(--state-success)" },
  { tag: tags.invalid, textDecoration: "underline wavy var(--state-error)" }
]);
const selectionText = EditorView.decorations.compute(["selection"], (state) => Decoration.set(state.selection.ranges.filter((range) => !range.empty).map((range) => Decoration.mark({ class: "cm-selected-text" }).range(range.from, range.to)), true));
const extensions = [basicSetup, StreamLanguage.define(stex), syntaxHighlighting(highlightStyle), EditorView.lineWrapping, theme, selectionText];

export function TexEditor({ filePath, content, onChange, onView, onSelection, disabled, comments = [], onComment, onAddComment }: {
  filePath: string; content: string; onChange: (content: string) => void; onView: (view: EditorView | null) => void; disabled: boolean;
  onSelection?: (range: { from: number; to: number }) => void;
  comments?: CommentMark[]; onComment?: (id: string) => void; onAddComment?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const [actionPosition, setActionPosition] = useState<{ left: number; top: number } | null>(null);
  const callbacks = useRef({ onChange, onView, onSelection, onComment, onAddComment });
  callbacks.current = { onChange, onView, onSelection, onComment, onAddComment };
  const states = useRef(new Map<string, EditorState>());
  const editable = useRef(new Compartment());
  const initial = useRef(content); initial.current = content;
  useLayoutEffect(() => {
    if (!host.current) return;
    const positionAction = (editor: EditorView) => editor.requestMeasure({
      key: callbacks,
      read: (view) => {
        const range = view.state.selection.main;
        if (range.empty || range.to - range.from > 8000 || !callbacks.current.onAddComment) return null;
        const rect = view.coordsAtPos(range.head), bounds = host.current?.getBoundingClientRect();
        if (!rect || !bounds || rect.top < bounds.top || rect.bottom > bounds.bottom) return null;
        return { left: Math.max(8, Math.min(rect.left - bounds.left, bounds.width - 118)), top: Math.max(2, rect.top - bounds.top - 38) };
      },
      write: (position) => setActionPosition(position)
    });
    const old = states.current.get(filePath);
    const editor = new EditorView({
      parent: host.current,
      state: old?.doc.toString() === initial.current ? old : EditorState.create({ doc: initial.current, extensions: [
        ...extensions, EditorView.contentAttributes.of({ "aria-label": "TeX source", spellcheck: "false" }),
        commentDecorations, EditorView.domEventHandlers({ click(event) {
          const id = (event.target as HTMLElement).closest<HTMLElement>("[data-comment-id]")?.dataset.commentId;
          if (id) callbacks.current.onComment?.(id);
          return false;
        }, scroll(_event, view) { positionAction(view); return false; } }),
        keymap.of([{ key: "Mod-Alt-m", run: (view) => { if (view.state.selection.main.empty || view.state.selection.main.to - view.state.selection.main.from > 8000 || view.state.readOnly || !callbacks.current.onAddComment) return false; callbacks.current.onAddComment(); return true; } }]),
        editable.current.of([EditorState.readOnly.of(false), EditorView.editable.of(true)]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) callbacks.current.onChange(update.state.doc.toString());
          if (update.selectionSet || update.docChanged) callbacks.current.onSelection?.(update.state.selection.main);
          if (update.selectionSet || update.docChanged || update.focusChanged || update.geometryChanged) positionAction(update.view);
        })
      ] })
    });
    view.current = editor;
    setActionPosition(null);
    callbacks.current.onView(editor);
    callbacks.current.onSelection?.(editor.state.selection.main);
    return () => { states.current.set(filePath, editor.state); editor.destroy(); view.current = null; callbacks.current.onView(null); };
  }, [filePath]);
  useLayoutEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== content) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: content } });
  }, [content, filePath]);
  useLayoutEffect(() => { view.current?.dispatch({ effects: editable.current.reconfigure([EditorState.readOnly.of(disabled), EditorView.editable.of(!disabled)]) }); }, [disabled, filePath]);
  useLayoutEffect(() => { view.current?.dispatch({ effects: setCommentMarks.of(comments) }); }, [comments, filePath]);
  return <div className="writing-editor" data-file-path={filePath} ref={host}>
    {actionPosition && !disabled && <div className="writing-selection-actions" style={actionPosition} onMouseDown={(event) => event.preventDefault()}>
      <button type="button" title="Add comment (Ctrl/Command+Alt+M)" onClick={onAddComment}><MessageSquarePlus size={15} />Comment</button>
    </div>}
  </div>;
}

export function TextComparison({ before, after }: { before: string; after: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const readOnly = [...extensions, EditorState.readOnly.of(true), EditorView.editable.of(false)];
    const media = window.matchMedia("(max-width: 600px)");
    let view: MergeView | EditorView;
    const render = () => {
      view?.destroy();
      if (!host.current) return;
      view = media.matches
        ? new EditorView({ parent: host.current, state: EditorState.create({ doc: after, extensions: [...readOnly, unifiedMergeView({ original: before, mergeControls: false, highlightChanges: true })] }) })
        : new MergeView({ parent: host.current, a: { doc: before, extensions: readOnly }, b: { doc: after, extensions: readOnly }, gutter: true, highlightChanges: true });
    };
    render(); media.addEventListener("change", render);
    return () => { media.removeEventListener("change", render); view?.destroy(); };
  }, [before, after]);
  return <div className="writing-comparison" ref={host} />;
}
