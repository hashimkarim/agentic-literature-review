import { useEffect, useLayoutEffect, useRef } from "react";
import { basicSetup, EditorView } from "codemirror";
import { Compartment, EditorState } from "@codemirror/state";
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { MergeView, unifiedMergeView } from "@codemirror/merge";

const theme = EditorView.theme({
  "&": { height: "100%", color: "var(--text-primary)", backgroundColor: "var(--bg-primary)", fontSize: "14px" },
  ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-mono)", lineHeight: "1.75" },
  ".cm-content": { padding: "20px 0", caretColor: "var(--text-high)" },
  ".cm-line": { padding: "0 20px" },
  ".cm-gutters": { backgroundColor: "var(--bg-secondary)", color: "var(--text-muted)", borderColor: "var(--border-primary)" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--surface-highlight-alt)" },
  ".cm-cursor": { borderLeftColor: "var(--text-primary)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "var(--surface-selection)" },
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
const extensions = [basicSetup, StreamLanguage.define(stex), syntaxHighlighting(highlightStyle), EditorView.lineWrapping, theme];

export function TexEditor({ filePath, content, onChange, onView, onSelection, disabled }: {
  filePath: string; content: string; onChange: (content: string) => void; onView: (view: EditorView | null) => void; disabled: boolean;
  onSelection?: (range: { from: number; to: number }) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onView, onSelection });
  callbacks.current = { onChange, onView, onSelection };
  const states = useRef(new Map<string, EditorState>());
  const editable = useRef(new Compartment());
  const initial = useRef(content); initial.current = content;
  useLayoutEffect(() => {
    if (!host.current) return;
    const old = states.current.get(filePath);
    const editor = new EditorView({
      parent: host.current,
      state: old?.doc.toString() === initial.current ? old : EditorState.create({ doc: initial.current, extensions: [
        ...extensions, EditorView.contentAttributes.of({ "aria-label": "TeX source", spellcheck: "false" }),
        editable.current.of([EditorState.readOnly.of(false), EditorView.editable.of(true)]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) callbacks.current.onChange(update.state.doc.toString());
          if (update.selectionSet || update.docChanged) callbacks.current.onSelection?.(update.state.selection.main);
        })
      ] })
    });
    view.current = editor;
    callbacks.current.onView(editor);
    callbacks.current.onSelection?.(editor.state.selection.main);
    return () => { states.current.set(filePath, editor.state); editor.destroy(); view.current = null; callbacks.current.onView(null); };
  }, [filePath]);
  useLayoutEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== content) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: content } });
  }, [content, filePath]);
  useLayoutEffect(() => { view.current?.dispatch({ effects: editable.current.reconfigure([EditorState.readOnly.of(disabled), EditorView.editable.of(!disabled)]) }); }, [disabled, filePath]);
  return <div className="writing-editor" data-file-path={filePath} ref={host} />;
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
