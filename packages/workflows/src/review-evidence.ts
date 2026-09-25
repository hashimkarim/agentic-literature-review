import { createHash } from "node:crypto";
import { ReviewEvidenceScopeSchema, ReviewPassageInputSchema, ReviewSearchInputSchema, type ReviewEvidenceScope } from "@litagent/contracts";
import type { LitAgentRepository } from "@litagent/library";
import type { SearchIndex } from "@litagent/indexer";

/** App-owned read operations. Existence is deliberately not a support verdict. */
export class ReviewEvidence {
  readonly scope: ReviewEvidenceScope;

  constructor(private repo: LitAgentRepository, private index: SearchIndex, scope: ReviewEvidenceScope) {
    this.scope = ReviewEvidenceScopeSchema.parse(scope);
    for (const source of this.scope.sources) Object.freeze(source);
    Object.freeze(this.scope.sources);
    Object.freeze(this.scope);
    this.assertCurrent();
  }

  static capture(repo: LitAgentRepository, projectId: string | null, paperIds: string[]): ReviewEvidenceScope {
    const allowed = new Set(repo.listPapers(projectId).map(({ paper }) => paper.id));
    return ReviewEvidenceScopeSchema.parse({ projectId, sources: paperIds.map((paperId) => {
      if (!allowed.has(paperId)) throw new Error("Review source is not accessible in the selected scope.");
      const markdown = repo.readMarkdown(paperId);
      if (markdown === null) throw new Error("Review source has no Markdown.");
      return { paperId, markdownHash: createHash("sha256").update(markdown).digest("hex") };
    }) });
  }

  assertCurrent(): void {
    const allowed = new Set(this.repo.listPapers(this.scope.projectId).map(({ paper }) => paper.id));
    for (const source of this.scope.sources) {
      if (!allowed.has(source.paperId)) throw new Error("Review source access changed; select sources again.");
      const markdown = this.repo.readMarkdown(source.paperId);
      if (markdown === null || createHash("sha256").update(markdown).digest("hex") !== source.markdownHash) {
        throw new Error("Review source revision changed; select sources again.");
      }
    }
  }

  search(input: unknown) {
    const request = ReviewSearchInputSchema.parse(input);
    this.assertCurrent();
    const results = this.index.search(this.repo, {
      ...request, projectId: this.scope.projectId, paperIds: this.scope.sources.map((source) => source.paperId)
    });
    return results.filter((result) => result.passage).map((result) => this.passage({ paperId: result.paper.id, passageId: result.passage!.id }));
  }

  passage(input: unknown) {
    const request = ReviewPassageInputSchema.parse(input);
    this.assertCurrent();
    const source = this.scope.sources.find((candidate) => candidate.paperId === request.paperId);
    if (!source) throw new Error("Passage is outside the selected review sources.");
    const passage = this.repo.readPassages(source.paperId).find((candidate) => candidate.id === request.passageId);
    if (!passage) throw new Error("Review passage no longer exists.");
    // Recheck against canonical text, not merely a possibly stale passage index.
    const markdown = this.repo.readMarkdown(source.paperId)!;
    const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
    if (!normalize(markdown).includes(normalize(passage.quote))) throw new Error("Review passage does not match the current Markdown.");
    if (request.quote !== undefined && !passage.quote.includes(request.quote)) throw new Error("Quoted text does not exist in this passage.");
    const target = this.repo.resolveCitationTarget({
      paperId: source.paperId, passageId: passage.id, projectId: this.scope.projectId,
      expectedMarkdownHash: source.markdownHash, expectedQuote: passage.quote
    });
    return { source: { ...source }, passage, target, citationExists: true as const, support: "not_assessed" as const };
  }
}
