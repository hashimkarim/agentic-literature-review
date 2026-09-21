import { EventEmitter } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { AgenticClient } from "agenticdriver/client";
import { ContextAttachmentSchema, ContextManifestSchema, type ContextManifest, type ProviderInfo } from "agenticdriver";
import {
  AgentProviderSchema,
  type AgentProvider,
  type AgentProviderSettings,
  type NormalizedRunEvent,
} from "@litagent/contracts";
import {
  AgentProviderCatalog,
  createRunEvent,
  type ProviderAdapter,
  type ProviderDefinition,
  type ProviderRunResult,
  type ProviderRunStartInput,
  type ProviderRuntimeSession,
  type ProviderFailureClass,
} from "./index";

/** Adds scoped driver instances to the existing provider catalog and workflow lifecycle. */
export class AgenticDriverCatalog extends AgentProviderCatalog {
  private driverSettings: Record<string, AgentProviderSettings>;
  constructor(
    private readonly client: AgenticClient,
    private readonly instances: ProviderInfo[],
    settings: Record<string, AgentProviderSettings> = {},
  ) {
    super(undefined, settings);
    this.driverSettings = settings;
  }
  override setSettings(settings: Record<string, AgentProviderSettings>): void {
    super.setSettings(settings);
    this.driverSettings = settings;
  }
  override discover(): AgentProvider[] {
    return [
      ...super.discover(),
      ...this.instances.map((info) => this.describeInstance(info)),
    ];
  }
  private describeInstance(info: ProviderInfo): AgentProvider {
    const settings = this.driverSettings[`driver.${info.id}`];
    return AgentProviderSchema.parse({
      id: `driver.${info.id}`,
      label: `${info.name} (AgenticDriver)`,
      command: "",
      installed: true,
      enabled: settings?.enabled ?? false,
      connected: true,
      authStatus: "authenticated",
      capabilities: ["text", "stream", "research"],
      defaultModel: settings?.defaultModel ?? info.models?.[0] ?? null,
      models: [
        ...new Set([...(info.models ?? []), ...(settings?.customModels ?? [])]),
      ],
      customModels: settings?.customModels ?? [],
      version: "agenticdriver.v1",
      connectCommand: null,
    });
  }
  override definition(providerId: string): ProviderDefinition | null {
    const info = this.instances.find((p) => `driver.${p.id}` === providerId);
    if (!info) return super.definition(providerId);
    return {
      id: providerId,
      label: info.name,
      command: "",
      versionArgs: [],
      capabilities: ["text", "research"],
      runArgs: () => [],
      connectCommand: "",
      models: info.models ?? [],
      defaultModel: info.models?.[0] ?? null,
    };
  }
  override createAdapter(providerId: string): ProviderAdapter | null {
    const info = this.instances.find((p) => `driver.${p.id}` === providerId);
    if (!info) return super.createAdapter(providerId);
    return new AgenticDriverAdapter(
      this.describeInstance(info),
      info.id,
      this.client,
      () => this.describeInstance(info),
    );
  }
}

export async function agenticDriverCatalogFromEnvironment(
  settings: Record<string, AgentProviderSettings> = {},
): Promise<AgentProviderCatalog> {
  const url = process.env.AGENTICDRIVER_URL,
    token = process.env.AGENTICDRIVER_TOKEN;
  if (!url && !token) return new AgentProviderCatalog(undefined, settings);
  if (!url || !token)
    throw new Error("Set both AGENTICDRIVER_URL and AGENTICDRIVER_TOKEN.");
  const client = new AgenticClient({ url, token });
  return new AgenticDriverCatalog(client, await client.providers(), settings);
}

