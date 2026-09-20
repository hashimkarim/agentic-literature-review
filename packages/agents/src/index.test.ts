import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  AgentHarness,
  AgentProviderCatalog,
  AgentProviderSettingsStore,
  classifyProviderFailure,
  normalizeProviderOutput,
  type ProviderDefinition
} from "./index";

describe("AgentProviderCatalog", () => {
  it("discovers known provider definitions", () => {
    const providers = new AgentProviderCatalog().discover();
    expect(providers.map((provider) => provider.id)).toContain("codex");
    expect(providers.map((provider) => provider.id)).toContain("claude");
    expect(providers.every((provider) => typeof provider.installed === "boolean")).toBe(true);
  }, 10_000); // Six discovery probes can each use 500 ms + an 800 ms version timeout.

  it("normalizes native JSON stream events into run events", () => {
    const events = normalizeProviderOutput({
      runId: "run_test",
      providerId: "codex",
      stream: "stdout",
      text: `${JSON.stringify({ type: "tool.execution_start", data: { toolName: "grep" } })}\n${JSON.stringify({
        type: "assistant.message_delta",
        data: { deltaContent: "answer" }
      })}\n`
    });
    expect(events.map((event) => event.type)).toEqual(["tool.call", "model.delta"]);
    expect(events[1]?.message).toBe("answer");
  });

  it("classifies common provider failures", () => {
    expect(classifyProviderFailure({ output: "not authenticated, please login", code: 1 })).toBe("auth");
    expect(classifyProviderFailure({ output: "429 rate limit exceeded", code: 1 })).toBe("rate_limit");
    expect(classifyProviderFailure({ output: "", installed: false })).toBe("command_not_found");
  });

  it("runs a provider session through the harness and logs NDJSON events", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-agent-harness-"));
    const eventsPath = path.join(tempDir, "events.jsonl");
    const fakeProvider: ProviderDefinition = {
      id: "fake",
      label: "Fake Agent",
      command: process.execPath,
      versionArgs: ["--version"],
      capabilities: ["cli", "stream"],
      connectCommand: "node --version",
      models: [],
      defaultModel: null,
      runArgs: () => [
        "-e",
        [
          "process.stdout.write(JSON.stringify({type:'assistant.message_delta',data:{deltaContent:'hello'}})+'\\n');",
          "process.stdout.write(JSON.stringify({type:'artifact.written',path:'out.md'})+'\\n');"
        ].join("")
      ]
    };
    const harness = new AgentHarness({ catalog: new AgentProviderCatalog([fakeProvider]) });
    const session = harness.startRun({
      runId: "run_fake",
      providerId: "fake",
      cwd: process.cwd(),
      prompt: "hello",
      eventsPath
    });
    const result = await session.finished;
    const logged = fs.readFileSync(eventsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));

    expect(result.status).toBe("completed");
    expect(result.transcript).toContain("hello");
    expect(logged.map((event) => event.type)).toContain("run.started");
    expect(logged.map((event) => event.type)).toContain("model.delta");
    expect(logged.map((event) => event.type)).toContain("run.completed");
  });

  it("applies provider settings to discovered provider snapshots", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-provider-settings-"));
    const store = new AgentProviderSettingsStore(path.join(tempDir, "providers.json"));
    const fakeProvider: ProviderDefinition = {
      id: "fake",
      label: "Fake Agent",
      command: process.execPath,
      versionArgs: ["--version"],
      capabilities: ["cli"],
      connectCommand: "node --version",
      models: ["default-model"],
      defaultModel: null,
      runArgs: () => ["--version"]
    };
    store.patch("fake", {
      enabled: true,
      connected: true,
      command: process.execPath,
      defaultModel: "custom-model",
      customModels: ["custom-model"]
    }, [fakeProvider]);
    const providers = new AgentProviderCatalog([fakeProvider], store.read()).discover();
    expect(providers[0]?.enabled).toBe(true);
    expect(providers[0]?.connected).toBe(true);
    expect(providers[0]?.defaultModel).toBe("custom-model");
    expect(providers[0]?.models).toContain("default-model");
    expect(providers[0]?.models).toContain("custom-model");
  });
});
