import { EventEmitter } from "node:events";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  AgentProviderSchema,
  AgentProviderSettingsPatchSchema,
  AgentProviderSettingsSchema,
  NormalizedRunEventSchema,
  type AgentProvider,
  type AgentProviderSettings,
  type AgentProviderSettingsPatch,
  type NormalizedRunEvent
} from "@litagent/contracts";

export type AgentRunStatus = "starting" | "running" | "completed" | "failed" | "cancelled";

export type ProviderFailureClass =
  | "auth"
  | "rate_limit"
  | "permission"
  | "command_not_found"
  | "cancelled"
  | "spawn_error"
  | "process_exit"
  | "source_mismatch"
  | "source_changed"
  | "unknown";

export interface ProviderRunResult {
  sessionId: string;
  runId: string;
  providerId: string;
  status: AgentRunStatus;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  failureClass: ProviderFailureClass | null;
  transcript: string;
  events: NormalizedRunEvent[];
  artifacts: string[];
}

export interface ProviderRuntimeSession {
  id: string;
  runId: string;
  providerId: string;
  cwd: string;
  prompt: string;
  status: AgentRunStatus;
  process: ChildProcessWithoutNullStreams | null;
  events: EventEmitter;
  startedAt: string;
  updatedAt: string;
  finished: Promise<ProviderRunResult>;
}

/** An app-authorized snapshot; revision identifies canonical Markdown, text is the sent excerpt. */
export interface ProviderContextSource {
  id: string;
  revision: string;
  title: string;
  text: string;
}

export interface ProviderSelectedContext {
  /** Prompt for adapters that send the source snapshots separately. */
  prompt: string;
  sources: readonly ProviderContextSource[];
  /** Recheck app access, scope and canonical revisions before dispatch and accepting output. */
  isCurrent?: () => boolean;
}

export interface ProviderRunStartInput {
  cwd: string;
  prompt: string;
  runId: string;
  model?: string | null;
  eventsPath?: string;
  artifactPaths?: string[];
  outputPath?: string;
  env?: NodeJS.ProcessEnv;
  onEvent?: (event: NormalizedRunEvent) => void;
  selectedContext?: ProviderSelectedContext;
}

export interface ProviderAdapter {
  provider: AgentProvider;
  startSession(input: ProviderRunStartInput): ProviderRuntimeSession;
  interrupt(sessionId: string): void;
  stopSession(sessionId: string): void;
  listSessions(): ProviderRuntimeSession[];
}

export interface ProviderDefinition {
  id: string;
  label: string;
  command: string;
  versionArgs: string[];
  capabilities: string[];
  runArgs: (prompt: string, input: ProviderRunStartInput) => string[];
  authFiles?: string[];
  connectCommand: string;
  models: string[];
  defaultModel: string | null;
  promptDelivery?: "argument" | "stdin";
}

