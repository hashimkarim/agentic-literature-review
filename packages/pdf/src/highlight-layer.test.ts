import fs from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { expect, it } from "vitest";

it("the installed highlighter renders each multi-line mark only once per page", () => {
  // Exercise the patched dependency function without loading the DOM-only viewer.
  const source = fs.readFileSync(createRequire(import.meta.url).resolve("react-pdf-highlighter-plus"), "utf8");
  const grouping = source.match(/var groupHighlightsByPage =[\s\S]*?(?=\nvar group_highlights_by_page_default)/)?.[0];
  expect(grouping).toBeTruthy();
  const highlight = { id: "review", position: { boundingRect: { pageNumber: 1 }, rects: [{ pageNumber: 1 }, { pageNumber: 1 }, { pageNumber: 2 }] } };
  const pages = vm.runInNewContext(`${grouping}\ngroupHighlightsByPage(input)`, { input: [highlight, null] });
  expect(Object.keys(pages)).toEqual(["1", "2"]);
  expect(pages[1]).toHaveLength(1);
  expect(pages[1][0].position.rects).toHaveLength(2);
  expect(pages[2]).toHaveLength(1);
  expect(pages[2][0].position.rects).toHaveLength(1);
});

it("the installed resize callback uses the latest zoom without resubscribing", () => {
  const source = fs.readFileSync(createRequire(import.meta.url).resolve("react-pdf-highlighter-plus"), "utf8");
  const callback = source.match(/const handleScaleValue = \(\) => \{[\s\S]*?\n  \};/)?.[0];
  expect(callback).toBeTruthy();
  const viewerRef = { current: { currentScaleValue: "page-width" } as { currentScaleValue: string } | null };
  const pdfScaleValueRef = { current: "page-width" as number | string };
  const resize = vm.runInNewContext(`${callback}\nhandleScaleValue`, { viewerRef, pdfScaleValue: "page-width", pdfScaleValueRef });
  resize();
  expect(viewerRef.current?.currentScaleValue).toBe("page-width");
  pdfScaleValueRef.current = 1.5;
  resize();
  expect(viewerRef.current?.currentScaleValue).toBe("1.5");
  pdfScaleValueRef.current = "page-width";
  resize();
  expect(viewerRef.current?.currentScaleValue).toBe("page-width");
  viewerRef.current = null;
  expect(resize).not.toThrow();
});
