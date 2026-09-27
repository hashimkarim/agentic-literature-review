import { expect, it } from "vitest";
import { WritingContextSchema, type WritingAssistantOutput } from "@litagent/contracts";
import { inspectWritingOutput, WritingClaimTextError } from "./writing-assistant";

// Reduced from the real Haiku response c6902aac-cd59-406d-9bc1-4c85ac589350.
// Pure validation regression: this does not stand in for a provider acceptance run.
const sourceId = "ws_a5ba5b54e33d26cbf8ca6354";
const quote = "The baseline median latency was 40 milliseconds.";
const context = WritingContextSchema.parse({
  revision: "a".repeat(64), characters: quote.length, limit: 100000, coverage: [],
  sources: [{ id: sourceId, sourceId: "paper_bfd7e8e7b4d543c8", kind: "literature", title: "Synthetic Latency Study",
    revision: "b".repeat(64), quote, path: null, originUrl: null, paperId: "paper_bfd7e8e7b4d543c8",
    passageId: null, page: 1, startLine: 9, endLine: 9, citekey: "synthetic2026", bibliography: null }]
});
const draft: WritingAssistantOutput = {
  text: `Our revised method achieved a median latency of 30 milliseconds compared to the baseline's 40 milliseconds, representing a 25 percent reduction [[cite:${sourceId}]].`,
  claims: [{ text: "baseline median latency was 40 milliseconds", kind: "reported", evidence: [{ sourceId, quote }] }], warnings: []
};
const batch = { context, selectedText: "" };

it("identifies the live claim-text mismatch without silently accepting paraphrased claim anchors", () => {
  expect(() => inspectWritingOutput(draft, batch)).toThrow(WritingClaimTextError);
});

it("accepts a literal claim anchor structurally, leaving factual coverage to the separate review", () => {
  const corrected = { ...draft, claims: [{ ...draft.claims[0]!, text: "the baseline's 40 milliseconds" }] };
  expect(() => inspectWritingOutput(corrected, batch)).not.toThrow();
  const fabricated = { ...corrected, claims: [{ ...corrected.claims[0]!, evidence: [{ sourceId, quote: "The baseline was 50 milliseconds." }] }] };
  expect(() => inspectWritingOutput(fabricated, batch)).toThrow("A citation or quotation was not present");
});