export const providerDefinitions: ProviderDefinition[] = [
  {
    id: "codex",
    label: "Codex",
    command: "codex",
    versionArgs: ["--version"],
    capabilities: ["cli", "stream", "tools", "code", "research", "approvals"],
    runArgs: (_prompt, input) => [
      "exec",
      "--skip-git-repo-check",
      "--cd",
      input.cwd,
      "--color",
      "never",
      "--json",
      ...(input.outputPath ? ["--output-last-message", input.outputPath] : []),
      ...(input.model ? ["--model", input.model] : []),
      "-"
    ],
    authFiles: [".codex/auth.json", ".codex/config.toml"],
    connectCommand: "codex login",
    models: ["gpt-5-codex"],
    defaultModel: null,
    promptDelivery: "stdin"
  },
  {
    id: "claude",
    label: "Claude Code",
    command: "claude",
    versionArgs: ["--version"],
    capabilities: ["cli", "stream", "tools", "research", "approvals"],
    runArgs: (prompt, input) => [
      "--print",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--no-session-persistence",
      "--permission-mode",
      "dontAsk",
      ...(input.model ? ["--model", input.model] : []),
      prompt
    ],
    authFiles: [".claude.json", ".config/claude/config.json"],
    connectCommand: "claude auth",
    models: ["sonnet", "opus"],
    defaultModel: null
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    command: "gemini",
    versionArgs: ["--version"],
    capabilities: ["cli", "stream", "research"],
    runArgs: (prompt, input) => [
      "--prompt",
      prompt,
      "--output-format",
      "stream-json",
      "--approval-mode",
      "plan",
      ...(input.model ? ["--model", input.model] : [])
    ],
    authFiles: [".gemini/settings.json", ".config/gemini/settings.json"],
    connectCommand: "gemini auth",
    models: ["gemini-2.5-pro", "gemini-2.5-flash"],
    defaultModel: null
  },
  {
    id: "opencode",
    label: "OpenCode",
    command: "opencode",
    versionArgs: ["--version"],
    capabilities: ["cli", "stream", "tools", "code", "approvals"],
    runArgs: (prompt, input) => [
      "run",
      "--format",
      "json",
      "--dir",
      input.cwd,
      ...(input.model ? ["--model", input.model] : []),
      prompt
    ],
    authFiles: [".config/opencode/auth.json", ".local/share/opencode/auth.json"],
    connectCommand: "opencode providers",
    models: [],
    defaultModel: null
  },
  {
    id: "copilot",
    label: "Copilot CLI",
    command: "gh",
    versionArgs: ["copilot", "--version"],
    capabilities: ["cli", "stream", "research"],
    runArgs: (prompt, input) => [
      "copilot",
      "-p",
      prompt,
      "--output-format",
      "json",
      "--stream",
      "off",
      "--no-remote",
      "--no-ask-user",
      "--silent",
      ...(input.model ? ["--model", input.model] : [])
    ],
    authFiles: [".config/gh/hosts.yml"],
    connectCommand: "gh auth login && gh copilot",
    models: ["gpt-5.2", "gpt-5.1"],
    defaultModel: null
  },
  {
    id: "cursor",
    label: "Cursor-like CLI",
    command: "cursor-agent",
    versionArgs: ["--version"],
    capabilities: ["cli", "stream", "code", "approvals"],
    runArgs: (prompt, input) => [
      "--print",
      "--output-format",
      "stream-json",
      ...(input.model ? ["--model", input.model] : []),
      prompt
    ],
    authFiles: [".cursor", ".cursor-agent"],
    connectCommand: "cursor-agent login",
    models: ["gpt-5", "sonnet-4", "sonnet-4-thinking"],
    defaultModel: null
  }
];

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export function createRunEvent(input: {
  runId: string;
  providerId: string;
  type: NormalizedRunEvent["type"];
  message?: string;
  payload?: Record<string, unknown>;
  timestamp?: string;
}): NormalizedRunEvent {
  return NormalizedRunEventSchema.parse({
    id: createId("event"),
    runId: input.runId,
    type: input.type,
    timestamp: input.timestamp ?? nowIso(),
    providerId: input.providerId,
    message: input.message ?? "",
    payload: input.payload ?? {}
  });
}

function homeFileExists(relativePath: string): boolean {
  const home = process.env.HOME;
  return Boolean(home && fs.existsSync(path.join(home, relativePath)));
}

function commandExists(command: string): boolean {
  return (
    spawnSync("sh", ["-lc", `command -v ${JSON.stringify(command)}`], {
      stdio: "ignore",
      timeout: 500
    }).status === 0
  );
}