function snapshotContext(input: ProviderRunStartInput) {
  const selected = input.selectedContext;
  if (!selected) return { attachments: undefined, manifests: [] as ContextManifest[] };
  if (selected.sources.length === 0 || selected.sources.length > 16)
    throw new Error("AgenticDriver context requires 1–16 supplied papers. Select a smaller source scope.");
  const attachments = selected.sources.map((source) => {
    const attachment = ContextAttachmentSchema.parse({
      type: "text",
      mediaType: "text/markdown",
      source: {
        id: source.id,
        revision: source.revision,
        title: source.title.slice(0, 256),
        location: { documentId: source.id },
      },
      text: source.text,
    });
    if (attachment.type !== "text") throw new Error("Expected a Markdown snapshot.");
    return attachment;
  });
  const manifests: ContextManifest[] = attachments.map(({ source, text, mediaType }) => ({
    ...source,
    mediaType,
    bytes: Buffer.byteLength(text, "utf8"),
    sha256: createHash("sha256").update(text, "utf8").digest("hex"),
    origin: "inline",
  }));
  if (new Set(manifests.map((source) => source.id)).size !== manifests.length)
    throw new Error("Selected context must contain each paper exactly once.");
  if (manifests.some((source) => source.bytes > 256 * 1024) ||
      manifests.reduce((sum, source) => sum + source.bytes, 0) > 512 * 1024)
    throw new Error("Selected Markdown exceeds AgenticDriver's inline byte budget. Select a smaller source scope.");
  return { attachments, manifests };
}

