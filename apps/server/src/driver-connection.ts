import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Router } from "express";
import type { AgenticDriverRegistry } from "@litagent/agents/agenticdriver";
import type { AgentProviderSettingsStore } from "@litagent/agents";
import { requireLocalAccess } from "./local-access";

const label = z.string().trim().min(1).max(100).refine((value) => !/[\x00-\x1f\x7f]/.test(value));
export const ConnectionLabelsSchema = z.object({ label, deviceName: label }).strict();
const configuration = z.object({
  url: z.string().trim().url().max(2000).refine((value) => {
    const url = new URL(value);
    return !url.username && !url.password && !url.search && !url.hash && (url.protocol === "https:" ||
      (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)));
  }),
  token: z.string().trim().min(1).max(16384).optional(),
  tokenFile: z.string().trim().min(1).max(4096).optional(),
  label: label.optional(), deviceName: label.optional(),
}).strict().refine((value) => !(value.token && value.tokenFile));
const savedConnection = z.object({
  url: z.string().url(), token: z.string().min(1),
  connectionId: z.string().uuid().optional(), expiresAt: z.string().datetime({ offset: true }).optional(),
  label: label.optional(), deviceName: label.optional(),
}).strict();
export type SavedDriverConnection = z.infer<typeof savedConnection>;
const hostRecord = savedConnection.extend({ id: z.string().uuid(), label, deviceName: label, legacyIds: z.boolean() });
export type DriverHostRecord = z.infer<typeof hostRecord>;
const registrySchema = z.object({
  version: z.literal(2), client: z.object({ id: z.string().uuid(), deviceName: label }),
  legacyClaimed: z.boolean(), connections: z.array(hostRecord).max(64),
}).strict().refine((value) => new Set(value.connections.map((entry) => entry.id)).size === value.connections.length);
type Registry = z.infer<typeof registrySchema>;

function deviceFor(url: string): string {
  const host = new URL(url).hostname;
  return ["localhost", "127.0.0.1", "[::1]"].includes(host) ? os.hostname() : host;
}

export class DriverConnectionStore {
  private busy = false;
  constructor(readonly file: string) {}
  async withLock<T>(operation: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error("CONNECTION_BUSY");
    this.busy = true;
    try { return await operation(); } finally { this.busy = false; }
  }
  initialize(environment: NodeJS.ProcessEnv): void {
    if (fs.existsSync(this.file)) { this.load(); return; }
    if (environment.AGENTICDRIVER_URL && environment.AGENTICDRIVER_TOKEN)
      this.add(this.prepare({ url: environment.AGENTICDRIVER_URL, token: environment.AGENTICDRIVER_TOKEN }, null));
    else this.persist(this.empty());
  }
  private empty(): Registry {
    return { version: 2, client: { id: randomUUID(), deviceName: os.hostname() }, legacyClaimed: false, connections: [] };
  }
  private load(): Registry {
    if (!fs.existsSync(this.file)) return this.empty();
    const value: unknown = JSON.parse(fs.readFileSync(this.file, "utf8"));
    const registry = registrySchema.safeParse(value);
    if (registry.success) return registry.data;
    const migrated = this.empty();
    migrated.legacyClaimed = true;
    if (!z.object({ disconnected: z.literal(true) }).strict().safeParse(value).success) {
      const old = savedConnection.parse(value);
      migrated.connections.push({ ...old, id: randomUUID(), label: old.label ?? deviceFor(old.url), deviceName: old.deviceName ?? deviceFor(old.url), legacyIds: true });
    }
    // Persist migration once so namespace, device identity and existing selections survive restarts.
    this.persist(migrated);
    return migrated;
  }
  list(): DriverHostRecord[] { return this.load().connections; }
  clientIdentity(): Registry["client"] {
    if (!fs.existsSync(this.file)) this.persist(this.empty());
    return this.load().client;
  }
  read(id?: string): DriverHostRecord | null {
    const connections = this.list();
    return (id ? connections.find((entry) => entry.id === id) : connections[0]) ?? null;
  }
  prepare(input: unknown, id?: string | null): SavedDriverConnection {
    const value = configuration.parse(input);
    let token = value.token;
    if (value.tokenFile) {
      if (!path.isAbsolute(value.tokenFile)) throw new Error("Use an absolute credential file path.");
      const file = fs.openSync(value.tokenFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        const stat = fs.fstatSync(file);
        if (!stat.isFile() || stat.size > 16384) throw new Error("Invalid credential file.");
        token = fs.readFileSync(file, "utf8").trim();
      } finally { fs.closeSync(file); }
    }
    const previous = id === null ? null : this.read(id);
    if (!token && previous?.url === value.url) return { ...this.credentials(previous),
      ...(value.label ? { label: value.label } : {}), ...(value.deviceName ? { deviceName: value.deviceName } : {}) };
    if (!token || /\s/.test(token)) throw new Error("A driver bearer credential is required.");
    return { url: value.url, token, ...(value.label ? { label: value.label } : {}), ...(value.deviceName ? { deviceName: value.deviceName } : {}) };
  }
  private credentials(value: DriverHostRecord): SavedDriverConnection {
    const { id: _id, legacyIds: _legacy, ...saved } = value;
    return saved;
  }
  add(value: SavedDriverConnection): DriverHostRecord {
    const registry = this.load();
    if (registry.connections.length >= 64) throw new Error("CONNECTION_LIMIT");
    if (registry.connections.some((entry) => entry.url === value.url && entry.token === value.token)) throw new Error("CONNECTION_EXISTS");
    const record = { ...savedConnection.parse(value), id: randomUUID(), connectionId: value.connectionId ?? randomUUID(),
      label: value.label ?? deviceFor(value.url), deviceName: value.deviceName ?? deviceFor(value.url), legacyIds: !registry.legacyClaimed };
    registry.legacyClaimed = true;
    registry.connections.push(record);
    this.persist(registry);
    return record;
  }
  save(value: SavedDriverConnection, id?: string): DriverHostRecord {
    const registry = this.load();
    const previous = id ? registry.connections.find((entry) => entry.id === id) : registry.connections[0];
    if (!previous) {
      if (id) throw new Error("CONNECTION_NOT_FOUND");
      return this.add(value);
    }
    const { id: _id, legacyIds: _legacy, ...input } = value as SavedDriverConnection & { id?: string; legacyIds?: boolean };
    const same = previous.url === value.url && previous.token === value.token;
    if (registry.connections.some((entry) => entry.id !== previous.id && entry.url === value.url && entry.token === value.token)) throw new Error("CONNECTION_EXISTS");
    const record = { ...savedConnection.parse(input), id: previous.id, legacyIds: previous.legacyIds,
      label: value.label ?? previous.label, deviceName: value.deviceName ?? (previous.url === value.url ? previous.deviceName : deviceFor(value.url)),
      connectionId: value.connectionId ?? (same ? previous.connectionId : undefined) ?? randomUUID() };
    registry.connections = registry.connections.map((entry) => entry.id === record.id ? record : entry);
    this.persist(registry);
    return record;
  }
  rename(id: string, input: unknown): DriverHostRecord {
    const labels = ConnectionLabelsSchema.parse(input);
    const previous = this.read(id);
    if (!previous) throw new Error("CONNECTION_NOT_FOUND");
    return this.save({ ...this.credentials(previous), ...labels }, id);
  }
  disconnect(id?: string): void {
    const registry = this.load();
    const target = id ?? registry.connections[0]?.id;
    registry.connections = registry.connections.filter((entry) => entry.id !== target);
    registry.legacyClaimed = true;
    this.persist(registry);
  }
  private persist(value: Registry): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(registrySchema.parse(value)), { mode: 0o600, flag: "wx" });
      fs.renameSync(temporary, this.file);
    } finally { fs.rmSync(temporary, { force: true }); }
  }
}