function versionFor(definition: ProviderDefinition, installed: boolean): string | null {
  if (!installed) return null;
  const result = spawnSync(definition.command, definition.versionArgs, {
    encoding: "utf8",
    timeout: 800
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return output || null;
}

function mergeUnique(...lists: string[][]): string[] {
  return [...new Set(lists.flat().map((value) => String(value).trim()).filter(Boolean))];
}

function authStatusFor(definition: ProviderDefinition, installed: boolean): AgentProvider["authStatus"] {
  if (!installed) return "unavailable";
  if (definition.authFiles?.some(homeFileExists)) return "authenticated";
  return "unknown";
}

function fallbackSettings(definition: ProviderDefinition): AgentProviderSettings {
  return AgentProviderSettingsSchema.parse({
    providerId: definition.id,
    enabled: false,
    connected: false,
    command: definition.command,
    defaultModel: definition.defaultModel,
    customModels: [],
    lastCheckedAt: null,
    updatedAt: nowIso()
  });
}

export class AgentProviderSettingsStore {
  constructor(readonly filePath: string) {}

  read(): Record<string, AgentProviderSettings> {
    if (!fs.existsSync(this.filePath)) return {};
    const raw = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: Record<string, AgentProviderSettings> = {};
    for (const [providerId, value] of Object.entries(raw)) {
      out[providerId] = AgentProviderSettingsSchema.parse({ providerId, ...(value as Record<string, unknown>) });
    }
    return out;
  }

  patch(providerId: string, patch: AgentProviderSettingsPatch, definitions: ProviderDefinition[] = providerDefinitions): AgentProviderSettings {
    const parsed = AgentProviderSettingsPatchSchema.parse(patch);
    const existing = this.read();
    const definition = definitions.find((candidate) => candidate.id === providerId);
    const current = existing[providerId] ?? (definition ? fallbackSettings(definition) : null);
    if (!current) throw new Error(`Unknown provider: ${providerId}`);
    const next = AgentProviderSettingsSchema.parse({
      ...current,
      ...parsed,
      providerId,
      command: parsed.command !== undefined ? parsed.command : current.command,
      updatedAt: nowIso()
    });
    existing[providerId] = next;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify(existing, null, 2)}\n`, "utf8");
    return next;
  }

  markConnected(providerId: string, definitions: ProviderDefinition[] = providerDefinitions): AgentProviderSettings {
    return this.patch(providerId, { enabled: true, connected: true }, definitions);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function readNestedString(record: Record<string, unknown>, paths: string[][]): string | null {
  for (const pathParts of paths) {
    let current: unknown = record;
    for (const part of pathParts) {
      const currentRecord = asRecord(current);
      current = currentRecord?.[part];
    }
    if (typeof current === "string" && current.length > 0) return current;
  }
  return null;
}

function jsonEventMessage(raw: Record<string, unknown>): string {
  const extracted = extractTextFromValue(raw);
  if (extracted) return extracted;
  return (
    readString(raw, ["message", "delta", "content", "text", "summary", "output"]) ??
    readNestedString(raw, [
      ["data", "deltaContent"],
      ["data", "content"],
      ["data", "message"],
      ["payload", "delta"],
      ["payload", "content"],
      ["payload", "message"],
      ["properties", "message"],
      ["properties", "content"]
    ]) ??
    JSON.stringify(raw)
  );
}

function extractTextFromValue(value: unknown, depth = 0): string | null {
  if (depth > 5) return null;
  if (typeof value === "string") return value.length > 0 ? value : null;
  if (Array.isArray(value)) {
    const text = value
      .map((item) => extractTextFromValue(item, depth + 1))
      .filter((item): item is string => Boolean(item))
      .join("");
    return text || null;
  }
  const record = asRecord(value);
  if (!record) return null;
  for (const key of ["deltaContent", "delta", "result", "text", "content", "message", "summary", "output"]) {
    const found = extractTextFromValue(record[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function normalizeJsonEvent(input: {
  runId: string;
  providerId: string;
  stream: "stdout" | "stderr";
  raw: Record<string, unknown>;
}): NormalizedRunEvent[] {
  const method = (
    readString(input.raw, ["type", "method", "kind", "event"]) ??
    readNestedString(input.raw, [["payload", "type"], ["data", "type"]]) ??
    ""
  ).toLowerCase();
  const message = jsonEventMessage(input.raw);
  const artifactPath = readString(input.raw, ["path", "filePath", "artifactPath"]) ?? readNestedString(input.raw, [["payload", "path"], ["data", "path"]]);
  const payload = {
    stream: input.stream,
    native: input.raw,
    method,
    ...(artifactPath ? { path: artifactPath } : {})
  };

  if (/evidence|citation|reference/.test(method)) {
    return [createRunEvent({ ...input, type: "evidence.found", message, payload })];
  }
  if (/artifact|file.*written|write.*file|patch/.test(method)) {
    return [createRunEvent({ ...input, type: "artifact.written", message, payload })];
  }
  if (/tool|command|shell|exec|function/.test(method)) {
    const eventType: NormalizedRunEvent["type"] = /start|call|asked|request/.test(method) ? "tool.call" : "tool.result";
    return [createRunEvent({ ...input, type: eventType, message, payload })];
  }
  if (/error|failed|exception/.test(method) && input.stream === "stderr") {
    return [createRunEvent({ ...input, type: "tool.result", message, payload: { ...payload, error: true } })];
  }
  return [createRunEvent({ ...input, type: input.stream === "stderr" ? "tool.result" : "model.delta", message, payload })];
}

export function normalizeProviderOutput(input: {
  runId: string;
  providerId: string;
  stream: "stdout" | "stderr";
  text: string;
}): NormalizedRunEvent[] {
  const trimmed = input.text.trim();
  if (!trimmed) return [];
  const lines = trimmed.includes("\n") ? trimmed.split(/\r?\n/).filter(Boolean) : [trimmed];
  return lines.flatMap((line) => {
    const candidate = line.trim();
    if (candidate.startsWith("{")) {
      try {
        const raw = asRecord(JSON.parse(candidate));
        if (raw) return normalizeJsonEvent({ ...input, raw });
      } catch {
        // Fall through to plain streaming text.
      }
    }
    return [
      createRunEvent({
        runId: input.runId,
        providerId: input.providerId,
        type: input.stream === "stderr" ? "tool.result" : "model.delta",
        message: line,
        payload: { stream: input.stream }
      })
    ];
  });
}

export function classifyProviderFailure(input: {
  output: string;
  code?: number | null;
  signal?: NodeJS.Signals | null;
  cancelled?: boolean;
  spawnError?: boolean;
  installed?: boolean;
}): ProviderFailureClass {
  if (input.cancelled) return "cancelled";
  if (input.installed === false) return "command_not_found";
  if (input.spawnError) return "spawn_error";
  const haystack = input.output.toLowerCase();
  if (/not\s+auth|unauth|login|required|token|credential/.test(haystack)) return "auth";
  if (/rate.?limit|quota|too many requests|429/.test(haystack)) return "rate_limit";
  if (/permission denied|forbidden|not allowed|approval/.test(haystack)) return "permission";
  if (input.code !== undefined || input.signal !== undefined) return "process_exit";
  return "unknown";
}

export class EventNdjsonLogger {
  constructor(readonly filePath: string) {}

  write(runEvent: NormalizedRunEvent): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.appendFileSync(this.filePath, `${JSON.stringify(runEvent)}\n`, "utf8");
  }
}

export class ProviderSessionDirectory {
  private readonly sessions = new Map<string, ProviderRuntimeSession>();

  upsert(session: ProviderRuntimeSession): void {
    this.sessions.set(session.id, session);
  }

  get(sessionId: string): ProviderRuntimeSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  getByRunId(runId: string): ProviderRuntimeSession | null {
    return [...this.sessions.values()].find((session) => session.runId === runId) ?? null;
  }

  list(): ProviderRuntimeSession[] {
    return [...this.sessions.values()];
  }

  remove(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}

export class AgentProviderCatalog {
  constructor(
    private readonly definitions: ProviderDefinition[] = providerDefinitions,
    private settings: Record<string, AgentProviderSettings> = {}
  ) {}

  setSettings(settings: Record<string, AgentProviderSettings>): void {
    this.settings = settings;
  }

  discover(): AgentProvider[] {
    return this.definitions.map((definition) => {
      const settings = this.settings[definition.id];
      const command = settings?.command?.trim() || definition.command;
      const effectiveDefinition = { ...definition, command };
      const installed = commandExists(command);
      const authStatus = authStatusFor(effectiveDefinition, installed);
      return AgentProviderSchema.parse({
        id: definition.id,
        label: definition.label,
        command,
        installed,
        enabled: settings?.enabled ?? false,
        connected: settings?.connected ?? authStatus === "authenticated",
        authStatus,
        version: versionFor(effectiveDefinition, installed),
        capabilities: definition.capabilities,
        defaultModel: settings?.defaultModel ?? definition.defaultModel,
        models: mergeUnique(definition.models, settings?.customModels ?? []),
        customModels: settings?.customModels ?? [],
        lastCheckedAt: settings?.lastCheckedAt ?? null,
        connectCommand: definition.connectCommand
      });
    });
  }

  definition(providerId: string): ProviderDefinition | null {
    return this.definitions.find((candidate) => candidate.id === providerId) ?? null;
  }

  createAdapter(providerId: string): ProviderAdapter | null {
    const definition = this.definition(providerId);
    if (!definition) return null;
    const settings = this.settings[providerId];
    const effectiveDefinition = {
      ...definition,
      command: settings?.command?.trim() || definition.command
    };
    const provider = this.discover().find((candidate) => candidate.id === providerId);
    if (!provider) return null;
    return new CliProviderAdapter(effectiveDefinition, provider);
  }
}

export class CliProviderAdapter implements ProviderAdapter {
  readonly provider: AgentProvider;
  private readonly sessions = new Map<string, ProviderRuntimeSession>();

  constructor(
    private readonly definition: ProviderDefinition,
    provider: AgentProvider
  ) {
    this.provider = provider;
  }

  startSession(input: ProviderRunStartInput): ProviderRuntimeSession {
    const sessionId = createId("session");
    const events = new EventEmitter();
    const capturedEvents: NormalizedRunEvent[] = [];
    const transcript: string[] = [];
    const artifacts = new Set<string>();
    let outputForFailure = "";
    let resolveFinished: (result: ProviderRunResult) => void = () => undefined;
    let didFinish = false;
    const finished = new Promise<ProviderRunResult>((resolve) => {
      resolveFinished = resolve;
    });
    const session: ProviderRuntimeSession = {
      id: sessionId,
      runId: input.runId,
      providerId: this.provider.id,
      cwd: input.cwd,
      prompt: input.prompt,
      status: "starting",
      process: null,
      events,
      startedAt: nowIso(),
      updatedAt: nowIso(),
      finished
    };
    this.sessions.set(sessionId, session);

    const emit = (runEvent: NormalizedRunEvent) => {
      capturedEvents.push(runEvent);
      if (runEvent.type === "model.delta") transcript.push(runEvent.message);
      if (runEvent.type === "artifact.written") {
        const artifactPath = typeof runEvent.payload.path === "string" ? runEvent.payload.path : null;
        if (artifactPath) artifacts.add(artifactPath);
      }
      session.updatedAt = nowIso();
      input.onEvent?.(runEvent);
      events.emit("event", runEvent);
    };

    const finish = (status: AgentRunStatus, code: number | null, signal: NodeJS.Signals | null, failureClass: ProviderFailureClass | null) => {
      if (didFinish) return;
      didFinish = true;
      session.status = status;
      session.updatedAt = nowIso();
      this.sessions.delete(sessionId);
      resolveFinished({
        sessionId,
        runId: input.runId,
        providerId: this.provider.id,
        status,
        exitCode: code,
        signal,
        failureClass,
        transcript: transcript.join(""),
        events: capturedEvents,
        artifacts: [...artifacts]
      });
    };

    queueMicrotask(() => {
      session.status = "running";
      emit(
        createRunEvent({
          runId: input.runId,
          providerId: this.provider.id,
          type: "run.started",
          message: `${this.provider.label} session started`,
          payload: { sessionId, command: this.definition.command, cwd: input.cwd }
        })
      );
    });

    if (!this.provider.installed) {
      queueMicrotask(() => {
        const failureClass = classifyProviderFailure({ output: "", installed: false });
        emit(
          createRunEvent({
            runId: input.runId,
            providerId: this.provider.id,
            type: "run.failed",
            message: `${this.provider.label} is not installed`,
            payload: { sessionId, command: this.provider.command, failureClass }
          })
        );
        finish("failed", null, null, failureClass);
      });
      return session;
    }

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(this.definition.command, this.definition.runArgs(input.prompt, input), {
        cwd: input.cwd,
        env: { ...process.env, ...input.env }
      });
    } catch (error) {
      queueMicrotask(() => {
        const message = error instanceof Error ? error.message : String(error);
        const failureClass = classifyProviderFailure({ output: message, spawnError: true });
        emit(
          createRunEvent({
            runId: input.runId,
            providerId: this.provider.id,
            type: "run.failed",
            message,
            payload: { sessionId, failureClass }
          })
        );
        finish("failed", null, null, failureClass);
      });
      return session;
    }
    session.process = child;

    let stdoutBuffer = "";
    let stderrBuffer = "";
    const consumeOutput = (stream: "stdout" | "stderr", text: string, flush = false) => {
      outputForFailure += text;
      const nextBuffer = (stream === "stdout" ? stdoutBuffer : stderrBuffer) + text;
      const lines = nextBuffer.split(/\r?\n/);
      const tail = lines.pop() ?? "";
      const complete = lines.join("\n");
      if (stream === "stdout") stdoutBuffer = tail;
      else stderrBuffer = tail;

      if (complete) {
        for (const runEvent of normalizeProviderOutput({
          runId: input.runId,
          providerId: this.provider.id,
          stream,
          text: complete
        })) {
          emit(runEvent);
        }
      }

      const pending = stream === "stdout" ? stdoutBuffer : stderrBuffer;
      if (pending && (flush || !pending.trimStart().startsWith("{") || pending.length > 4096)) {
        if (stream === "stdout") stdoutBuffer = "";
        else stderrBuffer = "";
        for (const runEvent of normalizeProviderOutput({
          runId: input.runId,
          providerId: this.provider.id,
          stream,
          text: pending
        })) {
          emit(runEvent);
        }
      }
    };

    if (this.definition.promptDelivery === "stdin") {
      child.stdin.write(input.prompt);
      child.stdin.end();
    } else {
      child.stdin.end();
    }

    child.stdout.on("data", (chunk: Buffer) => {
      consumeOutput("stdout", chunk.toString());
    });
    child.stderr.on("data", (chunk: Buffer) => {
      consumeOutput("stderr", chunk.toString());
    });
    child.on("error", (error) => {
      const message = error.message;
      outputForFailure += message;
      const failureClass = classifyProviderFailure({ output: message, spawnError: true });
      emit(
        createRunEvent({
          runId: input.runId,
          providerId: this.provider.id,
          type: "run.failed",
          message,
          payload: { sessionId, failureClass }
        })
      );
      finish("failed", null, null, failureClass);
    });
    child.on("close", (code, signal) => {
      consumeOutput("stdout", "", true);
      consumeOutput("stderr", "", true);
      for (const artifactPath of input.artifactPaths ?? []) {
        if (fs.existsSync(artifactPath)) {
          artifacts.add(artifactPath);
          emit(
            createRunEvent({
              runId: input.runId,
              providerId: this.provider.id,
              type: "artifact.written",
              message: `Artifact captured: ${artifactPath}`,
              payload: { sessionId, path: artifactPath }
            })
          );
        }
      }

      const cancelled = session.status === "cancelled";
      const status: AgentRunStatus = cancelled ? "cancelled" : code === 0 ? "completed" : "failed";
      const failureClass =
        status === "failed" || status === "cancelled"
          ? classifyProviderFailure({ output: outputForFailure, code, signal, cancelled })
          : null;
      emit(
        createRunEvent({
          runId: input.runId,
          providerId: this.provider.id,
          type: status === "completed" ? "run.completed" : "run.failed",
          message:
            status === "completed"
              ? "Provider run completed"
              : status === "cancelled"
                ? "Provider run cancelled"
                : `Provider exited with code ${code ?? "unknown"}`,
          payload: { sessionId, code, signal, failureClass }
        })
      );
      finish(status, code, signal, failureClass);
    });
    return session;
  }

  interrupt(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    session?.process?.kill("SIGINT");
  }

  stopSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.status = "cancelled";
    session.process?.kill("SIGTERM");
    setTimeout(() => {
      if (this.sessions.has(sessionId)) session.process?.kill("SIGKILL");
    }, 2000).unref();
  }

  listSessions(): ProviderRuntimeSession[] {
    return [...this.sessions.values()];
  }
}

export class AgentHarness {
  private readonly adapters = new Map<string, ProviderAdapter>();
  private readonly directory: ProviderSessionDirectory;

  constructor(private readonly options: { catalog?: AgentProviderCatalog; directory?: ProviderSessionDirectory } = {}) {
    this.directory = options.directory ?? new ProviderSessionDirectory();
  }

  discover(): AgentProvider[] {
    return (this.options.catalog ?? new AgentProviderCatalog()).discover();
  }

  startRun(input: ProviderRunStartInput & { providerId: string }): ProviderRuntimeSession {
    const adapter = this.resolveAdapter(input.providerId);
    const logger = input.eventsPath ? new EventNdjsonLogger(input.eventsPath) : null;
    const session = adapter.startSession({
      ...input,
      onEvent: (runEvent) => {
        logger?.write(runEvent);
        input.onEvent?.(runEvent);
      }
    });
    this.directory.upsert(session);
    session.finished.finally(() => this.directory.remove(session.id));
    return session;
  }

  interruptRun(runId: string): void {
    const session = this.directory.getByRunId(runId);
    if (!session) return;
    this.resolveAdapter(session.providerId).interrupt(session.id);
  }

  cancelRun(runId: string): void {
    const session = this.directory.getByRunId(runId);
    if (!session) return;
    this.resolveAdapter(session.providerId).stopSession(session.id);
  }

  listSessions(): ProviderRuntimeSession[] {
    return this.directory.list();
  }

  private resolveAdapter(providerId: string): ProviderAdapter {
    const existing = this.adapters.get(providerId);
    if (existing) return existing;
    const catalog = this.options.catalog ?? new AgentProviderCatalog();
    const adapter = catalog.createAdapter(providerId);
    if (!adapter) {
      throw new Error(`Unsupported agent provider: ${providerId}`);
    }
    this.adapters.set(providerId, adapter);
    return adapter;
  }
}
