import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { connectionInvitation } from "@agenticdriver/sdk/client";
import { managedHost } from "@agenticdriver/sdk/management";
import { configuredServer } from "@agenticdriver/sdk/host";
import { withConnections } from "@agenticdriver/sdk/connections";
import { serve } from "@agenticdriver/sdk/server";
import type { ProviderPanelState } from "@agenticdriver/sdk/panel";
import { AgenticDriverRegistry } from "@litagent/agents/agenticdriver";
import { AgentProviderCatalog, AgentProviderSettingsStore } from "@litagent/agents";
import { DriverConnectionStore } from "./driver-connection";
import { DriverPanelService, driverPanelRoutes } from "./driver-panel";

// These tests exercise SDK fixture hosts, not installed CLI accounts or binaries.
beforeEach(() => { vi.spyOn(AgentProviderCatalog.prototype, "discover").mockReturnValue([]); });
afterEach(() => { vi.restoreAllMocks(); });

it("resolves the shared panel and execution client from the exact SDK alpha", () => {
  const directory = path.dirname(fileURLToPath(import.meta.resolve("@agenticdriver/sdk")));
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, "..", "package.json"), "utf8"));
  expect(manifest).toMatchObject({ name: "@agenticdriver/sdk", version: "0.2.0-alpha.2" });
  for (const subpath of ["client", "panel", "ui", "connections"])
    expect(path.dirname(fileURLToPath(import.meta.resolve(`@agenticdriver/sdk/${subpath}`)))).toBe(directory);
});

async function fixture(staticProviders: string[] = [], legacy = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-panel-"));
  const token = "fixture-private-operator-credential-not-a-real-account";
  const config = path.join(root, "host.json");
  fs.writeFileSync(config, JSON.stringify({
    version: 1, listen: { host: "127.0.0.1", port: 0 },
    providers: [{ id: "all", kind: "mock", name: "Fixture provider" }, { id: "denied", kind: "mock", models: [] }],
    tokens: [{ id: "operator", subject: "operator", providers: staticProviders, manageProviders: true, tokenRef: { env: "FIXTURE_TOKEN" } }],
  }), { mode: 0o600 });
  const host = await managedHost(config);
  const server = await serve(host.driver, withConnections({
    ...await configuredServer(host.config(), config, async () => token), ...(legacy ? {} : { management: host.management }),
  }, host.connections));
  const store = new DriverConnectionStore(path.join(root, "app", ".litagent", "driver-connection.json"));
  const settings = new AgentProviderSettingsStore(path.join(root, "app", ".litagent", "provider-settings.json"));
  const catalog = new AgenticDriverRegistry();
  const service = new DriverPanelService(catalog, store, settings, {});
  await service.reload();
  const app = express(); app.use("/panel", driverPanelRoutes(service));
  const api = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => api.once("listening", resolve));
  const url = `http://127.0.0.1:${(api.address() as AddressInfo).port}/panel`;
  const send = (body: unknown, origin = "http://localhost:5173", local = "1") => fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin, "X-LitAgent-Local": local }, body: JSON.stringify(body),
  });
  return { root, token, host, server, store, settings, catalog, service, send,
    async pair(manageProviders: boolean, providers: string[]) {
      const invite = await host.connections.create({ grant: { subject: "synthetic-litagent", providers, manageProviders } });
      const invitation = connectionInvitation(server.url, invite.code);
      const response = await send({ action: "connect", invitation });
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).not.toContain(invite.code); expect(text).not.toContain(token);
      return { invitation, state: JSON.parse(text) as ProviderPanelState };
    },
    async close() { await server.close(); await new Promise<void>((resolve) => api.close(() => resolve())); fs.rmSync(root, { recursive: true, force: true }); },
  };
}

