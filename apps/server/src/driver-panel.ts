import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import express, { type ErrorRequestHandler } from "express";
import { AgenticClient, DriverError } from "@litagent/driver-panel-sdk/client";
import { connectClient } from "@litagent/driver-panel-sdk/connections";
import { providerPanel, PanelRequestSchema } from "@litagent/driver-panel-sdk/panel";
import { providerPresentation } from "@litagent/driver-panel-sdk/catalog";
import type { AgenticDriverCatalog } from "@litagent/agents/agenticdriver";
import type { AgentProviderSettingsStore } from "@litagent/agents";
import { DriverConnectionStore, type SavedDriverConnection } from "./driver-connection";
import { requireLocalAccess } from "./local-access";

/** Settings-only candidate SDK. Workflow execution stays on the registry SDK adapter. */
export class DriverPanelService {
  private client: AgenticClient | undefined;
  private connection: { id: string; label: string; url: string } | undefined;
  private readonly panel;

  constructor(
    private readonly catalog: AgenticDriverCatalog,
    private readonly store: DriverConnectionStore,
    private readonly settings: AgentProviderSettingsStore,
    private readonly environment = process.env,
  ) {
    this.panel = providerPanel({
      client: () => this.client,
      connection: () => this.connection,
      connect: (invitation) => this.connect(invitation),
      disconnect: () => this.disconnect(),
      presentations: (providers) => Object.fromEntries(providers.map((provider) => [provider.id, providerPresentation(provider)])),
    });
  }

  async reload(): Promise<void> {
    const saved = this.store.read();
    const value: SavedDriverConnection | null = saved ?? (!fs.existsSync(this.store.file) &&
      this.environment.AGENTICDRIVER_URL && this.environment.AGENTICDRIVER_TOKEN
      ? { url: this.environment.AGENTICDRIVER_URL, token: this.environment.AGENTICDRIVER_TOKEN } : null);
    if (!value) {
      this.client = undefined;
      this.connection = undefined;
      await this.catalog.disconnect();
      return;
    }
    // The resolver is captured per connection; refreshing/replacing settings never
    // changes the credential of an already-created execution stream.
    const token = () => {
      if (value.expiresAt && Date.parse(value.expiresAt) <= Date.now())
        throw new DriverError("CONNECTION_EXPIRED", "Pair this application again.");
      return value.token;
    };
    const client = new AgenticClient({ url: value.url, token });
    this.client = client;
    this.connection = { id: value.connectionId ?? `environment:${value.url}`, label: "LitAgent connection", url: value.url };
    await this.catalog.configure(value.url, token, async () => {
      const [protocol, providers] = await Promise.all([client.protocol(), client.providers({ refresh: true })]);
      if (!protocol.features.includes("provider-management")) return providers;
      const management = await client.management();
      // Managers see every instance, not just those they may execute. Fail closed
      // for older hosts that do not report the execution grant separately.
      const allowed = new Set(management.executionProviders ?? []);
      return providers.filter((provider) => allowed.has(provider.id));
    });
  }

  private disableAppProviders(clearModel: boolean): void {
    for (const provider of this.catalog.discover().filter((entry) => entry.id.startsWith("driver."))) {
      this.settings.patch(provider.id, { enabled: false, connected: false, ...(clearModel ? { defaultModel: null } : {}) }, [this.catalog.definition(provider.id)!]);
    }
    this.catalog.setSettings(this.settings.read());
  }

  private async connect(invitation: string): Promise<void> {
    const directory = path.join(path.dirname(this.store.file), "driver-pairings", randomUUID());
    const profile = await connectClient(invitation, path.join(directory, "connection.json"));
    try {
      const value = this.store.prepare({ url: profile.url, tokenFile: path.join(directory, profile.tokenFile) });
      this.disableAppProviders(true);
      this.store.save({ ...value, connectionId: profile.id, expiresAt: profile.expiresAt });
    } catch {
      // Keep the private SDK profile for operator recovery after a consumed invitation.
      throw new DriverError("CONNECTION_SAVE_FAILED", "Reconcile the consumed invitation on the host before pairing again.", false, "uncertain");
    }
    fs.rmSync(directory, { recursive: true, force: true });
    await this.reload();
  }

  private async disconnect(): Promise<void> {
    this.store.disconnect();
    this.disableAppProviders(false);
    await this.reload();
  }

  async handle(input: unknown): Promise<unknown> {
    const request = PanelRequestSchema.parse(input);
    return this.store.withLock(async () => {
      try {
        const result = await this.panel(request);
        if (request.action === "snapshot" || request.action === "configure" || request.action === "revoke")
          await this.catalog.refresh();
        return result;
      } catch (error) {
        // Reflect an offline/revoked host in the actual app controls too.
        await this.catalog.refresh();
        throw error;
      }
    });
  }
}

const publicErrors: Record<string, { status: number; message: string }> = {
  FORBIDDEN: { status: 403, message: "This connection has no host-management grant. Pair with an operator invitation to manage providers." },
  UNAUTHORIZED: { status: 401, message: "The driver credential was rejected. Reconnect with a valid invitation or credential." },
  AUTH_UNAVAILABLE: { status: 401, message: "The driver credential is unavailable or expired. Reconnect with a valid invitation or credential." },
  CONFIG_CONFLICT: { status: 409, message: "Host settings changed. Refresh and review the current settings before saving again." },
  CONNECTION_BUSY: { status: 409, message: "Another connection update is in progress. Wait for it to finish." },
  CONNECTION_EXPIRED: { status: 401, message: "This connection expired. Pair LitAgent again." },
  INVITATION_REJECTED: { status: 400, message: "The invitation expired, was already used, or is invalid. Request a new invitation." },
  CONNECTION_SAVE_FAILED: { status: 409, message: "The invitation was consumed but local setup could not finish. Reconcile or revoke it on the host before pairing again." },
};

export function driverPanelRoutes(service: DriverPanelService): express.Router {
  const router = express.Router();
  router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  router.use(requireLocalAccess, express.json({ limit: "1mb" }));
  router.post("/", async (req, res, next) => {
    if (!PanelRequestSchema.safeParse(req.body).success) {
      res.status(400).json({ error: { code: "INVALID_PANEL_REQUEST", message: "Choose a supported provider settings operation." } });
      return;
    }
    try { res.json(await service.handle(req.body)); } catch (error) { next(error); }
  });
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error && typeof error === "object" && "type" in error && error.type === "entity.too.large") {
      res.status(413).json({ error: { code: "PANEL_REQUEST_TOO_LARGE", message: "Provider settings requests must be smaller than 1 MB." } }); return;
    }
    if (error && typeof error === "object" && "type" in error && error.type === "entity.parse.failed") {
      res.status(400).json({ error: { code: "INVALID_PANEL_REQUEST", message: "Provider settings require valid JSON." } }); return;
    }
    const reportedCode = error instanceof DriverError ? error.code :
      error instanceof Error && error.message === "CONNECTION_BUSY" ? "CONNECTION_BUSY" : "DRIVER_PANEL_UNAVAILABLE";
    const code = Object.hasOwn(publicErrors, reportedCode) ? reportedCode : "DRIVER_PANEL_UNAVAILABLE";
    const failure = publicErrors[code] ?? { status: 502, message: "The driver settings request could not finish. Check the host connection. Do not retry an uncertain pairing; reconcile it on the host first." };
    // Never echo upstream/native messages: they may contain credential paths or values.
    res.status(failure.status).json({ error: { code, message: failure.message } });
  };
  router.use(errors);
  return router;
}
