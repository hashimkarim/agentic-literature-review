import type { WritingAssistantOutput, WritingCandidateBatch } from "@litagent/contracts";

/** Deterministic estimate for TeX prose, not a full TeX expansion or linguistic judgment. */
export function writingWordCount(text: string): number {
  const input = text.replace(/\[\[cite:[^\]]+\]\]/g, " ")
    .replace(/(?<!\\)%[^\n]*/g, " ")
    .replace(/(?<!\\)\$\$[\s\S]*?(?<!\\)\$\$|(?<!\\)\$[^$]*?(?<!\\)\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)/g, " ");
  let prose = "";
  const omitted = new Set(["cite", "citet", "citep", "parencite", "textcite", "autocite", "footnote", "label", "ref", "eqref", "url", "includegraphics", "input", "include", "bibliography", "bibliographystyle", "begin", "end"]);
  for (let i = 0; i < input.length;) {
    if (input[i] !== "\\") { prose += input[i++]; continue; }
    const command = /^\\([A-Za-z]+)\*?/.exec(input.slice(i));
    if (!command) { prose += input[i + 1] ?? ""; i += 2; continue; }
    i += command[0].length;
    if (!omitted.has(command[1]!)) continue;
    // Skip optional arguments and a balanced group, including nested formatting.
    while (/\s/.test(input[i] ?? "") && i < input.length) i++;
    while (input[i] === "[") {
      const end = input.indexOf("]", i + 1);
      if (end < 0) break;
      i = end + 1;
      while (/\s/.test(input[i] ?? "") && i < input.length) i++;
    }
    if (input[i] === "{") {
      let depth = 1; i++;
      while (i < input.length && depth > 0) {
        if (input[i] === "\\") { i += 2; continue; }
        if (input[i] === "{") depth++;
        if (input[i] === "}") depth--;
        i++;
      }
    }
    prose += " ";
  }
  return prose.match(/[\p{L}\p{N}]+(?:[.'\u2019-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

export function writingEditorial(output: WritingAssistantOutput, batch: WritingCandidateBatch) {
  const wordCount = writingWordCount(output.text);
  const originalWords = writingWordCount(batch.selectedText);
  const action = batch.request.assistant!.action;
  const notices: string[] = [];
  if (/\bTODO\b/.test(output.text)) notices.push("Unresolved TODO placeholders remain.");
  if (output.text.split("\n").some((line) => /\S.*(?<!\\)%/.test(line))) notices.push("An unescaped percent sign comments out following TeX text.");
  if (action === "shorten" && wordCount >= originalWords) notices.push("The draft is not shorter than the selection.");
  if (action === "expand" && wordCount <= originalWords) notices.push("The draft is not longer than the selection.");
  return { method: "tex-prose-v1" as const, wordCount, targetWords: batch.request.assistant!.wordBudget, notices };
}
