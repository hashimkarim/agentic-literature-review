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

export class DriverConnectionStore {
  constructor(readonly file: string) {}
  read(): { url: string; token: string } | null {
    if (!fs.existsSync(this.file)) return null;
    const saved = configuration.parse(JSON.parse(fs.readFileSync(this.file, "utf8")));
    if (!saved.token) throw new Error("Saved driver credential is missing.");
    return { url: saved.url, token: saved.token };
  }
  prepare(input: unknown): { url: string; token: string } {
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
      if (previous?.url === value.url) token = previous.token;
    }
    if (!token || /\s/.test(token)) throw new Error("A driver bearer credential is required.");
    return { url: value.url, token };
  }
  save(value: { url: string; token: string }): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
      fs.renameSync(temporary, this.file);
    } finally { fs.rmSync(temporary, { force: true }); }
  }
}

export function driverConnectionRoutes(catalog: AgenticDriverCatalog, store: DriverConnectionStore, settings: AgentProviderSettingsStore): Router {
  const router = Router();
  let saving = false;
  router.put("/", requireLocalAccess, async (req, res) => {
    if (saving) { res.status(409).json({ error: "Another connection update is in progress." }); return; }
    saving = true;
    try {
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
      await catalog.configure(value.url, value.token);
      res.json({ connection: catalog.connectionStatus(), providers: catalog.discover() });
    } catch {
      // Input errors and native filesystem errors can contain the secret; never echo them.
      res.status(400).json({ error: "Connection not saved. Use HTTPS or loopback HTTP and a valid bearer token or readable local credential file." });
    } finally { saving = false; }
  });
  return router;
}
