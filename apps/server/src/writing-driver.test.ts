import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { expect, it } from "vitest";
import { AgenticDriver } from "@agenticdriver/sdk";
import { mockProvider } from "@agenticdriver/sdk/providers";
import { serve } from "@agenticdriver/sdk/server";
import { AgentHarness, AgentProviderSettingsStore } from "@litagent/agents";
import { AgenticDriverRegistry } from "@litagent/agents/agenticdriver";
import { WritingCandidateBatchSchema, WritingTargetSchema, type CreateWritingCandidates, type WritingAssistantOutput } from "@litagent/contracts";
import { LitAgentRepository, ManuscriptStore } from "@litagent/library";
import { WritingCandidateService, WritingContextService, writingTargetValidator } from "@litagent/workflows";
import { manuscriptRoutes } from "./manuscript-routes";

it.each([
  { legacyIds: true, instanceId: "writing-fixture" },
  { legacyIds: false, instanceId: "writing-fixture" }
])("generates and accepts writing through the installed SDK ($legacyIds, $instanceId)", async ({ legacyIds, instanceId }) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-writing-driver-"));
  const repo = new LitAgentRepository(root); repo.init();
  const store = new ManuscriptStore(root), document = store.create({ name: "Synthetic writing check" });
  const file = document.files.find((item) => item.path === "sections/introduction.tex")!;
  const attachment = store.attachWritingSource(document.id, { path: "results.txt", kind: "results", content: "The synthetic score was 0.72." });
  const context = new WritingContextService(store, repo);
  const selection = { paperIds: [], attachmentIds: [attachment.id], manuscriptPaths: [] };
  const preview = context.preview(document.id, selection), source = preview.sources[0]!;
  const draft: WritingAssistantOutput = {
    text: `The synthetic score was 0.72. [[cite:${source.id}]]`,
    claims: [{ text: "The synthetic score was 0.72.", kind: "reported", evidence: [{ sourceId: source.id, quote: source.quote }] }],
    warnings: ["Synthetic data only."]
  };
  let calls = 0;
  const mock = mockProvider((request) => {
    calls++;
    expect(request.model).toBe("fixture-model");
    expect(request.tools).toEqual([]);
    const reviewing = request.messages.some((message) => message.content.startsWith("LitAgent writing source review"));
    return { text: JSON.stringify(reviewing
      ? { supported: true, reason: "Supported by the supplied synthetic result.", claims: [{ index: 0, supported: true, reason: "Exact result." }] }
      : draft) };
  });
  const provider = { ...mock, info: { ...mock.info, id: instanceId, name: "Writing fixture", models: ["fixture-model"] } };
  const token = "synthetic-writing-regression-token";
  const sdk = await serve(new AgenticDriver({ providers: [provider] }), { port: 0, tokens: [{ token, subject: "writing-fixture", providers: [instanceId] }] });
  const registry = new AgenticDriverRegistry();
  const hostId = randomUUID();
  await registry.configureHost({ id: hostId, label: "Fixture", deviceName: "fixture-device", legacyIds }, sdk.url, token);
  const providerId = `driver.${legacyIds ? "" : `${hostId}:`}${instanceId}`;
  const settings = new AgentProviderSettingsStore(path.join(root, ".litagent/provider-settings.json"));
  settings.patch(providerId, { enabled: true, defaultModel: "fixture-model" }, [registry.definition(providerId)!]);
  registry.setSettings(settings.read());
  const service = new WritingCandidateService(store, new AgentHarness({ catalog: registry }), writingTargetValidator(registry, () => settings.read()), context);
  const app = express(); app.use(express.json()); app.use("/api/manuscripts", manuscriptRoutes(store, service, undefined, context));
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/api/manuscripts/${document.id}/candidates`;
  const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const input: CreateWritingCandidates = {
    requestId: randomUUID(), path: file.path, expectedRevision: file.revision, from: file.content.length, to: file.content.length,
    instruction: "Summarize the supplied synthetic result.", audience: 2, targets: [{ providerId, model: "fixture-model", count: 1 }],
    assistant: { action: "draft", context: selection, expectedContextRevision: preview.revision, wordBudget: 100, jargon: "define", math: "conceptual", language: "English", style: "" }
  };
  try {
    const response = await post(base, input);
    expect(response.status, await response.clone().text()).toBe(202);
    const started = WritingCandidateBatchSchema.parse(await response.json());
    await service.idle();
    const batch = WritingCandidateBatchSchema.parse(await (await fetch(`${base}/${started.id}`)).json());
    expect(batch.candidates[0]).toMatchObject({ providerId, status: "completed", review: { supported: true } });
    expect(calls).toBe(2);
    expect(store.read(document.id)).toEqual(document);
    await registry.refresh(hostId);
    expect((await post(base, input)).status).toBe(202);
    expect(calls).toBe(2);
    expect((await post(base, { ...input, requestId: randomUUID(), targets: [{ providerId, model: "unselected", count: 1 }] })).status).toBe(400);
    settings.patch(providerId, { enabled: false }, [registry.definition(providerId)!]); registry.setSettings(settings.read());
    expect((await post(base, { ...input, requestId: randomUUID() })).status).toBe(409);
    expect((await post(base, { ...input, requestId: randomUUID(), targets: [{ providerId: `driver.${randomUUID()}:${instanceId}`, model: "fixture-model", count: 1 }] })).status).toBe(409);
    expect(calls).toBe(2);
    const accepted = await post(`${base}/${batch.id}/accept`, { candidateId: batch.candidates[0]!.id, expectedRevision: file.revision });
    expect(accepted.status).toBe(200);
    expect(store.read(document.id).files.find((item) => item.path === file.path)?.content).toContain("The synthetic score was 0.72.");
    expect(store.history(document.id, file.path)[0]?.reason).toBe("candidate");
    expect(new WritingCandidateService(store, new AgentHarness({ catalog: registry }), () => {}, context).get(document.id, batch.id).accepted).not.toBeNull();
    expect(calls).toBe(2);
  } finally {
    await service.idle(); await sdk.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 15_000);

it.each(["codex", "driver.", "driver.device:codex", `driver.${randomUUID()}:`, `driver.${randomUUID()}:a:b`, "driver.bad provider", "driver.bad/provider", `driver.${"a".repeat(180)}`])("rejects invalid writing provider IDs without changing their identity (%s)", (providerId) => {
  expect(WritingTargetSchema.safeParse({ providerId, model: "fixture-model", count: 1 }).success).toBe(false);
});
