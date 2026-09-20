import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgenticClient } from "agenticdriver/client";
import { AgenticDriver } from "agenticdriver";
import { mockProvider } from "agenticdriver/providers";
import { serve } from "agenticdriver/server";
import { AgentProviderSchema } from "@litagent/contracts";
import { AgenticDriverAdapter, AgenticDriverCatalog } from "./agenticdriver";
import { AgentProviderSettingsStore } from "./index";

const token = "litagent-driver-test-token-with-32-characters";
const directories: string[] = [];
let close: (() => Promise<void>) | undefined;
afterEach(async () => {
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
});
