import type { ManuscriptDocument } from "@litagent/contracts";

export type WritingView = {
  mode: "source" | "split" | "preview";
  panel: "none" | "assistant" | "history" | "candidates" | "comments";
  assistantTab: "compose" | "sources" | "drafts";
  filesVisible: boolean;
  buildLogOpen: boolean;
  active: string;
  selected: string;
  openFiles: string[];
  collapsedFolders: string[];
  sourcePercent: number;
};

export const writingViewKey = (id: string) => `litagent:view:v1:writing:${id}`;

export function defaultWritingView(document: ManuscriptDocument, wide = true): WritingView {
  const active = document.files.some((file) => file.path === document.entryFile) ? document.entryFile : document.files[0]?.path ?? document.assets?.[0]?.path ?? "";
  return { mode: "source", panel: wide ? "assistant" : "none", assistantTab: "compose", filesVisible: true, buildLogOpen: false,
    active, selected: active, openFiles: active ? [active] : [], collapsedFolders: [], sourcePercent: 50 };
}

export function reconcileWritingView(view: WritingView, document: ManuscriptDocument): WritingView {
  const paths = new Set([...document.files, ...(document.assets ?? [])].map((file) => file.path));
  const folders = new Set(document.folders ?? []);
  for (const path of paths) {
    const parts = path.split("/");
    while (parts.length > 1) { parts.pop(); folders.add(parts.join("/")); }
  }
  const active = paths.has(view.active) ? view.active : defaultWritingView(document).active;
  const openFiles = [...new Set(view.openFiles.filter((path) => paths.has(path)))];
  if (active && !openFiles.includes(active)) openFiles.push(active);
  return { ...view, active, openFiles, selected: paths.has(view.selected) || folders.has(view.selected) || view.selected === "" ? view.selected : active,
    collapsedFolders: [...new Set(view.collapsedFolders.filter((path) => folders.has(path)))] };
}

export function parseWritingView(value: unknown, document: ManuscriptDocument, wide = true): WritingView {
  const fallback = defaultWritingView(document, wide);
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const stored = value as Record<string, unknown>;
  const choice = <T extends string>(key: string, choices: readonly T[], initial: T): T => choices.includes(stored[key] as T) ? stored[key] as T : initial;
  const paths = (key: string, initial: string[]) => Array.isArray(stored[key]) ? stored[key].filter((item): item is string => typeof item === "string" && item.length <= 1024).slice(0, 2048) : initial;
  return reconcileWritingView({
    mode: choice("mode", ["source", "split", "preview"], fallback.mode),
    panel: choice("panel", ["none", "assistant", "history", "candidates", "comments"], fallback.panel),
    assistantTab: choice("assistantTab", ["compose", "sources", "drafts"], fallback.assistantTab),
    filesVisible: typeof stored.filesVisible === "boolean" ? stored.filesVisible : fallback.filesVisible,
    buildLogOpen: typeof stored.buildLogOpen === "boolean" ? stored.buildLogOpen : fallback.buildLogOpen,
    active: typeof stored.active === "string" ? stored.active : fallback.active,
    selected: typeof stored.selected === "string" ? stored.selected : fallback.selected,
    openFiles: paths("openFiles", fallback.openFiles), collapsedFolders: paths("collapsedFolders", []),
    sourcePercent: typeof stored.sourcePercent === "number" && Number.isFinite(stored.sourcePercent) ? Math.max(25, Math.min(75, stored.sourcePercent)) : 50
  }, document);
}
