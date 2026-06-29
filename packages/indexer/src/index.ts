import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  SearchRequestSchema,
  type Paper,
  type Passage,
  type SearchRequest,
  type SearchRequestInput,
  type SearchResult
} from "@litagent/contracts";
import { LitAgentRepository } from "@litagent/library";

function cleanQuery(query: string): string {
  const terms = queryTerms(query).slice(0, 8);
  return terms.map((term) => `${term}*`).join(" OR ");
}

function queryTerms(query: string): string[] {
  return query
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .split(/\s+/)
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length > 2);
}

function rowString(row: Record<string, unknown>, key: string): string {
  return typeof row[key] === "string" ? row[key] : "";
}

function scopedPaperIds(repo: LitAgentRepository, request: SearchRequest): Set<string> | null {
  const explicit = new Set<string>();
  if (request.paperId) explicit.add(request.paperId);
  for (const paperId of request.paperIds) explicit.add(paperId);

  let scoped: Set<string> | null = explicit.size > 0 ? explicit : null;

  if (request.projectId) {
    const links = repo.listPaperLinks(request.projectId);
    let projectPaperIds = new Set(links.map((link) => link.paperId));
    if (request.collectionId) {
      const collection = repo.readCollection(request.projectId, request.collectionId);
      const collectionPaperIds = new Set(collection?.paperIds ?? []);
      for (const link of links) {
        if (link.subcollectionIds.includes(request.collectionId)) collectionPaperIds.add(link.paperId);
      }
      projectPaperIds = collectionPaperIds;
    }
    scoped = scoped ? intersectSets(scoped, projectPaperIds) : projectPaperIds;
  } else if (request.collectionId) {
    scoped = new Set();
  }

  return scoped;
}

function intersectSets(left: Set<string>, right: Set<string>): Set<string> {
  const next = new Set<string>();
  for (const value of left) {
    if (right.has(value)) next.add(value);
  }
  return next;
}

export class SearchIndex {
  private db: DatabaseSync | null = null;

  constructor(private readonly sqlitePath: string) {}

