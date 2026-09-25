import { expect, it } from "vitest";
import type { WritingCandidateBatch } from "@litagent/contracts";
import { writingEditorial, writingWordCount } from "./writing-editorial";

it("counts the original live 50-word prose without citation tokens or footnotes", () => {
  const text = "Synthetic fixture results on the same 100 simulated cases showed median latency decreasing from 40 ms for the baseline to 30 ms for the revised implementation, a 25% reduction. These invented fixture results are not measurements from a real study. No accuracy evaluation was performed; therefore, accuracy effects remain unknown.";
  expect(writingWordCount(text.replace("25%", "25\\%"))).toBe(50);
  expect(writingWordCount(`${text.replace("25%", "25\\%")} [[cite:ws_0123456789abcdef01234567]]`)).toBe(50);
  expect(writingWordCount(`${text.replace("25%", "25\\%")} \\footnote{results: fixture, line 1, \\textbf{revision} abc.}`)).toBe(50);
});

it("preserves formatted prose but excludes TeX references, comments and inline math", () => {
  expect(writingWordCount("\\textbf{Accuracy was 0.72}. \\citep[see][p. 2]{fixture} \\label{sec:one}\n% not prose\nHeld-out cases used $n=100$ samples.")).toBe(7);
  expect(writingWordCount("\\section{Results}\n\\(x + y\\) \\[ z=3 \\] \\includegraphics[width=10cm]{images/plot.png}")).toBe(1);
});

it("reports deterministic editing notices without making source-support decisions", () => {
  const batch = { selectedText: "Original prose.", request: { assistant: { action: "shorten", wordBudget: 50 } } } as WritingCandidateBatch;
  const checks = writingEditorial({ text: "This is longer. TODO: revise.", claims: [], warnings: [] }, batch);
  expect(checks).toMatchObject({ method: "tex-prose-v1", wordCount: 5, targetWords: 50 });
  expect(checks.notices).toEqual(["Unresolved TODO placeholders remain.", "The draft is not shorter than the selection."]);
  expect(checks).not.toHaveProperty("supported");
});
