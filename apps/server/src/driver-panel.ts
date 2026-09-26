import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import express, { type ErrorRequestHandler } from "express";
import { AgenticClient, DriverError } from "@litagent/driver-panel-sdk/client";
import { connectClient } from "@litagent/driver-panel-sdk/connections";
import { providerPanel, PanelRequestSchema, type ProviderPanelState } from "@litagent/driver-panel-sdk/panel";
import { providerPresentation } from "@litagent/driver-panel-sdk/catalog";
import type { AgenticDriverRegistry } from "@litagent/agents/agenticdriver";
import type { AgentProviderSettingsStore } from "@litagent/agents";
import type { DriverConnections } from "@litagent/contracts";
import { DriverConnectionStore, disableDriverConnection, clearNewConnectionChoices, type DriverHostRecord } from "./driver-connection";
import { requireLocalAccess } from "./local-access";

/** Settings-only candidate SDK. Workflow execution stays on the registry SDK adapter. */
export class DriverPanelService {
  private readonly clients = new Map<string, { client: AgenticClient; record: DriverHostRecord }>();

  constructor(
    private readonly catalog: AgenticDriverRegistry,
    private readonly store: DriverConnectionStore,
    private readonly settings: AgentProviderSettingsStore,
    private readonly environment = process.env,
  ) {}

  async reload(): Promise<void> {
    try { this.store.initialize(this.environment); this.catalog.setConfigurationError(false); }
    catch { this.catalog.setConfigurationError(true); return; }
    const records = this.store.list();
    for (const id of this.clients.keys()) {
      if (!records.some((entry) => entry.id === id)) {
        this.clients.delete(id);
        await this.catalog.disconnectHost(id);
      }
    }
    await Promise.all(records.map(async (value) => {
      const previous = this.clients.get(value.id);
      if (previous && previous.record.url === value.url && previous.record.token === value.token && previous.record.expiresAt === value.expiresAt) {
        previous.record = value;
        this.catalog.host(value.id)?.setIdentity(value);
        return;
      }
      // Existing streams retain their original client, credentials and cancellation.
      const token = () => {
        if (value.expiresAt && Date.parse(value.expiresAt) <= Date.now())
          throw new DriverError("CONNECTION_EXPIRED", "Pair this application again.");
        return value.token;
      };
      const client = new AgenticClient({ url: value.url, token });
      this.clients.set(value.id, { client, record: value });
      await this.catalog.configureHost(value, value.url, token, async () => {
        const [protocol, providers] = await Promise.all([client.protocol(), client.providers({ refresh: true })]);
        if (!protocol.features.includes("provider-management")) return providers;
        const management = await client.management();
        // Management visibility is not execution permission. Older hosts fail closed.
        const allowed = new Set(management.executionProviders ?? []);
        return providers.filter((provider) => allowed.has(provider.id));
      });
    }));
  }

  connections(): DriverConnections {
    return { client: this.store.clientIdentity(), connections: this.store.list().map((record) => ({
      ...this.catalog.host(record.id)!.connectionStatus(), id: record.id, label: record.label,
      deviceName: record.deviceName, expiresAt: record.expiresAt ?? null,
    })) };
  }

  private async connect(invitation: string, id: string | null): Promise<string> {
    const directory = path.join(path.dirname(this.store.file), "driver-pairings", randomUUID());
    const profile = await connectClient(invitation, path.join(directory, "connection.json"));
    let record: DriverHostRecord;
    try {
      const value = this.store.prepare({ url: profile.url, tokenFile: path.join(directory, profile.tokenFile) }, null);
      if (id) disableDriverConnection(this.catalog, this.settings, id, true);
      const paired = { ...value, connectionId: profile.id, expiresAt: profile.expiresAt };
      record = id ? this.store.save(paired, id) : this.store.add(paired);
      if (!id) clearNewConnectionChoices(this.catalog, this.settings, record);
    } catch {
      // Keep the private SDK profile for recovery after a consumed invitation.
      throw new DriverError("CONNECTION_SAVE_FAILED", "Reconcile the consumed invitation on the host before pairing again.", false, "uncertain");
    }
    fs.rmSync(directory, { recursive: true, force: true });
    await this.reload();
    return record.id;
  }

