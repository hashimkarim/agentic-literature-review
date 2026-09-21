import type { EvidenceRef, QaResponse } from "@litagent/contracts";

export type SavedCitationSources = QaResponse["diagnostics"]["sources"];

/** Only revisions captured with this answer may guard its historical citations. */
export function savedCitationHash(ref: EvidenceRef, sources: SavedCitationSources = []): string | undefined {
  const hashes = [ref.markdownHash, ...sources.filter((source) => source.paperId === ref.paperId).map((source) => source.markdownHash)]
    .filter((hash): hash is string => hash !== null && hash !== undefined);
  if (hashes.some((hash) => !/^[a-f0-9]{64}$/.test(hash)) || new Set(hashes).size > 1) {
    throw new Error("This answer has inconsistent source revision records. Ask again using the current sources.");
  }
  return hashes[0];
}
