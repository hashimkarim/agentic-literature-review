import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { AgenticDriver } from "@agenticdriver/sdk";
import { mockProvider } from "@agenticdriver/sdk/providers";
import { serve } from "@agenticdriver/sdk/server";
import { AgentHarness, AgentProviderSettingsStore } from "./index";
import { AgenticDriverRegistry } from "./agenticdriver";

it("routes identical provider IDs across devices and retains cancellation after one is disconnected", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-driver-registry-"));
  const firstToken = "fixture-one-private-credential-for-testing", secondToken = "fixture-two-private-credential-for-testing";
  let release!: () => void, started!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const entered = new Promise<void>((resolve) => { started = resolve; });
  const first = await serve(new AgenticDriver({ providers: [mockProvider(async () => {
    started(); await waiting; return { text: "First device" };
  })] }), { port: 0, tokens: [{ token: firstToken, subject: "one", providers: ["mock"] }] });
  const second = await serve(new AgenticDriver({ providers: [mockProvider(() => ({ text: "Second device" }))] }),
    { port: 0, tokens: [{ token: secondToken, subject: "two", providers: ["mock"] }] });
  try {
    const a = { id: randomUUID(), label: "Workstation", deviceName: "desktop-a", legacyIds: true };
    const b = { id: randomUUID(), label: "Lab", deviceName: "server-b" };
    const catalog = new AgenticDriverRegistry();
    await catalog.configureHost(a, first.url, firstToken);
    await catalog.configureHost(b, second.url, secondToken);
    const bId = `driver.${b.id}:mock`;
    expect(catalog.discover().filter((p) => p.driver).map((p) => p.id)).toEqual(["driver.mock", bId]);
    expect(catalog.discover().find((p) => p.id === bId)?.driver).toMatchObject({ connectionId: b.id, deviceName: "server-b", instanceId: "mock" });
    const settings = new AgentProviderSettingsStore(path.join(root, "settings.json"));
    for (const id of ["driver.mock", bId]) settings.patch(id, { enabled: true, defaultModel: "demo" }, [catalog.definition(id)!]);
    catalog.setSettings(settings.read());
    const harness = new AgentHarness({ catalog });
    const running = harness.startRun({ providerId: "driver.mock", runId: "a", cwd: root, prompt: "Synthetic fixture only" });
    await entered;
    const other = harness.startRun({ providerId: bId, runId: "b", cwd: root, prompt: "Synthetic fixture only" });
    expect((await other.finished).transcript).toContain("Second device");
    await catalog.disconnectHost(a.id);
    expect(catalog.discover().find((p) => p.id === bId)).toMatchObject({ enabled: true, defaultModel: "demo", driver: { available: true } });
    expect(() => harness.startRun({ providerId: "driver.mock", runId: "blocked", cwd: root, prompt: "Unused" })).toThrow();
    harness.cancelRun("a");
    expect((await running.finished).status).toBe("cancelled");
    release();
    await catalog.configureHost(b, second.url, "wrong-credential");
    expect(catalog.host(b.id)?.connectionStatus().status).toBe("error");
    expect(() => harness.startRun({ providerId: bId, runId: "no-fallback", cwd: root, prompt: "Unused" })).toThrow();
    await catalog.configureHost(b, second.url, secondToken);
    expect(catalog.discover().find((p) => p.id === bId)).toMatchObject({ enabled: true, defaultModel: "demo" });
    const restarted = new AgenticDriverRegistry(settings.read());
    expect(restarted.discover().find((p) => p.id === bId)?.driver?.available).toBe(false);
    expect(() => restarted.createAdapter(bId)!.startSession({ runId: "removed", cwd: root, prompt: "Unused" })).toThrow();
  } finally { release(); await first.close(); await second.close(); fs.rmSync(root, { recursive: true, force: true }); }
}, 20_000);