  open(): void {
    if (this.db) return;
    this.db = new DatabaseSync(this.sqlitePath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS indexed_papers (
        paper_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        authors TEXT NOT NULL,
        tags TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS indexed_passages (
        passage_id TEXT PRIMARY KEY,
        paper_id TEXT NOT NULL,
        page INTEGER,
        section TEXT NOT NULL,
        quote TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS passage_fts USING fts5(
        paper_id UNINDEXED,
        passage_id UNINDEXED,
        title,
        authors,
        tags,
        section,
        quote
      );
    `);
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  rebuild(repo: LitAgentRepository): void {
    this.open();
    const db = this.requireDb();
    db.exec("DELETE FROM indexed_papers; DELETE FROM indexed_passages; DELETE FROM passage_fts;");
    for (const paper of repo.listGlobalPapers()) {
      this.indexPaper(paper, repo.readPassages(paper.id));
    }
  }

  indexPaper(paper: Paper, passages: Passage[]): void {
    this.open();
    const db = this.requireDb();
    db.prepare(
      "INSERT OR REPLACE INTO indexed_papers (paper_id, title, authors, tags, updated_at) VALUES (?, ?, ?, ?, ?)"
    ).run(paper.id, paper.title, paper.authors.join(" "), paper.tags.join(" "), paper.updatedAt);
    db.prepare("DELETE FROM indexed_passages WHERE paper_id = ?").run(paper.id);
    db.prepare("DELETE FROM passage_fts WHERE paper_id = ?").run(paper.id);
    const passageInsert = db.prepare(
      "INSERT OR REPLACE INTO indexed_passages (passage_id, paper_id, page, section, quote) VALUES (?, ?, ?, ?, ?)"
    );
    const ftsInsert = db.prepare(
      "INSERT INTO passage_fts (paper_id, passage_id, title, authors, tags, section, quote) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    for (const passage of passages) {
      passageInsert.run(passage.id, paper.id, passage.page, passage.section, passage.quote);
      ftsInsert.run(
        paper.id,
        passage.id,
        paper.title,
        paper.authors.join(" "),
        paper.tags.join(" "),
        passage.section,
        passage.quote
      );
    }
  }

  search(repo: LitAgentRepository, request: SearchRequestInput): SearchResult[] {
    const parsed = SearchRequestSchema.parse(request);
    this.open();
    const db = this.requireDb();
    const allowedPaperIds = scopedPaperIds(repo, parsed);
    const linkByPaper = parsed.projectId
      ? new Map(repo.listPaperLinks(parsed.projectId).map((link) => [link.paperId, link]))
      : new Map();
    const query = cleanQuery(parsed.query);
    const rowLimit = parsed.projectId || parsed.paperId || parsed.paperIds.length || parsed.collectionId
      ? Math.min(Math.max(parsed.limit * 20, 100), 500)
      : parsed.limit * 4;
    const rows = query
      ? db
          .prepare(
            `SELECT paper_id, passage_id, bm25(passage_fts) AS rank
             FROM passage_fts
             WHERE passage_fts MATCH ?
             ORDER BY rank
             LIMIT ?`
          )
          .all(query, rowLimit)
      : db
          .prepare(
            `SELECT p.paper_id, ip.passage_id, 0 AS rank
             FROM indexed_papers p
             LEFT JOIN indexed_passages ip ON ip.paper_id = p.paper_id
             ORDER BY p.title
             LIMIT ?`
          )
          .all(rowLimit);

    const results: SearchResult[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const paperId = rowString(row, "paper_id");
      const passageId = rowString(row, "passage_id");
      if (!paperId || seen.has(`${paperId}:${passageId}`)) continue;
      if (allowedPaperIds && !allowedPaperIds.has(paperId)) continue;
      const paper = repo.readPaper(paperId);
      if (!paper) continue;
      const passage = repo.readPassages(paperId).find((candidate) => candidate.id === passageId) ?? null;
      results.push({
        paper,
        passage,
        link: linkByPaper.get(paperId) ?? null,
        score: typeof row.rank === "number" ? row.rank : 0
      });
      seen.add(`${paperId}:${passageId}`);
      if (results.length >= parsed.limit) break;
    }
    if (results.length < parsed.limit && parsed.query.trim()) {
      for (const result of this.lexicalFallback(repo, parsed, allowedPaperIds, linkByPaper, seen)) {
        results.push(result);
        if (results.length >= parsed.limit) break;
      }
    }
    return results;
  }

  private lexicalFallback(
    repo: LitAgentRepository,
    request: SearchRequest,
    allowedPaperIds: Set<string> | null,
    linkByPaper: Map<string, SearchResult["link"]>,
    seen: Set<string>
  ): SearchResult[] {
    const terms = queryTerms(request.query);
    if (!terms.length) return [];
    const candidates: SearchResult[] = [];
    const papers = allowedPaperIds
      ? [...allowedPaperIds].map((paperId) => repo.readPaper(paperId)).filter((paper): paper is Paper => Boolean(paper))
      : repo.listGlobalPapers();

    for (const paper of papers) {
      const paperText = `${paper.title} ${paper.authors.join(" ")} ${paper.tags.join(" ")}`.toLowerCase();
      const paperBoost = scoreText(paperText, terms) * 0.25;
      for (const passage of repo.readPassages(paper.id)) {
        const key = `${paper.id}:${passage.id}`;
        if (seen.has(key)) continue;
        const score = scoreText(`${passage.section} ${passage.quote}`.toLowerCase(), terms) + paperBoost;
        if (score <= 0) continue;
        candidates.push({
          paper,
          passage,
          link: linkByPaper.get(paper.id) ?? null,
          score
        });
      }
    }

    return candidates.sort((left, right) => right.score - left.score);
  }

  private requireDb(): DatabaseSync {
    if (!this.db) throw new Error(`Search index is not open: ${path.basename(this.sqlitePath)}`);
    return this.db;
  }
}

function scoreText(text: string, terms: string[]): number {
  let score = 0;
  for (const term of terms) {
    if (text.includes(term)) score += 1;
  }
  return score;
}
