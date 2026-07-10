import { describe, expect, it } from "vitest";
import { citationPageSearchOrder } from "./citation";

describe("citationPageSearchOrder", () => {
  it("checks the requested page and its neighbors before the remaining document", () => {
    expect(citationPageSearchOrder(4, 7)).toEqual([4, 3, 5, 1, 2, 6, 7]);
  });

  it("keeps boundary pages valid and visits every page once", () => {
    expect(citationPageSearchOrder(1, 3)).toEqual([1, 2, 3]);
    expect(citationPageSearchOrder(3, 3)).toEqual([3, 2, 1]);
  });
});
