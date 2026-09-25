import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AgenticClient } from "@agenticdriver/sdk/client";
import { DriverError, type ProviderInfo } from "@agenticdriver/sdk";
import { providerPresentation } from "@agenticdriver/sdk/catalog";
import {
  AgentProviderSchema,
  type AgentProvider,
  type AgentProviderSettings,
  type AgentProviderSettingsPatch,
  type DriverConnection,
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

/** Application-owned settings validation, independent of SDK package identity. */
export class DriverSettingsError extends Error {
  constructor(
    readonly code:
      "INVALID_SETTINGS" | "PROVIDER_UNAVAILABLE" | "MODEL_NOT_ALLOWED",
    message: string,
  ) {
    super(message);
    this.name = "DriverSettingsError";
  }
}

/** Scoped driver inventory stays live while cached adapters retain active sessions. */
export class AgenticDriverCatalog extends AgentProviderCatalog {
  private driverSettings: Record<string, AgentProviderSettings>;
  private readonly known = new Map<string, ProviderInfo>();
  private visible = new Set<string>();
  private pendingRefresh: Promise<void> | undefined;
  private connection: DriverConnection;
  private localProviders: AgentProvider[] | undefined;

  constructor(
    private readonly client: AgenticClient | null,
    instances: ProviderInfo[],
    settings: Record<string, AgentProviderSettings> = {},
    connection?: DriverConnection,
  ) {
    super(undefined, settings);
    this.driverSettings = settings;
    this.replaceInventory(instances);
    this.connection = connection ?? {
      configured: client !== null,
      endpoint: null,
      status: client ? "ready" : "unconfigured",
      code: client ? "CONNECTED" : "NOT_CONFIGURED",
      message: client
        ? "The driver connection is available."
        : "Configure AGENTICDRIVER_URL and AGENTICDRIVER_TOKEN on the server to connect a driver.",
      checkedAt: client ? new Date().toISOString() : null,
      refreshing: false,
    };
  }
  private replaceInventory(instances: ProviderInfo[]): void {
    this.visible = new Set(instances.map((info) => info.id));
    for (const info of instances) this.known.set(info.id, info);
  }
  connectionStatus(): DriverConnection {
    return {
      ...this.connection,
      refreshing: this.pendingRefresh !== undefined,
    };
  }
  /** Read-only discovery; never starts inference or changes explicit enablement. */
  refresh(): Promise<void> {
    if (!this.client) return Promise.resolve();
    if (this.pendingRefresh) return this.pendingRefresh;
    this.pendingRefresh = Promise.resolve()
      .then(async () => {
        try {
          // Each SDK discovery request has its own bounded I/O timeout. Runs do not.
          const [, instances] = await Promise.all([
            this.client!.protocol(),
            this.client!.providers({ refresh: true }),
          ]);
          this.replaceInventory(instances);
          this.connection = {
            ...this.connection,
            status: "ready",
            code: "CONNECTED",
            message:
              "Driver catalog refreshed. Enable an instance and select its model to run a workflow.",
            checkedAt: new Date().toISOString(),
          };
        } catch (error) {
          const failure = driverFailure(error);
          this.connection = {
            ...this.connection,
            status: "error",
            code: failure.code,
            message: failure.message,
            checkedAt: new Date().toISOString(),
          };
        }
      })
      .finally(() => {
        this.pendingRefresh = undefined;
      });
    return this.pendingRefresh;
  }
  refreshLocalProviders(): void {
    this.localProviders = undefined;
  }
  override setSettings(settings: Record<string, AgentProviderSettings>): void {
    const local = (value: Record<string, AgentProviderSettings>) =>
      JSON.stringify(
        Object.entries(value).filter(([id]) => !id.startsWith("driver.")),
      );
    if (local(settings) !== local(this.driverSettings))
      this.refreshLocalProviders();
    super.setSettings(settings);
    this.driverSettings = settings;
  }
  override discover(): AgentProvider[] {
    const ids = new Set([
      ...this.known.keys(),
      ...Object.keys(this.driverSettings)
        .filter((id) => id.startsWith("driver."))
        .map((id) => id.slice(7)),
    ]);
    this.localProviders ??= super.discover();
    return [
      ...this.localProviders,
      ...[...ids].map((id) => this.describeInstance(id)),
    ];
  }
  private describeInstance(id: string): AgentProvider {
    const info = this.known.get(id);
    const settings = this.driverSettings[`driver.${id}`];
    const present = this.connection.status === "ready" && this.visible.has(id);
    const health = info?.health;
    const available =
      present &&
      health?.status !== "unauthenticated" &&
      health?.status !== "unavailable" &&
      health?.code !== "CLI_UPGRADE_REQUIRED";
    const presentation = info ? providerPresentation(info) : null;
    const authStatus = !present
      ? "unavailable"
      : health?.status === "ready"
        ? "authenticated"
        : health?.status === "unauthenticated"
          ? "unauthenticated"
          : health?.status === "unavailable"
            ? "unavailable"
            : "unknown";
    const models = info?.models ?? [
      ...new Set([
        ...(info?.modelCatalog?.models ?? []),
        ...(settings?.customModels ?? []),
        ...(settings?.defaultModel ? [settings.defaultModel] : []),
      ]),
    ];
    const message = !present
      ? this.connection.status === "error"
        ? this.connection.message
        : "This instance is no longer in the permitted driver catalog. Refresh or check its host configuration."
      : authStatus === "unauthenticated"
        ? "Sign in or update this provider's credentials on the driver host, then refresh."
        : !available
          ? "The provider is unavailable. Check its host installation, permissions and account, then refresh."
          : authStatus === "authenticated"
            ? "The host reports this provider ready. Select an explicit model."
            : "The driver is reachable; provider authentication has not been verified. Select an explicit model; the host checks access when a run starts.";
    return AgentProviderSchema.parse({
      id: `driver.${id}`,
      label: `${info?.name ?? id} (AgenticDriver)`,
      command: "",
      installed: true,
      enabled: settings?.enabled ?? false,
      connected: available && (settings?.connected ?? false),
      authStatus,
      capabilities: [
        "text",
        "research",
        ...(info?.capabilities.textStreaming ? ["stream"] : []),
      ],
      defaultModel: settings?.defaultModel ?? null,
      models,
      customModels:
        info?.models === undefined ? (settings?.customModels ?? []) : [],
      version: "agenticdriver.v1",
      connectCommand: null,
      lastCheckedAt: this.connection.checkedAt,
      driver: {
        instanceId: id,
        vendor: info?.vendor ?? "unknown",
        authMode: info?.authMode ?? "unknown",
        available,
        restrictedModels: info?.models !== undefined,
        healthCode: !present
          ? this.connection.status === "error"
            ? this.connection.code
            : "INSTANCE_UNAVAILABLE"
          : (health?.code ?? "AUTH_UNVERIFIED"),
        message,
        accountLabel: presentation?.accountLabel ?? "Account not linked",
        iconText:
          presentation?.icon.kind === "fallback" ? presentation.icon.text : "?",
      },
    });
  }
  validateSettings(
    providerId: string,
    patch: AgentProviderSettingsPatch,
  ): void {
    if (!providerId.startsWith("driver.")) return;
    const provider = this.describeInstance(providerId.slice(7));
    if (patch.command !== undefined && patch.command !== "")
      throw new DriverSettingsError(
        "INVALID_SETTINGS",
        "Driver instances do not accept local command paths.",
      );
    if (patch.enabled && !provider.driver!.available)
      throw new DriverSettingsError(
        "PROVIDER_UNAVAILABLE",
        provider.driver!.message,
      );
    if (
      provider.driver!.restrictedModels &&
      ((patch.defaultModel != null &&
        !provider.models.includes(patch.defaultModel)) ||
        patch.customModels?.some((model) => !provider.models.includes(model)))
    )
      throw new DriverSettingsError(
        "MODEL_NOT_ALLOWED",
        "Select an exact model ID permitted by this driver instance.",
      );
  }
  override definition(providerId: string): ProviderDefinition | null {
    if (!providerId.startsWith("driver.")) return super.definition(providerId);
    // Even a removed/unknown driver ID stays an explicit driver selection. Workflows
    // must not silently fall through to their local heuristic or another provider.
    const provider = this.describeInstance(providerId.slice(7));
    return {
      id: providerId,
      label: provider.label,
      command: "",
      versionArgs: [],
      capabilities: provider.capabilities,
      runArgs: () => [],
      connectCommand: "",
      models: provider.models,
      defaultModel: provider.defaultModel,
    };
  }
  override createAdapter(providerId: string): ProviderAdapter | null {
    if (!providerId.startsWith("driver."))
      return super.createAdapter(providerId);
    const id = providerId.slice(7);
    return new AgenticDriverAdapter(
      this.describeInstance(id),
      id,
      this.client ?? {
        async *stream() {
          throw new DriverError(
            "PROVIDER_UNAVAILABLE",
            "Configure the driver connection before starting a workflow.",
          );
        },
      },
      () => this.describeInstance(id),
    );
  }
}

export async function agenticDriverCatalogFromEnvironment(
  settings: Record<string, AgentProviderSettings> = {},
): Promise<AgenticDriverCatalog> {
  const url = process.env.AGENTICDRIVER_URL,
    token = process.env.AGENTICDRIVER_TOKEN;
  if (!url && !token) return new AgenticDriverCatalog(null, [], settings);
  let client: AgenticClient;
  try {
    if (!url || !token) throw new Error("Incomplete configuration");
    client = new AgenticClient({ url, token });
  } catch {
    return new AgenticDriverCatalog(null, [], settings, {
      configured: true,
      endpoint: null,
      status: "error",
      code: "CONFIGURATION_REQUIRED",
      message:
        "Set a valid HTTPS (or loopback HTTP) AGENTICDRIVER_URL and driver bearer token in AGENTICDRIVER_TOKEN on the server, then restart it.",
      checkedAt: null,
      refreshing: false,
    });
  }
  const catalog = new AgenticDriverCatalog(client, [], settings, {
    configured: true,
    endpoint: new URL(url!).origin,
    status: "error",
    code: "DISCOVERY_PENDING",
    message: "Checking the configured driver connection.",
    checkedAt: null,
    refreshing: false,
  });
  await catalog.refresh();
  return catalog;
}

/** Fixed public errors: upstream response bodies/credentials never become UI/log messages. */
export function driverFailure(error: unknown): {
  code: string;
  message: string;
  failureClass: ProviderFailureClass;
} {
  const code = error instanceof DriverError ? error.code : "DRIVER_UNREACHABLE";
  if (
    [
      "UNAUTHORIZED",
      "AUTH_REQUIRED",
      "PROVIDER_AUTH",
      "CLI_AUTH_REQUIRED",
    ].includes(code)
  )
    return {
      code,
      message:
        "Authentication failed. Check the server's driver token and the selected account on the driver host, then refresh.",
      failureClass: "auth",
    };
  if (
    [
      "FORBIDDEN",
      "MODEL_NOT_ALLOWED",
      "UNKNOWN_PROVIDER",
      "APPROVAL_REQUIRED",
    ].includes(code)
  )
    return {
      code,
      message:
        "This instance or model is not permitted. Refresh the scoped catalog and select an allowed model.",
      failureClass: "permission",
    };
  if (["RATE_LIMITED", "BUSY"].includes(code))
    return {
      code,
      message: "The driver or provider is busy. Wait before retrying.",
      failureClass: "rate_limit",
    };
  if (["CANCELLED", "TIMEOUT", "IDLE_TIMEOUT"].includes(code))
    return {
      code,
      message:
        code === "CANCELLED"
          ? "The run was cancelled."
          : "The run stopped under its configured inactivity policy.",
      failureClass: "cancelled",
    };
  if (
    [
      "UNSUPPORTED_PROTOCOL_VERSION",
      "INVALID_RESPONSE",
      "INVALID_STREAM",
      "INCOMPLETE_STREAM",
    ].includes(code)
  )
    return {
      code,
      message:
        "The driver returned an incompatible or incomplete response. Check the host version and connection.",
      failureClass: "unknown",
    };
  return {
    code: "DRIVER_UNREACHABLE",
    message:
      "Could not use the driver. Check the host address, HTTPS certificate, network and provider configuration, then refresh.",
    failureClass: "unknown",
  };
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
    if (!current.enabled)
      throw new DriverError(
        "PROVIDER_DISABLED",
        "Enable this AgenticDriver provider before running a workflow.",
      );
    if (current.driver && !current.driver.available)
      throw new DriverError("PROVIDER_UNAVAILABLE", current.driver.message);
    if (!model)
      throw new Error(
        "Select an explicit model for this AgenticDriver provider.",
      );
    if (current.driver?.restrictedModels && !current.models.includes(model))
      throw new DriverError(
        "MODEL_NOT_ALLOWED",
        "Select an exact model ID permitted by this driver instance.",
      );
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
        try {
          controller.signal.throwIfAborted();
          session.status = "running";
          emit("run.started", "AgenticDriver session started", { sessionId });
          for await (const event of this.client.stream(
            {
              provider: this.instanceId,
              model,
              input: input.prompt,
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
              throw new DriverError(
                event.error.code,
                event.error.message,
                event.error.retryable,
              );
            }
            if (event.type === "run.completed") {
              controller.signal.throwIfAborted();
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
              });
            }
          }
          if (session.status !== "completed")
            throw new Error("The driver ended without a result.");
        } catch (error) {
          const failure = driverFailure(error);
          session.status = controller.signal.aborted ? "cancelled" : "failed";
          failureClass = controller.signal.aborted
            ? "cancelled"
            : failure.failureClass;
          emit(
            "run.failed",
            session.status === "cancelled"
              ? "AgenticDriver run cancelled"
              : failure.message,
            {
              failureClass,
              code: controller.signal.aborted ? "CANCELLED" : failure.code,
            },
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
