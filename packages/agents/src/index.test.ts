import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgentProviderSettingsSchema, NormalizedRunEventSchema } from "@litagent/contracts";
import { AgentHarness, AgentProviderCatalog, AgentProviderSettingsStore, EventNdjsonLogger, ProviderSelectionError, createRunEvent } from "./index";
import { AgenticDriverRegistry } from "./agenticdriver";

describe("AgenticDriver-only execution", () => {
  it("starts unconfigured without discovering any local CLI", () => {
    expect(new AgentProviderCatalog().discover()).toEqual([]);
    expect(new AgenticDriverRegistry().discover()).toEqual([]);
    expect(new AgentHarness().discover()).toEqual([]);
  });

  it.each(["codex", "claude", "gemini", "opencode", "copilot", "cursor", "local-heuristic", ""])("requires reselection for %s without starting a session", (providerId) => {
    const registry = new AgenticDriverRegistry({ [providerId]: AgentProviderSettingsSchema.parse({ providerId, enabled: true, connected: true, command: "must-not-run", updatedAt: new Date().toISOString() }) });
    const harness = new AgentHarness({ catalog: registry });
    expect(registry.discover()).toEqual([]);
    expect(registry.definition(providerId)).toBeNull();
    expect(() => registry.createAdapter(providerId)).toThrow(ProviderSelectionError);
    expect(() => harness.startRun({ providerId, model: "old-model", cwd: os.tmpdir(), prompt: "Do not dispatch", runId: "run_retired" })).toThrow(ProviderSelectionError);
    expect(harness.listSessions()).toEqual([]);
  });

  it("preserves retired settings verbatim while saving an explicit Driver selection", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-driver-settings-"));
    try {
      const file = path.join(root, "providers.json");
      const old = { providerId: "codex", enabled: true, command: "/custom/codex", defaultModel: "original-model", updatedAt: new Date().toISOString(), historicalExtra: "preserve" };
      fs.writeFileSync(file, JSON.stringify({ codex: old }));
      const store = new AgentProviderSettingsStore(file);
      expect(() => store.patch("codex", { enabled: true })).toThrow(ProviderSelectionError);
      store.patch("driver.explicit", { enabled: true, defaultModel: "chosen" }, [{ id: "driver.explicit", label: "Explicit", models: ["chosen"], capabilities: [], defaultModel: null }]);
      expect(JSON.parse(fs.readFileSync(file, "utf8")).codex).toEqual(old);
      expect(store.read()["driver.explicit"]).toMatchObject({ enabled: true, defaultModel: "chosen" });
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it("keeps historical event identities readable and logs normalized events", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-run-log-"));
    try {
      const old = createRunEvent({ runId: "run_old", providerId: "codex", type: "run.completed", message: "Historical result" });
      const current = createRunEvent({ runId: "run_current", providerId: "driver.explicit", type: "run.progress", payload: { sdkRunId: "sdk-id" } });
      const file = path.join(root, "events.jsonl");
      const logger = new EventNdjsonLogger(file);
      logger.write(old); logger.write(current);
      const events = fs.readFileSync(file, "utf8").trim().split("\n").map((line) => NormalizedRunEventSchema.parse(JSON.parse(line)));
      expect(events).toEqual([old, current]);
      expect(events.map((event) => event.providerId)).toEqual(["codex", "driver.explicit"]);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
