import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  SearchRequestSchema,
  type Paper,
  type Passage,
  type SearchRequestInput,
  type SearchResult
} from "@litagent/contracts";
import { LitAgentRepository } from "@litagent/library";

function cleanQuery(query: string): string {
  const terms = query
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .split(/\s+/)
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length > 2)
    .slice(0, 8);
  return terms.map((term) => `${term}*`).join(" OR ");
}

function rowString(row: Record<string, unknown>, key: string): string {
  return typeof row[key] === "string" ? row[key] : "";
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
    const allowedPaperIds = parsed.projectId
      ? new Set(repo.listPaperLinks(parsed.projectId).map((link) => link.paperId))
      : null;
    const linkByPaper = parsed.projectId
      ? new Map(repo.listPaperLinks(parsed.projectId).map((link) => [link.paperId, link]))
      : new Map();
    const query = cleanQuery(parsed.query);
    const rows = query
      ? db
          .prepare(
            `SELECT paper_id, passage_id, bm25(passage_fts) AS rank
             FROM passage_fts
             WHERE passage_fts MATCH ?
             ORDER BY rank
             LIMIT ?`
          )
          .all(query, parsed.limit * 4)
      : db
          .prepare(
            `SELECT p.paper_id, ip.passage_id, 0 AS rank
             FROM indexed_papers p
             LEFT JOIN indexed_passages ip ON ip.paper_id = p.paper_id
             ORDER BY p.title
             LIMIT ?`
          )
          .all(parsed.limit * 4);

    const results: SearchResult[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const paperId = rowString(row, "paper_id");
      const passageId = rowString(row, "passage_id");
      if (!paperId || seen.has(`${paperId}:${passageId}`)) continue;
      if (parsed.paperId && paperId !== parsed.paperId) continue;
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
    return results;
  }

  private requireDb(): DatabaseSync {
    if (!this.db) throw new Error(`Search index is not open: ${path.basename(this.sqlitePath)}`);
    return this.db;
  }
}
