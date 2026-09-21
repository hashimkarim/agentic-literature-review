import { describe, expect, it } from "vitest";
import { EvidenceRefSchema } from "@litagent/contracts";
import { savedCitationHash, type SavedCitationSources } from "./citation-revision";

const hash = "a".repeat(64);
const otherHash = "b".repeat(64);
const ref = EvidenceRefSchema.parse({ paperId: "paper-a", passageId: "passage-1", quote: "Saved quote", confidence: null });
function source(paperId: string, markdownHash: string | null): SavedCitationSources[number] {
  return { paperId, markdownHash, paperTitle: paperId, totalChars: 100, includedChars: 100,
    totalPassages: 1, includedPassages: 1, coverage: "full", readiness: "ready" };
}

describe("saved citation revisions", () => {
  it("recovers only the cited paper's saved diagnostic hash without mutating evidence", () => {
    expect(savedCitationHash(ref, [source("paper-b", otherHash), source("paper-a", hash)])).toBe(hash);
    expect(ref.markdownHash).toBeUndefined();
  });
  it("retains explicit hashes and accepts repeated consistent records", () => {
    expect(savedCitationHash({ ...ref, markdownHash: hash })).toBe(hash);
    expect(savedCitationHash({ ...ref, markdownHash: hash }, [source("paper-a", hash), source("paper-a", hash)])).toBe(hash);
  });
  it("does not invent a revision for legacy answers without one", () => {
    expect(savedCitationHash(ref)).toBeUndefined();
    expect(savedCitationHash({ ...ref, markdownHash: null }, [source("paper-a", null), source("paper-b", hash)])).toBeUndefined();
  });
  it("rejects conflicting hashes instead of silently weakening the guard", () => {
    expect(() => savedCitationHash(ref, [source("paper-a", hash), source("paper-a", otherHash)])).toThrow("inconsistent");
    expect(() => savedCitationHash({ ...ref, markdownHash: hash }, [source("paper-a", otherHash)])).toThrow("inconsistent");
  });
  it("rejects malformed saved hashes but ignores unrelated source records", () => {
    expect(() => savedCitationHash(ref, [source("paper-a", "invalid")])).toThrow("inconsistent");
    expect(savedCitationHash(ref, [source("paper-b", "invalid")])).toBeUndefined();
  });
});