it("pairs with backend-only credentials, preserves app choices on refresh and persists disconnect", async () => {
  const f = await fixture();
  try {
    const { invitation, state } = await f.pair(false, ["all", "denied"]);
    expect(state.management).toBeUndefined();
    expect(state.providers.find((p) => p.id === "all")?.models).toBeUndefined();
    expect(state.providers.find((p) => p.id === "denied")?.models).toEqual([]);
    expect(f.catalog.discover().find((p) => p.id === "driver.all")?.enabled).toBe(false);
    expect(fs.statSync(f.store.file).mode & 0o777).toBe(0o600);
    f.settings.patch("driver.all", { enabled: true, connected: true, defaultModel: "demo" }, [f.catalog.definition("driver.all")!]);
    f.catalog.setSettings(f.settings.read());
    await f.send({ action: "snapshot", refresh: true });
    expect(f.catalog.discover().find((p) => p.id === "driver.all")).toMatchObject({ enabled: true, defaultModel: "demo" });
    expect((await f.send({ action: "connect", invitation })).status).toBe(400);
    const restarted = new DriverPanelService(f.catalog, new DriverConnectionStore(f.store.file), f.settings, {});
    await restarted.reload();
    expect((await restarted.handle({ action: "snapshot" }) as ProviderPanelState).connection?.id).toBe(state.connection?.id);
    await f.send({ action: "disconnect" });
    expect(f.catalog.connectionStatus().configured).toBe(false);
    expect(f.settings.read()["driver.all"]).toMatchObject({ enabled: false, defaultModel: "demo" });
    const withEnvironment = new DriverPanelService(f.catalog, f.store, f.settings, { AGENTICDRIVER_URL: f.server.url, AGENTICDRIVER_TOKEN: f.token });
    await withEnvironment.reload();
    expect((await withEnvironment.handle({ action: "snapshot" }) as ProviderPanelState).connected).toBe(false);
  } finally { await f.close(); }
}, 15_000);

it("allows management separately from execution and rejects stale provider changes", async () => {
  const f = await fixture();
  try {
    const { state } = await f.pair(true, []);
    expect(state.providers).toHaveLength(2);
    expect(state.management?.executionProviders).toEqual([]);
    expect(f.catalog.discover().filter((p) => p.id.startsWith("driver."))).toHaveLength(0);
    const request = { action: "configure", change: { revision: state.management!.revision, provider: { id: "all", kind: "mock", name: "Renamed fixture", models: ["demo"] } } };
    const changed = await f.send(request);
    expect(changed.status).toBe(200);
    expect((await changed.json() as ProviderPanelState).providers.find((p) => p.id === "all")?.models).toEqual(["demo"]);
    expect((await f.send(request)).status).toBe(409);
    expect(() => f.catalog.validateSettings("driver.all", { enabled: true })).toThrow();
    await f.pair(false, ["all"]);
    const forbidden = await f.send({ ...request, change: { ...request.change, revision: f.host.management.snapshot().revision } });
    expect(forbidden.status).toBe(403);
  } finally { await f.close(); }
});

it("removes a provider only with management authority and the current revision", async () => {
  const f = await fixture();
  try {
    const { state } = await f.pair(true, []);
    expect(state.management?.removalSupported).toBe(true);
    const request = { action: "configure", change: { revision: state.management!.revision, provider: { id: "all", kind: "mock" }, remove: true } };
    const removed = await f.send(request);
    expect(removed.status).toBe(200);
    expect((await removed.json() as ProviderPanelState).providers.map((provider) => provider.id)).toEqual(["denied"]);
    expect((await f.send(request)).status).toBe(409);
    await f.pair(false, ["denied"]);
    expect((await f.send({ action: "configure", change: { revision: f.host.management.snapshot().revision,
      provider: { id: "denied", kind: "mock" }, remove: true } })).status).toBe(403);
    expect(f.host.management.snapshot().providers.map((provider) => provider.id)).toEqual(["denied"]);
  } finally { await f.close(); }
});

it("reports referenced provider removal as a recoverable conflict without exposing host details", async () => {
  const f = await fixture(["all"]);
  try {
    const { state } = await f.pair(true, []);
    const denied = await f.send({ action: "configure", change: { revision: state.management!.revision,
      provider: { id: "all", kind: "mock" }, remove: true } });
    expect(denied.status).toBe(409);
    const body = await denied.text();
    expect(JSON.parse(body).error.code).toBe("PROVIDER_IN_USE");
    expect(body).not.toContain(f.token);
    expect(body).not.toContain(f.root);
    expect(f.host.management.snapshot().providers).toHaveLength(2);
  } finally { await f.close(); }
});

it("keeps legacy hosts without management capabilities read-only", async () => {
  const f = await fixture([], true);
  try {
    const { state } = await f.pair(false, ["all"]);
    expect(state.connected).toBe(true);
    expect(state.management).toBeUndefined();
    expect(state.setup).toBeUndefined();
    expect(state.canInvite).toBe(false);
  } finally { await f.close(); }
});

it("keeps expired/revoked connections unavailable and returns fixed public errors", async () => {
  const f = await fixture();
  try {
    await f.pair(false, ["all"]);
    const saved = f.store.read()!;
    await f.host.connections.revoke({ id: saved.connectionId });
    const denied = await f.send({ action: "snapshot", refresh: true });
    expect(denied.status).toBe(401);
    expect(await denied.text()).not.toContain(saved.token);
    expect(f.catalog.connectionStatus().status).toBe("error");
    f.store.save({ ...saved, expiresAt: "2020-01-01T00:00:00Z" });
    await f.service.reload();
    expect((await f.send({ action: "snapshot" })).status).toBe(401);
  } finally { await f.close(); }
});