  async handle(input: unknown, connectionId?: string): Promise<unknown> {
    const request = PanelRequestSchema.parse(input);
    if (connectionId === undefined && this.store.list().length > 1)
      throw new DriverError("CONNECTION_REQUIRED", "Choose a specific driver connection.");
    let id = connectionId === "new" ? null : connectionId ?? this.store.read()?.id ?? null;
    if (id && !this.store.read(id)) throw new DriverError("CONNECTION_NOT_FOUND", "Connection not found.");
    const operation = async () => {
      const initialClient = id ? this.clients.get(id)?.client : undefined;
      const panel = providerPanel({
        client: () => id ? this.clients.get(id)?.client : undefined,
        connection: () => {
          const value = id ? this.clients.get(id)?.record : undefined;
          return value ? { id: value.id, label: `${value.label} (${value.deviceName})`, url: value.url } : undefined;
        },
        connect: async (invitation) => { id = await this.connect(invitation, id); },
        disconnect: async () => {
          if (id) { disableDriverConnection(this.catalog, this.settings, id, false); this.store.disconnect(id); }
          await this.reload(); id = null;
        },
        presentations: (providers) => Object.fromEntries(providers.map((provider) => [provider.id, providerPresentation(provider)])),
      });
      try {
        const result = await panel(request);
        if ((request.action === "snapshot" || request.action === "connections") && id && initialClient !== this.clients.get(id)?.client)
          throw new DriverError("CONNECTION_CHANGED", "Connection changed while refreshing.");
        if (id && ["snapshot", "configure", "connect"].includes(request.action)) {
          const state = result as ProviderPanelState;
          const allowed = state.management ? new Set(state.management.executionProviders ?? []) : null;
          this.catalog.host(id)?.recordDiscovery(state.providers.filter((provider) => !allowed || allowed.has(provider.id)));
        }
        if (id && request.action === "revoke") await this.catalog.refresh(id);
        return result;
      } catch (error) {
        if (id) await this.catalog.refresh(id);
        throw error;
      }
    };
    // React remounts and multiple browsers may discover concurrently. Only edits
    // consume the mutation lock; a refresh never blocks a second Settings view.
    return request.action === "snapshot" || request.action === "connections" ? operation() : this.store.withLock(operation);
  }
}

const publicErrors: Record<string, { status: number; message: string }> = {
  FORBIDDEN: { status: 403, message: "This connection has no host-management grant. Use a separate operator connection to manage providers." },
  UNAUTHORIZED: { status: 401, message: "The driver credential was rejected. Reconnect with a valid invitation or credential." },
  AUTH_UNAVAILABLE: { status: 401, message: "The driver credential is unavailable or expired. Reconnect with a valid invitation or credential." },
  CONFIG_CONFLICT: { status: 409, message: "Host settings changed. Refresh and review the current settings before saving again." },
  CONNECTION_BUSY: { status: 409, message: "Another connection update is in progress. Wait for it to finish." },
  CONNECTION_NOT_FOUND: { status: 404, message: "This connection was removed. Choose another connection." },
  CONNECTION_REQUIRED: { status: 409, message: "Choose a specific driver connection before continuing." },
  CONNECTION_CHANGED: { status: 409, message: "This connection changed while refreshing. Refresh its current settings." },
  CONNECTION_EXPIRED: { status: 401, message: "This connection expired. Pair LitAgent again." },
  INVITATION_REJECTED: { status: 400, message: "The invitation expired, was already used, or is invalid. Request a new invitation." },
  CONNECTION_SAVE_FAILED: { status: 409, message: "The invitation was consumed but local setup could not finish. Reconcile or revoke it on the host before pairing again." },
};

export function driverPanelRoutes(service: DriverPanelService): express.Router {
  const router = express.Router();
  router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  router.use(requireLocalAccess, express.json({ limit: "1mb" }));
  router.post(["/", "/:connectionId"], async (req, res, next) => {
    if (!PanelRequestSchema.safeParse(req.body).success) {
      res.status(400).json({ error: { code: "INVALID_PANEL_REQUEST", message: "Choose a supported provider settings operation." } });
      return;
    }
    try { res.json(await service.handle(req.body, typeof req.params.connectionId === "string" ? req.params.connectionId : undefined)); } catch (error) { next(error); }
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
    res.status(failure.status).json({ error: { code, message: failure.message } });
  };
  router.use(errors);
  return router;
}
