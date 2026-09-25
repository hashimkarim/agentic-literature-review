import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { connectionInvitation } from "@litagent/driver-panel-sdk/client";
import { managedHost } from "@litagent/driver-panel-sdk/management";
import { configuredServer } from "@litagent/driver-panel-sdk/host";
import { withConnections } from "@litagent/driver-panel-sdk/connections";
import { serve } from "@litagent/driver-panel-sdk/server";
import type { ProviderPanelState } from "@litagent/driver-panel-sdk/panel";
import { AgenticDriverCatalog } from "@litagent/agents/agenticdriver";
import { AgentProviderSettingsStore } from "@litagent/agents";
import { DriverConnectionStore } from "./driver-connection";
import { DriverPanelService, driverPanelRoutes } from "./driver-panel";

it("uses the reviewed source candidate rather than the registry archive with the same version", () => {
  const archive = fs.readFileSync(new URL("../../../vendor/agenticdriver-panel-3217b8d.tgz", import.meta.url));
  expect(createHash("sha256").update(archive).digest("hex")).toBe("65b68ebdca8d497e4e175473b55344d2640c136626b3614ffb4540284e9adb3a");
});

it("changes only package identity and CLI registration in the isolated settings package", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-panel-integrity-"));
  try {
    for (const [name, archive] of [["original", "agenticdriver-panel-3217b8d.tgz"], ["installed", "litagent-driver-panel-3217b8d.tgz"]]) {
      fs.mkdirSync(path.join(root, name!));
      execFileSync("tar", ["-xzf", new URL(`../../../vendor/${archive}`, import.meta.url).pathname, "-C", path.join(root, name!)]);
    }
    const files = (directory: string) => fs.readdirSync(directory, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile()).map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name))).sort();
    const original = path.join(root, "original/package"), installed = path.join(root, "installed/package");
    expect(files(installed)).toEqual(files(original));
    for (const file of files(original)) {
      if (file === "package.json") continue;
      expect(fs.readFileSync(path.join(installed, file)).equals(fs.readFileSync(path.join(original, file))), file).toBe(true);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(original, "package.json"), "utf8"));
    delete manifest.bin;
    expect(JSON.parse(fs.readFileSync(path.join(installed, "package.json"), "utf8"))).toEqual({ ...manifest, name: "@litagent/driver-panel-sdk", version: "0.1.0-litagent-panel.3217b8d" });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-panel-"));
  const token = "fixture-private-operator-credential-not-a-real-account";
  const config = path.join(root, "host.json");
  fs.writeFileSync(config, JSON.stringify({
    version: 1, listen: { host: "127.0.0.1", port: 0 },
    providers: [{ id: "all", kind: "mock", name: "Fixture provider" }, { id: "denied", kind: "mock", models: [] }],
    tokens: [{ id: "operator", subject: "operator", providers: [], manageProviders: true, tokenRef: { env: "FIXTURE_TOKEN" } }],
  }), { mode: 0o600 });
  const host = await managedHost(config);
  const server = await serve(host.driver, withConnections({
    ...await configuredServer(host.config(), config, async () => token), management: host.management,
  }, host.connections));
  const store = new DriverConnectionStore(path.join(root, "app", ".litagent", "driver-connection.json"));
  const settings = new AgentProviderSettingsStore(path.join(root, "app", ".litagent", "provider-settings.json"));
  const catalog = new AgenticDriverCatalog(null, []);
  const service = new DriverPanelService(catalog, store, settings, {});
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
});

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
    await f.store.withLock(async () => { expect((await f.send({ action: "disconnect" })).status).toBe(409); });
    const disconnected = await f.send({ action: "snapshot" });
    expect((await disconnected.json() as ProviderPanelState).connected).toBe(false);
  } finally { await f.close(); }
});
