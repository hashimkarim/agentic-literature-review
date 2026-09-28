import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { ContextAttachmentSchema, ContextManifestSchema, DriverError, type ContextManifest } from "@agenticdriver/sdk";
import type { ProviderSelectedContext } from "./index";

export function snapshotSelectedContext(selected?: ProviderSelectedContext) {
  if (!selected) return { attachments: undefined, manifests: [] as ContextManifest[] };
  if (selected.sources.length === 0 || selected.sources.length > 16) {
    throw new DriverError("CONTEXT_TOO_LARGE", "Select between 1 and 16 source documents.");
  }
  const attachments = selected.sources.map((source) => {
    const attachment = ContextAttachmentSchema.parse({
      type: "text", mediaType: "text/markdown",
      source: { id: source.id, revision: source.revision, title: source.title.slice(0, 256), location: { documentId: source.id } },
      text: source.text
    });
    if (attachment.type !== "text") throw new Error("Expected Markdown context.");
    return attachment;
  });
  const manifests: ContextManifest[] = attachments.map(({ source, text, mediaType }) => ({
    ...source, mediaType, bytes: Buffer.byteLength(text, "utf8"),
    sha256: createHash("sha256").update(text).digest("hex"), origin: "inline"
  }));
  if (new Set(manifests.map(({ id }) => id)).size !== manifests.length) throw new Error("Duplicate selected source.");
  if (manifests.some(({ bytes }) => bytes > 256 * 1024) || manifests.reduce((sum, { bytes }) => sum + bytes, 0) > 512 * 1024) {
    throw new DriverError("CONTEXT_TOO_LARGE", "Selected Markdown exceeds the inline context budget. Select a smaller scope.");
  }
  return { attachments, manifests };
}

/** Supplied provenance is not a factual-support verdict. */
export function matchesContextManifest(actual: unknown, expected: ContextManifest[]): boolean {
  if (actual === undefined) return expected.length === 0;
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  const remaining = new Map(expected.map((source) => [source.id, source]));
  for (const value of actual) {
    const parsed = ContextManifestSchema.safeParse(value);
    if (!parsed.success || !isDeepStrictEqual(parsed.data, remaining.get(parsed.data.id))) return false;
    remaining.delete(parsed.data.id);
  }
  return remaining.size === 0;
}
