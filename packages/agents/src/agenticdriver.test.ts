import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgenticClient } from "@agenticdriver/sdk/client";
import { AgenticDriver, DriverError } from "@agenticdriver/sdk";
import { mockProvider } from "@agenticdriver/sdk/providers";
import { serve } from "@agenticdriver/sdk/server";
import { AgentProviderSchema } from "@litagent/contracts";
import {
  AgenticDriverAdapter,
  AgenticDriverCatalog,
  agenticDriverCatalogFromEnvironment,
} from "./agenticdriver";
import { AgentHarness, AgentProviderSettingsStore } from "./index";

const token = "litagent-driver-test-token-with-32-characters";
const directories: string[] = [];
let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await close?.();
  close = undefined;
  for (const dir of directories.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});
function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-driver-"));
  directories.push(dir);
  return dir;
}
const provider = AgentProviderSchema.parse({
  id: "driver.mock",
  label: "Driver mock",
  command: "",
  installed: true,
  enabled: true,
  connected: true,
  authStatus: "authenticated",
  defaultModel: "demo",
});

describe("AgenticDriver integration", () => {
  it("normalizes remote events, usage and proposed artifacts into the existing lifecycle", async () => {
    const driver = new AgenticDriver({
      providers: [
        mockProvider(() => ({
          text: "Evidence supports the claim [paper-1:p1].",
          usage: { inputTokens: 5, outputTokens: 3 },
        })),
      ],
    });
    const server = await serve(driver, {
      port: 0,
      tokens: [{ token, subject: "researcher", providers: ["mock"] }],
    });
    close = server.close;
    const client = new AgenticClient({ url: server.url, token });
    const catalog = new AgenticDriverCatalog(client, await client.providers());
    expect(catalog.definition("driver.mock")?.models).toEqual(["demo"]);
    const adapter = new AgenticDriverAdapter(provider, "mock", client);
    const cwd = workspace(),
      outputPath = path.join(
        cwd,
        ".litagent/cache/provider-runs/run-1/answer.md",
      );
    const result = await adapter.startSession({
      cwd,
      outputPath,
      prompt: "Question with supplied evidence",
      runId: "run-1",
    }).finished;
    expect(result.status).toBe("completed");
    expect(result.transcript).toContain("[paper-1:p1]");
    expect(fs.readFileSync(outputPath, "utf8")).toBe(result.transcript);
    expect(
      result.events.some((e) => e.type === "run.completed" && e.payload.usage),
    ).toBe(true);
    expect(adapter.listSessions()).toHaveLength(0);
  });
  it("cancels through the normal interrupt lifecycle", async () => {
    const client: Pick<AgenticClient, "stream"> = {
      async *stream(_request, options) {
        await new Promise((_resolve, reject) => {
          const signal = options!.signal!;
          if (signal.aborted) reject(signal.reason);
          else
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
        });
      },
    };
    const adapter = new AgenticDriverAdapter(provider, "mock", client);
    const session = adapter.startSession({
      cwd: workspace(),
      prompt: "Q",
      runId: "run-2",
    });
    adapter.interrupt(session.id);
    expect((await session.finished).status).toBe("cancelled");
    expect(adapter.listSessions()).toHaveLength(0);
  });
  it("does not mark a truncated artifact complete", async () => {
    const driver = new AgenticDriver({
      providers: [
        mockProvider(() => ({ text: "Partial", finishReason: "length" })),
      ],
    });
    const server = await serve(driver, {
      port: 0,
      tokens: [{ token, subject: "researcher", providers: ["mock"] }],
    });
    close = server.close;
    const adapter = new AgenticDriverAdapter(
      provider,
      "mock",
      new AgenticClient({ url: server.url, token }),
    );
    const result = await adapter.startSession({
      cwd: workspace(),
      prompt: "Q",
      runId: "run-3",
    }).finished;
    expect(result.status).toBe("failed");
    expect(result.artifacts).toEqual([]);
  });
  it("requires explicit enablement", () => {
    const client = new AgenticClient({ url: "http://127.0.0.1:7433", token });
    expect(() =>
      new AgenticDriverAdapter(
        { ...provider, enabled: false },
        "mock",
        client,
      ).startSession({ cwd: workspace(), prompt: "Q", runId: "run-4" }),
    ).toThrow("Enable");
  });
  it("persists discovered provider settings and honors disablement in a cached adapter", () => {
    const client = new AgenticClient({ url: "http://127.0.0.1:7433", token });
    const catalog = new AgenticDriverCatalog(client, [mockProvider().info]);
    const settings = new AgentProviderSettingsStore(
      path.join(workspace(), "provider-settings.json"),
    );
    const definition = catalog.definition("driver.mock")!;
    settings.patch("driver.mock", { enabled: true }, [definition]);
    catalog.setSettings(settings.read());
    const adapter = catalog.createAdapter("driver.mock")!;
    expect(adapter.provider.enabled).toBe(true);
    settings.patch("driver.mock", { enabled: false }, [definition]);
    catalog.setSettings(settings.read());
    expect(() =>
      adapter.startSession({ cwd: workspace(), prompt: "Q", runId: "run-5" }),
    ).toThrow("Enable");
  });

  it("refreshes scoped inventory without selecting models or claiming verified auth", async () => {
    const server = await serve(
      new AgenticDriver({ providers: [mockProvider()] }),
      {
        port: 0,
        tokens: [{ token, subject: "researcher", providers: ["mock"] }],
      },
    );
    close = server.close;
    const client = new AgenticClient({ url: server.url, token });
    const catalog = new AgenticDriverCatalog(client, []);
    const discover = vi.spyOn(client, "providers");
    await Promise.all([catalog.refresh(), catalog.refresh()]);
    expect(discover).toHaveBeenCalledTimes(1);
    expect(discover).toHaveBeenCalledWith({ refresh: true });
    const instance = catalog.discover().find((p) => p.id === "driver.mock")!;
    expect(instance).toMatchObject({
      enabled: false,
      defaultModel: null,
      authStatus: "unknown",
      driver: {
        available: true,
        restrictedModels: true,
        accountLabel: "Account not linked",
      },
    });
    expect(() =>
      catalog.validateSettings(instance.id, { defaultModel: "made-up-model" }),
    ).toThrow(/permitted/);
    expect(() =>
      catalog.validateSettings(instance.id, {
        customModels: ["made-up-model"],
      }),
    ).toThrow(/permitted/);
    expect(() =>
      catalog.validateSettings(instance.id, { command: "/bin/sh" }),
    ).toThrow(/command/);
  });

  it("keeps active runs while removed catalog entries block new work in cached adapters", async () => {
    let release!: () => void, started!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const server = await serve(
      new AgenticDriver({
        providers: [
          mockProvider(async () => {
            started();
            await pending;
            return { text: "Completed before refresh" };
          }),
        ],
      }),
      {
        port: 0,
        tokens: [{ token, subject: "researcher", providers: ["mock"] }],
      },
    );
    close = server.close;
    const client = new AgenticClient({ url: server.url, token });
    const catalog = new AgenticDriverCatalog(client, await client.providers());
    const settings = new AgentProviderSettingsStore(
      path.join(workspace(), "settings.json"),
    );
    settings.patch("driver.mock", { enabled: true, defaultModel: "demo" }, [
      catalog.definition("driver.mock")!,
    ]);
    catalog.setSettings(settings.read());
    const harness = new AgentHarness({ catalog });
    const session = harness.startRun({
      providerId: "driver.mock",
      runId: "active",
      cwd: workspace(),
      prompt: "Q",
    });
    await entered;
    try {
      vi.spyOn(client, "providers").mockResolvedValue([]);
      await catalog.refresh();
      expect(
        catalog.discover().find((p) => p.id === "driver.mock"),
      ).toMatchObject({
        enabled: true,
        defaultModel: "demo",
        driver: { available: false },
      });
      expect(harness.listSessions()).toHaveLength(1);
      expect(() =>
        harness.startRun({
          providerId: "driver.mock",
          runId: "new",
          cwd: workspace(),
          prompt: "Q",
        }),
      ).toThrow(/permitted driver catalog/);
      release();
      expect((await session.finished).status).toBe("completed");
      expect(catalog.definition("driver.missing")).not.toBeNull();
    } finally {
      release();
    }
  });

  it("rechecks changed model allowlists in cached adapters without choosing a replacement", async () => {
    const client = new AgenticClient({ url: "http://127.0.0.1:7433", token });
    const catalog = new AgenticDriverCatalog(client, [mockProvider().info]);
    const settings = new AgentProviderSettingsStore(
      path.join(workspace(), "settings.json"),
    );
    settings.patch("driver.mock", { enabled: true, defaultModel: "demo" }, [
      catalog.definition("driver.mock")!,
    ]);
    catalog.setSettings(settings.read());
    const adapter = catalog.createAdapter("driver.mock")!;
    vi.spyOn(client, "protocol").mockResolvedValue({
      protocol: "agenticdriver",
      version: "1.0",
      supportedVersions: ["1.0"],
      features: [],
    });
    vi.spyOn(client, "providers").mockResolvedValue([
      { ...mockProvider().info, models: ["changed"] },
    ]);
    const run = vi.spyOn(client, "stream");
    await catalog.refresh();
    expect(
      catalog.discover().find((p) => p.id === "driver.mock")?.defaultModel,
    ).toBe("demo");
    expect(() =>
      adapter.startSession({
        cwd: workspace(),
        prompt: "Q",
        runId: "stale-model",
      }),
    ).toThrow(/permitted/);
    expect(run).not.toHaveBeenCalled();
  });

  it("keeps startup recoverable and hides credentials when discovery fails", async () => {
    const server = await serve(
      new AgenticDriver({ providers: [mockProvider()] }),
      {
        port: 0,
        tokens: [{ token, subject: "researcher", providers: ["mock"] }],
      },
    );
    close = server.close;
    vi.stubEnv("AGENTICDRIVER_URL", server.url);
    vi.stubEnv("AGENTICDRIVER_TOKEN", "private-invalid-credential");
    const catalog = await agenticDriverCatalogFromEnvironment();
    expect(catalog.connectionStatus()).toMatchObject({
      status: "error",
      code: "UNAUTHORIZED",
    });
    expect(JSON.stringify(catalog.connectionStatus())).not.toContain(
      "private-invalid-credential",
    );
    vi.stubEnv("AGENTICDRIVER_URL", "https://user:private-secret@example.com");
    const invalid = await agenticDriverCatalogFromEnvironment();
    expect(invalid.connectionStatus()).toMatchObject({
      status: "error",
      endpoint: null,
      code: "CONFIGURATION_REQUIRED",
    });
    expect(JSON.stringify(invalid.connectionStatus())).not.toContain(
      "private-secret",
    );
  });

  it("maps typed HTTP failures through the existing lifecycle without logging upstream secrets", async () => {
    const adapter = new AgenticDriverAdapter(provider, "mock", {
      async *stream() {
        throw new DriverError(
          "UNAUTHORIZED",
          "private-credential-in-upstream-body",
        );
      },
    });
    const result = await adapter.startSession({
      cwd: workspace(),
      prompt: "Q",
      runId: "http-auth",
    }).finished;
    expect(result).toMatchObject({
      status: "failed",
      failureClass: "auth",
      artifacts: [],
    });
    expect(JSON.stringify(result)).not.toContain("private-credential");
    expect(result.events.at(-1)?.message).toContain("Authentication failed");
  });
});