export function disableDriverConnection(catalog: AgenticDriverRegistry, settings: AgentProviderSettingsStore, id: string, clearModel: boolean): void {
  for (const provider of catalog.host(id)?.discoverDrivers() ?? []) {
    settings.patch(provider.id, { enabled: false, connected: false, ...(clearModel ? { defaultModel: null } : {}) }, [catalog.definition(provider.id)!]);
  }
  catalog.setSettings(settings.read());
}

export function clearNewConnectionChoices(catalog: AgenticDriverRegistry, settings: AgentProviderSettingsStore, record: DriverHostRecord): void {
  // Recovered settings without a connection file must not grant a new host old permissions.
  const prefix = record.legacyIds ? "driver." : `driver.${record.id}:`;
  for (const id of Object.keys(settings.read()).filter((id) => id.startsWith(prefix) && (!record.legacyIds || !id.includes(":")))) {
    settings.patch(id, { enabled: false, connected: false, defaultModel: null, customModels: [] }, [catalog.definition(id)!]);
  }
  catalog.setSettings(settings.read());
}

export function driverConnectionRoutes(catalog: AgenticDriverRegistry, store: DriverConnectionStore, settings: AgentProviderSettingsStore, reload: () => Promise<void>): Router {
  const router = Router();
  router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  const save: import("express").RequestHandler = async (req, res) => {
    try {
      await store.withLock(async () => {
        const id = typeof req.params.id === "string" ? req.params.id : undefined;
        const adding = req.method === "POST";
        if (!adding && !id && store.list().length > 1) {
          res.status(409).json({ error: "Choose a specific driver connection before updating it." });
          return;
        }
        const previous = adding ? null : store.read(id);
        const value = store.prepare(req.body, adding ? null : id);
        if (previous && (previous.url !== value.url || previous.token !== value.token)) disableDriverConnection(catalog, settings, previous.id, true);
        const record = adding ? store.add(value) : store.save(value, id);
        if (!previous) clearNewConnectionChoices(catalog, settings, record);
        await reload();
        res.json({ id: record.id, connection: catalog.host(record.id)!.connectionStatus(), providers: catalog.discover() });
      });
    } catch (error) {
      const busy = error instanceof Error && error.message === "CONNECTION_BUSY";
      res.status(busy ? 409 : 400).json({ error: busy ? "Another connection update is in progress." :
        "Connection not saved. Check the address and credential; do not add the same connection twice." });
    }
  };
  router.put("/", requireLocalAccess, save);
  router.post("/connections", requireLocalAccess, save);
  router.put("/connections/:id", requireLocalAccess, save);
  router.patch("/connections/:id", requireLocalAccess, async (req, res) => {
    try {
      await store.withLock(async () => { store.rename(String(req.params.id), req.body); await reload(); });
      res.json({ saved: true });
    } catch { res.status(400).json({ error: "Connection names could not be saved." }); }
  });
  router.delete("/connections/:id", requireLocalAccess, async (req, res) => {
    try {
      await store.withLock(async () => {
        const id = String(req.params.id);
        if (!store.read(id)) throw new Error("CONNECTION_NOT_FOUND");
        disableDriverConnection(catalog, settings, id, false);
        store.disconnect(id); await reload();
      });
      res.json({ disconnected: true });
    } catch { res.status(400).json({ error: "Connection could not be removed." }); }
  });
  return router;
}
