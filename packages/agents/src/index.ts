import { EventEmitter } from "node:events";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";

import {
  AgentProviderSchema,
  NormalizedRunEventSchema,
  type AgentProvider,
  type NormalizedRunEvent
} from "@litagent/contracts";

export interface ProviderRuntimeSession {
  id: string;
  providerId: string;
  process: ChildProcessWithoutNullStreams | null;
  events: EventEmitter;
  startedAt: string;
}

export interface ProviderAdapter {
  provider: AgentProvider;
  startSession(input: { cwd: string; prompt: string; runId: string }): ProviderRuntimeSession;
  interrupt(sessionId: string): void;
  stopSession(sessionId: string): void;
  listSessions(): ProviderRuntimeSession[];
}

interface ProviderDefinition {
  id: string;
  label: string;
  command: string;
  versionArgs: string[];
  capabilities: string[];
  runArgs: (prompt: string) => string[];
}

const providerDefinitions: ProviderDefinition[] = [
  {
    id: "codex",
    label: "Codex",
    command: "codex",
    versionArgs: ["--version"],
    capabilities: ["cli", "stream", "tools", "code", "research"],
    runArgs: (prompt) => ["exec", "--skip-git-repo-check", prompt]
  },
  {
    id: "claude",
    label: "Claude Code",
    command: "claude",
    versionArgs: ["--version"],
    capabilities: ["cli", "stream", "tools", "research"],
    runArgs: (prompt) => ["-p", prompt]
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    command: "gemini",
    versionArgs: ["--version"],
    capabilities: ["cli", "stream", "research"],
    runArgs: (prompt) => ["--prompt", prompt]
  },
  {
    id: "opencode",
    label: "OpenCode",
    command: "opencode",
    versionArgs: ["--version"],
    capabilities: ["cli", "stream", "tools", "code"],
    runArgs: (prompt) => ["run", prompt]
  },
  {
    id: "copilot",
    label: "Copilot CLI",
    command: "gh",
    versionArgs: ["copilot", "--version"],
    capabilities: ["cli", "research"],
    runArgs: (prompt) => ["copilot", "suggest", prompt]
  },
  {
    id: "cursor",
    label: "Cursor-like CLI",
    command: "cursor-agent",
    versionArgs: ["--version"],
    capabilities: ["cli", "code"],
    runArgs: (prompt) => [prompt]
  }
];

function nowIso(): string {
  return new Date().toISOString();
}

function event(input: {
  runId: string;
  providerId: string;
  type: NormalizedRunEvent["type"];
  message?: string;
  payload?: Record<string, unknown>;
}): NormalizedRunEvent {
  return NormalizedRunEventSchema.parse({
    id: `event_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`,
    runId: input.runId,
    type: input.type,
    timestamp: nowIso(),
    providerId: input.providerId,
    message: input.message ?? "",
    payload: input.payload ?? {}
  });
}

function commandExists(command: string): boolean {
  return spawnSync("sh", ["-lc", `command -v ${JSON.stringify(command)}`], {
    stdio: "ignore",
    timeout: 500
  }).status === 0;
}

function versionFor(definition: ProviderDefinition, installed: boolean): string | null {
  if (!installed) return null;
  const result = spawnSync(definition.command, definition.versionArgs, {
    encoding: "utf8",
    timeout: 600
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return output || null;
}

export class AgentProviderCatalog {
  discover(): AgentProvider[] {
    return providerDefinitions.map((definition) => {
      const installed = commandExists(definition.command);
      return AgentProviderSchema.parse({
        id: definition.id,
        label: definition.label,
        command: definition.command,
        installed,
        authStatus: installed ? "unknown" : "unavailable",
        version: versionFor(definition, installed),
        capabilities: definition.capabilities
      });
    });
  }

  createAdapter(providerId: string): ProviderAdapter | null {
    const definition = providerDefinitions.find((candidate) => candidate.id === providerId);
    if (!definition) return null;
    const provider = this.discover().find((candidate) => candidate.id === providerId);
    if (!provider) return null;
    return new CliProviderAdapter(definition, provider);
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

  startSession(input: { cwd: string; prompt: string; runId: string }): ProviderRuntimeSession {
    const sessionId = `session_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const events = new EventEmitter();
    const session: ProviderRuntimeSession = {
      id: sessionId,
      providerId: this.provider.id,
      process: null,
      events,
      startedAt: nowIso()
    };
    this.sessions.set(sessionId, session);
    queueMicrotask(() => {
      events.emit("event", event({ runId: input.runId, providerId: this.provider.id, type: "run.started" }));
    });

    if (!this.provider.installed) {
      queueMicrotask(() => {
        events.emit(
          "event",
          event({
            runId: input.runId,
            providerId: this.provider.id,
            type: "run.failed",
            message: `${this.provider.label} is not installed`,
            payload: { command: this.provider.command }
          })
        );
      });
      return session;
    }

    const child = spawn(this.definition.command, this.definition.runArgs(input.prompt), {
      cwd: input.cwd,
      env: process.env
    });
    session.process = child;

    child.stdout.on("data", (chunk: Buffer) => {
      events.emit(
        "event",
        event({
          runId: input.runId,
          providerId: this.provider.id,
          type: "model.delta",
          message: chunk.toString(),
          payload: { stream: "stdout" }
        })
      );
    });
    child.stderr.on("data", (chunk: Buffer) => {
      events.emit(
        "event",
        event({
          runId: input.runId,
          providerId: this.provider.id,
          type: "tool.result",
          message: chunk.toString(),
          payload: { stream: "stderr" }
        })
      );
    });
    child.on("close", (code) => {
      events.emit(
        "event",
        event({
          runId: input.runId,
          providerId: this.provider.id,
          type: code === 0 ? "run.completed" : "run.failed",
          message: code === 0 ? "Provider run completed" : `Provider exited with code ${code}`,
          payload: { code }
        })
      );
      this.sessions.delete(sessionId);
    });
    return session;
  }

  interrupt(sessionId: string): void {
    this.sessions.get(sessionId)?.process?.kill("SIGINT");
  }

  stopSession(sessionId: string): void {
    this.sessions.get(sessionId)?.process?.kill("SIGTERM");
    this.sessions.delete(sessionId);
  }

  listSessions(): ProviderRuntimeSession[] {
    return [...this.sessions.values()];
  }
}