it("guards all panel operations and bounds input without sending any model requests", async () => {
  const f = await fixture();
  try {
    expect((await f.send({ action: "snapshot" }, "https://foreign.example")).status).toBe(403);
    expect((await f.send({ action: "snapshot" }, "http://localhost", "")).status).toBe(403);
    const invalid = await f.send({ action: "run", input: "Do not execute" });
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get("cache-control")).toBe("no-store");
    const huge = await f.send({ action: "connect", invitation: "x".repeat(1_100_000) });
    expect(huge.status).toBe(413);
    await f.store.withLock(async () => {
      expect((await f.send({ action: "disconnect" })).status).toBe(409);
      expect((await f.send({ action: "snapshot" })).status).toBe(200);
    });
    const disconnected = await f.send({ action: "snapshot" });
    expect((await disconnected.json() as ProviderPanelState).connected).toBe(false);
  } finally { await f.close(); }
});

it("supports many-to-many pairings with independent credentials, host setup and app preferences", async () => {
  const a = await fixture(), b = await fixture();
  try {
    await a.pair(false, ["all"]);
    const aFirst = a.store.read()!;
    const bInvite = await b.host.connections.create({ grant: { subject: "LitAgent on desktop", providers: ["all"], manageProviders: true } });
    await a.service.handle({ action: "connect", invitation: connectionInvitation(b.server.url, bInvite.code) }, "new");
    const aSecond = a.store.list()[1]!;
    expect((await a.send({ action: "disconnect" })).status).toBe(409);
    expect(a.store.list()).toHaveLength(2);
    const aInvite = await a.host.connections.create({ grant: { subject: "LitAgent on laptop", providers: ["all"] } });
    await b.service.handle({ action: "connect", invitation: connectionInvitation(a.server.url, aInvite.code) }, "new");
    const bFirst = b.store.read()!;
    expect(bFirst.token).not.toBe(aFirst.token);
    expect(a.service.connections().client.id).not.toBe(b.service.connections().client.id);
    a.store.rename(aSecond.id, { label: "Lab driver", deviceName: "lab-workstation" });
    await a.service.reload();
    const providers = a.catalog.discover().filter((p) => p.driver);
    expect(providers).toHaveLength(2);
    const second = providers.find((p) => p.driver?.connectionId === aSecond.id)!;
    expect(second.driver?.deviceName).toBe("lab-workstation");
    a.settings.patch(second.id, { enabled: true, defaultModel: "demo" }, [a.catalog.definition(second.id)!]);
    a.catalog.setSettings(a.settings.read());
    const snapshot = await a.service.handle({ action: "snapshot" }, aSecond.id) as ProviderPanelState;
    await a.service.handle({ action: "configure", change: { revision: snapshot.management!.revision,
      provider: { id: "all", kind: "mock", name: "Shared host setup", models: ["demo", "fast"] } } }, aSecond.id);
    expect(b.host.management.snapshot().providers.find((p) => p.id === "all")?.name).toBe("Shared host setup");
    // Host setup is shared; app enablement and model defaults are not.
    expect(a.catalog.discover().find((p) => p.id === second.id)).toMatchObject({ enabled: true, defaultModel: "demo" });
    await a.host.connections.revoke({ id: aFirst.connectionId });
    await expect(a.service.handle({ action: "snapshot", refresh: true }, aFirst.id)).rejects.toThrow();
    expect((await b.service.handle({ action: "snapshot", refresh: true }, bFirst.id) as ProviderPanelState).connected).toBe(true);
    expect(a.catalog.discover().find((p) => p.id === second.id)?.driver?.available).toBe(true);
    await a.service.handle({ action: "disconnect" }, aFirst.id);
    expect(a.store.list().map((entry) => entry.id)).toEqual([aSecond.id]);
    await expect(a.service.handle({ action: "snapshot" }, aFirst.id)).rejects.toThrow();
    const restarted = new DriverPanelService(new AgenticDriverRegistry(a.settings.read()), new DriverConnectionStore(a.store.file), a.settings, {});
    await restarted.reload();
    expect(restarted.connections()).toMatchObject({ client: a.service.connections().client,
      connections: [{ id: aSecond.id, label: "Lab driver", deviceName: "lab-workstation", status: "ready" }] });
    const publicData = JSON.stringify(restarted.connections());
    for (const secret of [aFirst.token, aSecond.token, bFirst.token]) expect(publicData).not.toContain(secret);
  } finally { await a.close(); await b.close(); }
}, 20_000);
