import fs from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgenticClient } from "agenticdriver/client";
import { AgenticDriver, type ContextManifest, type RunRequest } from "agenticdriver";
import { mockProvider } from "agenticdriver/providers";
import { serve } from "agenticdriver/server";
import { AgentProviderSchema } from "@litagent/contracts";
import { AgenticDriverAdapter, AgenticDriverCatalog, agenticDriverCatalogFromEnvironment } from "./agenticdriver";
import { AgentProviderSettingsStore, type ProviderSelectedContext } from "./index";

const token = "litagent-driver-test-token-with-32-characters";
const directories: string[] = [];
let close: (() => Promise<void>) | undefined;
afterEach(async () => {
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

function selectedContext(): ProviderSelectedContext {
  return {
    prompt: "Answer from the attached paper snapshot.",
    sources: [{
      id: "paper-1", revision: "canonical-markdown-revision", title: "Optical study",
      text: "paperId: paper-1\n<!-- [[passage:paper-1:p1]] -->\nThe optical detector measures 3 μm."
    }],
  };
}

function manifestFor(request: RunRequest): ContextManifest[] {
  return (request.attachments ?? []).map((attachment) => {
    if (attachment.type !== "text") throw new Error("Expected inline text in the adapter fixture.");
    return {
      ...attachment.source, mediaType: attachment.mediaType, origin: "inline",
      bytes: Buffer.byteLength(attachment.text, "utf8"),
      sha256: createHash("sha256").update(attachment.text, "utf8").digest("hex"),
    };
  });
}

function manifestClient(change: (sources: ContextManifest[]) => ContextManifest[] | undefined): Pick<AgenticClient, "stream"> {
  return {
    async *stream(request) {
      const sources = change(manifestFor(request));
      yield {
        type: "run.completed", runId: "driver-run", sequence: 1, timestamp: new Date().toISOString(),
        result: {
          runId: "driver-run", provider: request.provider, model: request.model,
          text: "Proposed answer", usage: {}, steps: 1, finishReason: "stop",
          ...(sources === undefined ? {} : { sources }),
        },
      };
    },
  };
}

describe("AgenticDriver integration", () => {
  it("adds scoped catalog presentation through the existing environment factory", async () => {
    const driver = new AgenticDriver({ providers: [mockProvider()] });
    const server = await serve(driver, { port: 0, tokens: [{ token, subject: "researcher", providers: ["mock"] }] });
    close = server.close;
    vi.stubEnv("AGENTICDRIVER_URL", server.url);
    vi.stubEnv("AGENTICDRIVER_TOKEN", token);
    const identity = { hostId: "test-host", provider: "mock", accountId: "research-account", subject: "researcher" };
    const accountLimits = vi.fn(async (scope: typeof identity) => ({
      identity: scope, upstreamInstanceId: "private-quota-instance",
      snapshot: {
        displayName: "private quota catalog", fetchedAt: new Date().toISOString(), source: "api",
        resources: { daily: { label: "Daily tokens", used: 42, unit: "tokens" } },
      },
    }));
    const catalog = await agenticDriverCatalogFromEnvironment({}, {
      hostId: identity.hostId, subject: identity.subject, maxAgeMs: 300_000, accountLimits,
      bindingFor: (providerId) => providerId === "mock" ? { identity, accountLabel: "Research account" } : undefined,
    });
    const adapter = catalog.createAdapter("driver.mock")!;
    expect(accountLimits).toHaveBeenCalledExactlyOnceWith(identity);
    expect(adapter.provider.label).toBe("Offline demo (AgenticDriver)");
    expect(adapter.provider.driverCatalog).toMatchObject({
      provider: { providerId: "mock", account: { id: "research-account", label: "Research account" } },
      quota: { state: "fresh", resources: [{ used: 42, unit: "tokens" }] },
    });
    expect(adapter.provider.enabled).toBe(false);
    expect(JSON.stringify(adapter.provider)).not.toContain("private-quota-instance");
  });

  it("sends a copied paper revision and validates the real SDK manifest for marked UTF-8 content", async () => {
    const context = selectedContext();
    const original = structuredClone(context);
    let providerText = "";
    const driver = new AgenticDriver({ providers: [mockProvider((request) => {
      providerText = request.messages.filter((message) => message.role === "user").map((message) => message.content).join("\n");
      return { text: "The detector measures 3 μm [paper-1:p1]." };
    })] });
    const server = await serve(driver, { port: 0, tokens: [{ token, subject: "researcher", providers: ["mock"] }] });
    close = server.close;
    const adapter = new AgenticDriverAdapter(provider, "mock", new AgenticClient({ url: server.url, token }));
    const session = adapter.startSession({ cwd: workspace(), runId: "selected", prompt: "Legacy CLI prompt", selectedContext: context });
    context.sources[0]!.revision = "mutated-after-start";
    context.sources[0]!.text = "Unselected replacement";
    context.prompt = "Changed prompt";
    const result = await session.finished;
    expect(result.status).toBe("completed");
    expect(providerText).toContain(original.prompt);
    expect(providerText).toContain(JSON.stringify(original.sources[0]!.text));
    expect(providerText).not.toContain("Legacy CLI prompt");
    expect(providerText).not.toContain("Unselected replacement");
    const source = (result.events.find((event) => event.type === "run.completed")?.payload.sources as ContextManifest[])[0]!;
    expect(source.revision).toBe(original.sources[0]!.revision);
    expect(source.sha256).toBe(createHash("sha256").update(original.sources[0]!.text).digest("hex"));
    expect(source.bytes).toBe(Buffer.byteLength(original.sources[0]!.text));
    expect(source.bytes).toBeGreaterThan(original.sources[0]!.text.length);
    expect(source.sha256).not.toBe(source.revision);
  });

  const invalidManifests: Array<[string, (sources: ContextManifest[]) => ContextManifest[] | undefined]> = [
    ["missing", () => undefined],
    ["empty", () => []],
    ["extra", (sources) => [...sources, { ...sources[0]!, id: "unselected" }]],
    ["duplicate", (sources) => [sources[0]!, sources[0]!]],
    ["wrong ID", (sources) => [{ ...sources[0]!, id: "unselected" }]],
    ["wrong revision", (sources) => [{ ...sources[0]!, revision: "other-revision" }]],
    ["wrong digest", (sources) => [{ ...sources[0]!, sha256: "0".repeat(64) }]],
    ["wrong byte count", (sources) => [{ ...sources[0]!, bytes: sources[0]!.bytes + 1 }]],
    ["wrong media type", (sources) => [{ ...sources[0]!, mediaType: "text/plain" }]],
    ["wrong origin", (sources) => [{ ...sources[0]!, origin: "retrieval" }]],
    ["wrong title", (sources) => [{ ...sources[0]!, title: "Other study" }]],
    ["wrong location", (sources) => [{ ...sources[0]!, location: { documentId: "other-paper" } }]],
    ["unexpected URI", (sources) => [{ ...sources[0]!, uri: "app://other/paper" }]],
  ];
  it.each(invalidManifests)("rejects a %s source manifest before saving the proposed artifact", async (_label, change) => {
    const cwd = workspace();
    const outputPath = path.join(cwd, ".litagent/cache/provider-runs/manifest/answer.md");
    const adapter = new AgenticDriverAdapter(provider, "mock", manifestClient(change));
    const result = await adapter.startSession({ cwd, outputPath, runId: "manifest", prompt: "Q", selectedContext: selectedContext() }).finished;
    expect(result.status).toBe("failed");
    expect(result.failureClass).toBe("source_mismatch");
    expect(result.events.some((event) => event.type === "run.completed" || event.type === "artifact.written")).toBe(false);
    expect(result.artifacts).toEqual([]);
    expect(fs.existsSync(outputPath)).toBe(false);
  });

  it("accepts reordered manifests only when every selected source matches", async () => {
    const context = selectedContext();
    context.sources = [...context.sources, { ...context.sources[0]!, id: "paper-2" }];
    const adapter = new AgenticDriverAdapter(provider, "mock", manifestClient((sources) => sources.reverse()));
    const result = await adapter.startSession({ cwd: workspace(), runId: "reordered", prompt: "Q", selectedContext: context }).finished;
    expect(result.status).toBe("completed");
  });

  it.each(["dispatch", "completion"])("rejects app source revocation at %s before artifact output", async (phase) => {
    let current = phase !== "dispatch";
    let called = false;
    const client = manifestClient((sources) => { called = true; current = false; return sources; });
    const context = { ...selectedContext(), isCurrent: () => current };
    const cwd = workspace(), outputPath = path.join(cwd, ".litagent/cache/provider-runs/revoked/answer.md");
    const result = await new AgenticDriverAdapter(provider, "mock", client).startSession({
      cwd, outputPath, runId: "revoked", prompt: "Q", selectedContext: context,
    }).finished;
    expect(result.status).toBe("failed");
    expect(result.failureClass).toBe("source_changed");
    expect(called).toBe(phase === "completion");
    expect(fs.existsSync(outputPath)).toBe(false);
  });

  it("rejects unsupported inline selection sizes without dispatching a provider request", () => {
    const adapter = new AgenticDriverAdapter(provider, "mock", manifestClient(() => { throw new Error("must not dispatch"); }));
    const source = selectedContext().sources[0]!;
    expect(() => adapter.startSession({ cwd: workspace(), runId: "too-many", prompt: "Q", selectedContext: {
      prompt: "Q", sources: Array.from({ length: 17 }, (_, index) => ({ ...source, id: `paper-${index}` })),
    } })).toThrow("1–16");
    expect(() => adapter.startSession({ cwd: workspace(), runId: "too-large", prompt: "Q", selectedContext: {
      prompt: "Q", sources: [{ ...source, text: "文".repeat(90_000) }],
    } })).toThrow("inline byte budget");
    expect(adapter.listSessions()).toEqual([]);
  });
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
