import { createHash } from "node:crypto";
import { ManuscriptError, ManuscriptStore, type LitAgentRepository } from "@litagent/library";
import {
  WritingContextSchema, WritingContextSelectionSchema,
  type WritingContext, type WritingContextSelection, type WritingSourceRef, type Paper
} from "@litagent/contracts";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const LIMIT = 100_000;
const escapeBib = (value: string) => value.replace(/[\\{}%&#_$]/g, (character) => `\\${character}`).replace(/[\r\n]+/g, " ");

function bibliography(paper: Paper, key: string): string {
  return [`@article{${key},`, `  title = {${escapeBib(paper.title)}},`,
    ...(paper.authors.length ? [`  author = {${paper.authors.map(escapeBib).join(" and ")}},`] : []),
    ...(paper.year ? [`  year = {${paper.year}},`] : []),
    ...(paper.doi ? [`  doi = {${escapeBib(paper.doi)}},`] : []),
    ...(paper.arxivId ? [`  eprint = {${escapeBib(paper.arxivId)}},`] : []),
    `  note = {LitAgent ${paper.id}}`, "}"].join("\n");
}

// Preserve original line coordinates, including whitespace and long result rows.
function chunks(text: string, size = 4000): { quote: string; startLine: number; endLine: number }[] {
  const result: ReturnType<typeof chunks> = [];
  let quote = "", startLine = 1, line = 1;
  for (const part of text.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    if (quote && quote.length + part.length > size) { result.push({ quote, startLine, endLine: line - 1 }); quote = ""; startLine = line; }
    if (part.length > size) {
      for (let i = 0; i < part.length; i += size) result.push({ quote: part.slice(i, i + size), startLine: line, endLine: line });
      startLine = line + 1;
    } else quote += part;
    line++;
  }
  if (quote) result.push({ quote, startLine, endLine: line - 1 });
  return result;
}

export class WritingContextService {
  constructor(readonly store: ManuscriptStore, readonly repo: LitAgentRepository) {}

  catalog(manuscriptId: string) {
    const document = this.store.read(manuscriptId);
    const allowed = this.papers(document.projectIds);
    return {
      papers: allowed.map((paper) => ({ id: paper.id, title: paper.title, converted: !!this.repo.readMarkdown(paper.id), year: paper.year })),
      attachments: this.store.writingAttachments(manuscriptId).map(({ content, ...source }) => ({ ...source, characters: content.length })),
      files: document.files.map(({ path, revision, content }) => ({ path, revision, characters: content.length })),
      projectIds: document.projectIds
    };
  }

  private papers(projectIds: string[]) {
    return [...new Map((projectIds.length ? projectIds.flatMap((id) => this.repo.readProject(id) ? this.repo.listPapers(id) : []) : this.repo.listPapers()).map(({ paper }) => [paper.id, paper])).values()];
  }

  preview(manuscriptId: string, input: WritingContextSelection): WritingContext {
    const selected = WritingContextSelectionSchema.parse(input);
    const document = this.store.read(manuscriptId);
    const attachments = this.store.writingAttachments(manuscriptId);
    const papers = this.papers(document.projectIds);
    type Source = Omit<WritingSourceRef, "id" | "quote" | "startLine" | "endLine"> & { text: string; passages?: ReturnType<LitAgentRepository["readPassages"]> };
    const documents: Source[] = [];
    const base = { path: null, originUrl: null, paperId: null, passageId: null, page: null, citekey: null, bibliography: null };
    for (const paperId of [...new Set(selected.paperIds)].sort()) {
      const paper = papers.find((item) => item.id === paperId);
      if (!paper) throw new ManuscriptError(409, "writing_source_scope", "A selected paper is no longer in this document's linked projects/library scope.");
      const text = this.repo.readMarkdown(paperId) ?? "";
      const key = `litagent${hash(paperId).slice(0, 16)}`;
      documents.push({ ...base, sourceId: paperId, kind: "literature", title: paper.title, paperId, text,
        revision: hash(JSON.stringify({ text, title: paper.title, authors: paper.authors, year: paper.year, doi: paper.doi, arxivId: paper.arxivId })),
        citekey: key, bibliography: bibliography(paper, key), passages: this.repo.readPassages(paperId) });
    }
    for (const id of [...new Set(selected.attachmentIds)].sort()) {
      const source = attachments.find((item) => item.id === id);
      if (!source) throw new ManuscriptError(409, "writing_source_missing", "An attached source was removed. Refresh the source selection.");
      documents.push({ ...base, sourceId: source.id, kind: source.kind, title: source.path, path: source.path, originUrl: source.originUrl, revision: source.revision, text: source.content });
    }
    for (const name of [...new Set(selected.manuscriptPaths)].sort()) {
      const file = document.files.find((item) => item.path === name);
      if (!file) throw new ManuscriptError(409, "writing_source_missing", "A selected manuscript file was removed.");
      documents.push({ ...base, sourceId: `manuscript:${name}`, kind: "manuscript", title: name, path: name, revision: file.revision, text: file.content });
    }
    const sources: WritingSourceRef[] = [];
    const coverage: WritingContext["coverage"] = [];
    let characters = 0;
    // Give every selected source a bounded share instead of letting the first paper
    // silently displace the rest. The exact included and omitted counts are exposed.
    const allowance = Math.floor(LIMIT / Math.max(documents.length, 1));
    const maxChunks = Math.floor(160 / Math.max(documents.length, 1));
    for (const { text, passages, ...source } of documents) {
      let included = 0, count = 0;
      for (const chunk of chunks(text, Math.min(4000, allowance))) {
        if (included + chunk.quote.length > allowance || count >= maxChunks) break;
        const overlapping = passages?.filter((passage) => passage.markdownStart !== null && passage.markdownEnd !== null && passage.markdownStart < chunk.endLine && passage.markdownEnd >= chunk.startLine) ?? [];
        const exact = overlapping.find((passage) => passage.quote === chunk.quote.trim());
        const pages = new Set(overlapping.map((passage) => passage.page).filter((page) => page !== null));
        sources.push({ ...source, ...chunk, id: `ws_${hash(JSON.stringify([source.sourceId, source.revision, chunk])).slice(0, 24)}`,
          passageId: exact?.id ?? null, page: pages.size === 1 ? [...pages][0]! : null });
        included += chunk.quote.length; count++;
      }
      characters += included;
      coverage.push({ sourceId: source.sourceId, title: source.title, revision: source.revision, includedCharacters: included, totalCharacters: text.length,
        status: !text.length ? "unavailable" : !included ? "omitted" : included < text.length ? "partial" : "complete" });
    }
    return WritingContextSchema.parse({ revision: hash(JSON.stringify({ selection: selected, projectIds: document.projectIds, sources, coverage })), sources, coverage, characters, limit: LIMIT });
  }

  assertCurrent(manuscriptId: string, selected: WritingContextSelection, revision: string): void {
    if (this.preview(manuscriptId, selected).revision !== revision) throw new ManuscriptError(409, "writing_context_changed", "Writing sources changed. Review fresh context before generating or accepting text.");
  }
}
