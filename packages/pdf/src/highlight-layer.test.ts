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
