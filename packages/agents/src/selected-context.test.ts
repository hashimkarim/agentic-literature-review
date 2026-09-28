import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import type { AgenticClient } from "@agenticdriver/sdk/client";
import { AgentProviderSchema } from "@litagent/contracts";
import { AgenticDriverAdapter } from "./agenticdriver";
import type { ProviderSelectedContext } from "./index";
import { matchesContextManifest, snapshotSelectedContext } from "./selected-context";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function context(): ProviderSelectedContext {
  return { prompt: "Use the selected sources.", isCurrent: () => true,
    sources: [{ id: "paper-1", revision: "revision-1", title: "Sensors", text: "Three sensors were tested." }] };
}

it("snapshots supplied text independently of later input edits", () => {
  const selected = context();
  const before = snapshotSelectedContext(selected);
  selected.sources[0]!.text = "Altered source";
  expect(before.attachments?.[0]?.text).toBe("Three sensors were tested.");
  expect(matchesContextManifest(before.manifests, before.manifests)).toBe(true);
  expect(matchesContextManifest(snapshotSelectedContext(selected).manifests, before.manifests)).toBe(false);
  expect(matchesContextManifest(undefined, [])).toBe(true);
});

it.each(["missing", "empty", "extra", "duplicate", "revision", "sha256", "bytes", "id", "location", "origin", "mediaType"])(
  "rejects %s supplied provenance", (change) => {
    const { manifests } = snapshotSelectedContext(context());
    let actual: unknown = manifests.map((source) => ({ ...source }));
    if (change === "missing") actual = undefined;
    else if (change === "empty") actual = [];
    else if (change === "extra") actual = [...manifests, { ...manifests[0], id: "other" }];
    else if (change === "duplicate") actual = [...manifests, ...manifests];
    else actual = [{ ...manifests[0], [change]: change === "bytes" ? 999 : change === "location" ? { documentId: "other" } : "other" }];
    expect(matchesContextManifest(actual, manifests)).toBe(false);
  }
);

it("bounds attachments by UTF-8 bytes and unique source IDs", () => {
  const selected = context();
  expect(() => snapshotSelectedContext({ ...selected, sources: [] })).toThrow();
  expect(() => snapshotSelectedContext({ ...selected, sources: [...selected.sources, ...selected.sources] })).toThrow();
  expect(() => snapshotSelectedContext({ ...selected, sources: Array.from({ length: 17 }, (_, n) => ({ ...selected.sources[0]!, id: `paper-${n}` })) })).toThrow();
  expect(() => snapshotSelectedContext({ ...selected, sources: [{ ...selected.sources[0]!, text: "\u20ac".repeat(90_000) }] })).toThrow();
});

it.each(["dispatch", "completion", "manifest"] as const)("never saves an artifact after a %s source violation", async (phase) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-context-"));
  roots.push(cwd);
  const outputPath = path.join(cwd, ".litagent/cache/provider-runs/run-1/answer.md");
  let current = phase !== "dispatch";
  let calls = 0;
  const selected = { ...context(), isCurrent: () => current };
  const client: Pick<AgenticClient, "stream"> = {
    async *stream(request) {
      calls++;
      expect(request.input).toBe(selected.prompt);
      expect(request.attachments?.[0]).toMatchObject({ type: "text", source: { revision: "revision-1" } });
      if (phase === "completion") current = false;
      yield { type: "run.completed", runId: "driver-run", sequence: 1, timestamp: new Date().toISOString(),
        result: { runId: "driver-run", provider: "context", model: "test", text: "Unaccepted draft", steps: 1, usage: {}, finishReason: "stop",
          sources: phase === "manifest" ? [] : snapshotSelectedContext(selected).manifests } };
    }
  };
  const provider = AgentProviderSchema.parse({ id: "driver.context", label: "Context", installed: true, enabled: true, authStatus: "authenticated", defaultModel: "test" });
  const adapter = new AgenticDriverAdapter(provider, "context", client);
  const result = await adapter.startSession({ cwd, outputPath, runId: "run-1", prompt: "legacy prompt", selectedContext: selected }).finished;
  expect(calls).toBe(phase === "dispatch" ? 0 : 1);
  expect(result.status).toBe("failed");
  expect(result.failureClass).toBe(phase === "manifest" ? "source_mismatch" : "source_changed");
  expect(result.artifacts).toEqual([]);
  expect(fs.existsSync(outputPath)).toBe(false);
});
