import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Router } from "express";
import type { AgenticDriverCatalog } from "@litagent/agents/agenticdriver";
import type { AgentProviderSettingsStore } from "@litagent/agents";
import { requireLocalAccess } from "./local-access";

const configuration = z.object({
  url: z.string().trim().url().max(2000).refine((value) => {
    const url = new URL(value);
    return !url.username && !url.password && !url.search && !url.hash && (url.protocol === "https:" ||
      (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)));
  }),
  token: z.string().trim().min(1).max(16384).optional(),
  tokenFile: z.string().trim().min(1).max(4096).optional(),
}).strict().refine((value) => !(value.token && value.tokenFile));

const savedConnection = z.object({
  url: z.string().url(), token: z.string().min(1),
  connectionId: z.string().uuid().optional(), expiresAt: z.string().datetime({ offset: true }).optional(),
}).strict();
export type SavedDriverConnection = z.infer<typeof savedConnection>;

export class DriverConnectionStore {
  private busy = false;
  constructor(readonly file: string) {}
  async withLock<T>(operation: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error("CONNECTION_BUSY");
    this.busy = true;
    try { return await operation(); } finally { this.busy = false; }
  }
  read(): SavedDriverConnection | null {
    if (!fs.existsSync(this.file)) return null;
    const value: unknown = JSON.parse(fs.readFileSync(this.file, "utf8"));
    if (z.object({ disconnected: z.literal(true) }).strict().safeParse(value).success) return null;
    return savedConnection.parse(value);
  }
  prepare(input: unknown): SavedDriverConnection {
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
    if (!token) {
      const previous = this.read();
      if (previous?.url === value.url) return previous;
    }
    if (!token || /\s/.test(token)) throw new Error("A driver bearer credential is required.");
    return { url: value.url, token };
  }
  save(value: SavedDriverConnection): void {
    const previous = this.read();
    this.persist({ ...value, connectionId: value.connectionId ??
      (previous?.url === value.url && previous.token === value.token ? previous.connectionId : undefined) ?? randomUUID() });
  }
  disconnect(): void {
    // A tombstone prevents environment credentials from silently reconnecting on restart.
    this.persist({ disconnected: true });
  }
  private persist(value: unknown): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
      fs.renameSync(temporary, this.file);
    } finally { fs.rmSync(temporary, { force: true }); }
  }
}

export function driverConnectionRoutes(catalog: AgenticDriverCatalog, store: DriverConnectionStore, settings: AgentProviderSettingsStore, reload?: () => Promise<void>): Router {
  const router = Router();
  router.put("/", requireLocalAccess, async (req, res) => {
    try {
      await store.withLock(async () => {
      const value = store.prepare(req.body);
      const previous = store.read();
      // A changed host/credential can represent another account, even with the same instance IDs.
      if (previous?.url !== value.url || previous?.token !== value.token) {
        for (const provider of catalog.discover().filter((item) => item.id.startsWith("driver."))) {
          settings.patch(provider.id, { enabled: false, connected: false, defaultModel: null }, [catalog.definition(provider.id)!]);
        }
        catalog.setSettings(settings.read());
      }
      store.save(value);
      if (reload) await reload();
      else await catalog.configure(value.url, value.token);
      res.json({ connection: catalog.connectionStatus(), providers: catalog.discover() });
      });
    } catch (error) {
      if (error instanceof Error && error.message === "CONNECTION_BUSY") {
        res.status(409).json({ error: "Another connection update is in progress." }); return;
      }
      // Input errors and native filesystem errors can contain the secret; never echo them.
      res.status(400).json({ error: "Connection not saved. Use HTTPS or loopback HTTP and a valid bearer token or readable local credential file." });
    }
  });
  return router;
}
