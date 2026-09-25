import { expect, it } from "vitest";
import { booleanPreference, choicePreference, readPreference, writePreference } from "./browser-preferences";
import { defaultWritingView, parseWritingView, reconcileWritingView, writingViewKey } from "./writing-view";
import type { ManuscriptDocument } from "@litagent/contracts";

const document: ManuscriptDocument = { id: "manuscript_view", name: "Study", projectIds: [], createdAt: "2026-09-25T00:00:00Z", entryFile: "main.tex",
  files: [{ path: "main.tex", content: "private text", revision: "a" }, { path: "chapters/methods.tex", content: "other text", revision: "b" }],
  assets: [{ path: "figures/chart.png", bytes: 20, revision: "c" }], folders: ["chapters", "empty"] };

it("round-trips writing layouts, panels and open files without persisting document content", () => {
  const map = new Map<string, string>();
  const storage = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); } };
  const layout = { ...defaultWritingView(document), mode: "split" as const, active: "chapters/methods.tex", openFiles: ["main.tex", "chapters/methods.tex"],
    collapsedFolders: ["empty", "figures"], assistantTab: "sources" as const, filesVisible: false, sourcePercent: 63, buildLogOpen: true };
  writePreference(writingViewKey(document.id), layout, storage);
  const restored = readPreference(writingViewKey(document.id), defaultWritingView(document), (value) => parseWritingView(value, document), storage);
  expect(restored).toEqual(layout);
  expect(map.get(writingViewKey(document.id))).not.toContain("private text");
  expect(readPreference(writingViewKey("other"), defaultWritingView(document), (value) => parseWritingView(value, document), storage).mode).toBe("source");
});

it("recovers missing files and folders while retaining valid tabs, assets and layout", () => {
  const restored = parseWritingView({ mode: "preview", panel: "history", active: "deleted.tex", selected: "deleted", openFiles: ["figures/chart.png", "deleted.tex", "figures/chart.png"], collapsedFolders: ["chapters", "gone", "figures"] }, document);
  expect(restored).toMatchObject({ mode: "preview", panel: "history", active: "main.tex", selected: "main.tex", openFiles: ["figures/chart.png", "main.tex"], collapsedFolders: ["chapters", "figures"] });
  expect(reconcileWritingView({ ...restored, active: "figures/chart.png" }, { ...document, assets: [] }).active).toBe("main.tex");
});

it("validates preferences individually and bounds pane sizes", () => {
  expect(parseWritingView({ mode: "bad", panel: {}, assistantTab: true, filesVisible: "false", active: {}, openFiles: [null, {}, 42], collapsedFolders: {}, sourcePercent: 200 }, document, false))
    .toEqual({ ...defaultWritingView(document, false), sourcePercent: 75 });
  expect(parseWritingView({ sourcePercent: -100 }, document).sourcePercent).toBe(25);
  expect(parseWritingView({ sourcePercent: Infinity }, document).sourcePercent).toBe(50);
  expect(parseWritingView(null, document)).toEqual(defaultWritingView(document));
});

it("restores the same saved desktop layout at narrow widths without replacing it", () => {
  const saved = { ...defaultWritingView(document), mode: "split" as const, panel: "assistant" as const };
  expect(parseWritingView(saved, document, false)).toEqual(saved);
});

it("survives malformed, blocked and full storage", () => {
  const bad = { getItem: () => "{bad", setItem: () => { throw new Error("QuotaExceeded"); } };
  expect(readPreference("x", false, booleanPreference, bad)).toBe(false);
  expect(() => writePreference("x", true, bad)).not.toThrow();
  expect(readPreference("x", "pdf", choicePreference(["pdf", "markdown"]), { ...bad, getItem: () => '"unknown"' })).toBe("pdf");
  expect(readPreference("x", false, booleanPreference, { ...bad, getItem: () => { throw new Error("SecurityError"); } })).toBe(false);
  expect(readPreference("x", false, booleanPreference, { ...bad, getItem: () => "true" })).toBe(true);
  expect(readPreference("x", true, booleanPreference, null)).toBe(true);
});
