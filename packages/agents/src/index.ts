import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  AgentProviderSettingsPatchSchema,
  AgentProviderSettingsSchema,
  NormalizedRunEventSchema,
  type AgentProvider,
  type AgentProviderSettings,
  type AgentProviderSettingsPatch,
  type NormalizedRunEvent
} from "@litagent/contracts";

export type AgentRunStatus = "starting" | "running" | "completed" | "failed" | "cancelled";
export type ProviderFailureClass = "auth" | "rate_limit" | "permission" | "cancelled" | "unknown";

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
  events: EventEmitter;
  startedAt: string;
  updatedAt: string;
  finished: Promise<ProviderRunResult>;
}

export interface ProviderRunStartInput {
  cwd: string;
  prompt: string;
  runId: string;
  model?: string | null;
  eventsPath?: string;
  artifactPaths?: string[];
  outputPath?: string;
  onEvent?: (event: NormalizedRunEvent) => void;
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
  capabilities: string[];
  models: string[];
  defaultModel: string | null;
}

export class ProviderSelectionError extends Error {
  readonly code = "DRIVER_SELECTION_REQUIRED";
  constructor(providerId: string) {
    super(providerId
      ? `The saved provider "${providerId}" is not an AgenticDriver connection. Select a Driver provider and model in Settings; no replacement was chosen.`
      : "Select an AgenticDriver provider and model in Settings before starting AI work.");
    this.name = "ProviderSelectionError";
  }
}

export function requireDriverProvider(providerId: string): void {
  if (!/^driver\.(?:[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}:)?[A-Za-z0-9_.-]+$/.test(providerId) || providerId.length > 180) {
    throw new ProviderSelectionError(providerId);
  }
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
    id: `event_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
    runId: input.runId,
    type: input.type,
    timestamp: input.timestamp ?? new Date().toISOString(),
    providerId: input.providerId,
    message: input.message ?? "",
    payload: input.payload ?? {}
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

  patch(providerId: string, patch: AgentProviderSettingsPatch, definitions: ProviderDefinition[] = []): AgentProviderSettings {
    requireDriverProvider(providerId);
    const parsed = AgentProviderSettingsPatchSchema.parse(patch);
    const existing = this.read();
    const definition = definitions.find((candidate) => candidate.id === providerId);
    const current = existing[providerId] ?? (definition ? AgentProviderSettingsSchema.parse({
      providerId, defaultModel: definition.defaultModel, updatedAt: new Date().toISOString()
    }) : null);
    if (!current) throw new Error(`Unknown provider: ${providerId}`);
    const next = AgentProviderSettingsSchema.parse({ ...current, ...parsed, providerId, updatedAt: new Date().toISOString() });
    // Preserve retired settings verbatim for provenance, but never make them executable.
    const saved = fs.existsSync(this.filePath) ? JSON.parse(fs.readFileSync(this.filePath, "utf8")) : {};
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify({ ...saved, [providerId]: next }, null, 2)}\n`, "utf8");
    return next;
  }
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
  upsert(session: ProviderRuntimeSession): void { this.sessions.set(session.id, session); }
  get(sessionId: string): ProviderRuntimeSession | null { return this.sessions.get(sessionId) ?? null; }
  getByRunId(runId: string): ProviderRuntimeSession | null { return [...this.sessions.values()].find((session) => session.runId === runId) ?? null; }
  list(): ProviderRuntimeSession[] { return [...this.sessions.values()]; }
  remove(sessionId: string): void { this.sessions.delete(sessionId); }
}

/** Unconfigured catalog. The Driver registry supplies the only executable adapters. */
export class AgentProviderCatalog {
  setSettings(_settings: Record<string, AgentProviderSettings>): void {}
  discover(): AgentProvider[] { return []; }
  definition(_providerId: string): ProviderDefinition | null { return null; }
  createAdapter(_providerId: string): ProviderAdapter | null { return null; }
}

/** App run IDs/logs and cancellation handles; provider execution belongs to the SDK. */
export class AgentHarness {
  private readonly adapters = new Map<string, ProviderAdapter>();
  private readonly directory: ProviderSessionDirectory;

  constructor(private readonly options: { catalog?: AgentProviderCatalog; directory?: ProviderSessionDirectory } = {}) {
    this.directory = options.directory ?? new ProviderSessionDirectory();
  }
  discover(): AgentProvider[] { return (this.options.catalog ?? new AgentProviderCatalog()).discover(); }
  startRun(input: ProviderRunStartInput & { providerId: string }): ProviderRuntimeSession {
    requireDriverProvider(input.providerId);
    const adapter = this.resolveAdapter(input.providerId);
    const logger = input.eventsPath ? new EventNdjsonLogger(input.eventsPath) : null;
    const session = adapter.startSession({ ...input, onEvent: (runEvent) => {
      logger?.write(runEvent);
      input.onEvent?.(runEvent);
    } });
    this.directory.upsert(session);
    session.finished.finally(() => this.directory.remove(session.id));
    return session;
  }
  interruptRun(runId: string): void {
    const session = this.directory.getByRunId(runId);
    if (session) this.resolveAdapter(session.providerId).interrupt(session.id);
  }
  cancelRun(runId: string): void {
    const session = this.directory.getByRunId(runId);
    if (session) this.resolveAdapter(session.providerId).stopSession(session.id);
  }
  listSessions(): ProviderRuntimeSession[] { return this.directory.list(); }
  private resolveAdapter(providerId: string): ProviderAdapter {
    const existing = this.adapters.get(providerId);
    if (existing) return existing;
    const adapter = this.options.catalog?.createAdapter(providerId);
    if (!adapter) throw new Error("AgenticDriver connection is unavailable. Connect a host in Settings; no fallback was selected.");
    this.adapters.set(providerId, adapter);
    return adapter;
  }
}