function matchesContextManifest(actual: unknown, expected: ContextManifest[]): boolean {
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

export class AgenticDriverAdapter implements ProviderAdapter {
  private readonly sessions = new Map<
    string,
    { session: ProviderRuntimeSession; controller: AbortController }
  >();
  constructor(
    readonly provider: AgentProvider,
    private readonly instanceId: string,
    private readonly client: Pick<AgenticClient, "stream">,
    private readonly currentProvider?: () => AgentProvider,
  ) {}
  startSession(input: ProviderRunStartInput): ProviderRuntimeSession {
    const current = this.currentProvider?.() ?? this.provider;
    const model = input.model ?? current.defaultModel;
    if (!model)
      throw new Error(
        "Select an explicit model for this AgenticDriver provider.",
      );
    if (!current.enabled)
      throw new Error(
        "Enable this AgenticDriver provider before running a workflow.",
      );
    // Copy source metadata and text now, before a caller can mutate the selection.
    const { attachments, manifests } = snapshotContext(input);
    const prompt = input.selectedContext?.prompt ?? input.prompt;
    const isContextCurrent = input.selectedContext?.isCurrent;
    const controller = new AbortController(),
      events = new EventEmitter(),
      captured: NormalizedRunEvent[] = [];
    const sessionId = `session_${randomUUID()}`;
    let resolveFinished!: (result: ProviderRunResult) => void;
    const session: ProviderRuntimeSession = {
      id: sessionId,
      runId: input.runId,
      providerId: this.provider.id,
      cwd: input.cwd,
      prompt: input.prompt,
      status: "starting",
      process: null,
      events,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      finished: new Promise((resolve) => {
        resolveFinished = resolve;
      }),
    };
    this.sessions.set(sessionId, { session, controller });
    const emit = (
      type: NormalizedRunEvent["type"],
      message: string,
      payload: Record<string, unknown> = {},
    ) => {
      const event = createRunEvent({
        runId: input.runId,
        providerId: this.provider.id,
        type,
        message,
        payload,
      });
      captured.push(event);
      session.updatedAt = event.timestamp;
      try {
        input.onEvent?.(event);
        events.emit("event", event);
      } catch {
        /* Consumers must not strand a run. */
      }
    };
    queueMicrotask(() => {
      void (async () => {
        let transcript = "",
          failureClass: ProviderFailureClass | null = null;
        const artifacts: string[] = [];
        const checkCurrentContext = () => {
          if (isContextCurrent && !isContextCurrent()) {
            failureClass = "source_changed";
            throw new Error("Selected paper access or Markdown changed during the run.");
          }
        };
        try {
          controller.signal.throwIfAborted();
          checkCurrentContext();
          session.status = "running";
          emit("run.started", "AgenticDriver session started", { sessionId });
          for await (const event of this.client.stream(
            {
              provider: this.instanceId,
              model,
              input: prompt,
              ...(attachments ? { attachments } : {}),
              instructions:
                "Use only supplied research context. Return the proposed artifact as your final response; the application saves it locally. Cite supplied paper and passage identifiers. Do not invent citations or claim to have read local files.",
              metadata: { app: "literature-review", runId: input.runId },
            },
            { signal: controller.signal },
          )) {
            session.updatedAt = event.timestamp;
            if (event.type === "text.delta") {
              transcript += event.text;
              emit("model.delta", event.text);
            }
            if (event.type === "run.failed" || event.type === "run.cancelled") {
              failureClass = classifyDriverFailure(event.error.code);
              throw new Error(event.error.message);
            }
            if (event.type === "run.completed") {
              controller.signal.throwIfAborted();
              if (!matchesContextManifest(event.result.sources, manifests)) {
                failureClass = "source_mismatch";
                throw new Error("AgenticDriver returned a different source manifest.");
              }
              checkCurrentContext();
              transcript = event.result.text;
              if (event.result.finishReason === "length")
                throw new Error("The provider reached its output limit.");
              if (input.outputPath) {
                const output = path.resolve(input.outputPath),
                  allowed = path.resolve(
                    input.cwd,
                    ".litagent/cache/provider-runs",
                  );
                if (!output.startsWith(allowed + path.sep))
                  throw new Error(
                    "Driver artifacts must stay in the provider-run cache.",
                  );
                fs.mkdirSync(path.dirname(output), { recursive: true });
                fs.writeFileSync(output, transcript, {
                  encoding: "utf8",
                  mode: 0o600,
                });
                artifacts.push(output);
                emit("artifact.written", "Research proposal saved", {
                  path: output,
                });
              }
              session.status = "completed";
              emit("run.completed", "AgenticDriver run completed", {
                sessionId,
                usage: event.result.usage,
                ...(attachments ? { sources: manifests } : {}),
              });
            }
          }
          if (session.status !== "completed")
            throw new Error("The driver ended without a result.");
        } catch {
          session.status = controller.signal.aborted ? "cancelled" : "failed";
          failureClass = controller.signal.aborted
            ? "cancelled"
            : (failureClass ?? "unknown");
          emit(
            "run.failed",
            session.status === "cancelled"
              ? "AgenticDriver run cancelled"
              : "AgenticDriver failed to produce a complete research artifact",
            { failureClass },
          );
        } finally {
          this.sessions.delete(sessionId);
          resolveFinished({
            sessionId,
            runId: input.runId,
            providerId: this.provider.id,
            status: session.status,
            exitCode: session.status === "completed" ? 0 : null,
            signal: null,
            failureClass,
            transcript,
            events: captured,
            artifacts,
          });
        }
      })();
    });
    return session;
  }
  interrupt(sessionId: string): void {
    this.sessions.get(sessionId)?.controller.abort();
  }
  stopSession(sessionId: string): void {
    this.interrupt(sessionId);
  }
  listSessions(): ProviderRuntimeSession[] {
    return [...this.sessions.values()].map((value) => value.session);
  }
}
function classifyDriverFailure(code: string): ProviderFailureClass {
  if (["UNAUTHORIZED", "AUTH_REQUIRED", "PROVIDER_AUTH"].includes(code))
    return "auth";
  if (["FORBIDDEN", "APPROVAL_REQUIRED"].includes(code)) return "permission";
  if (["RATE_LIMITED", "BUSY"].includes(code)) return "rate_limit";
  if (["CANCELLED", "TIMEOUT", "IDLE_TIMEOUT"].includes(code))
    return "cancelled";
  return "unknown";
}
