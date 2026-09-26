import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgenticDriver } from "@agenticdriver/sdk";
import { mockProvider } from "@agenticdriver/sdk/providers";
import { serve } from "@agenticdriver/sdk/server";
import { AgenticDriverRegistry } from "@litagent/agents/agenticdriver";
import { AgentProviderCatalog, AgentProviderSettingsStore } from "@litagent/agents";
import { DriverConnectionStore, driverConnectionRoutes } from "./driver-connection";
import { DriverPanelService } from "./driver-panel";

beforeEach(() => { vi.spyOn(AgentProviderCatalog.prototype, "discover").mockReturnValue([]); });
afterEach(() => { vi.restoreAllMocks(); });

it("persists private local connection setup, rejects foreign origins and requires explicit enablement", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-connection-"));
  const token = "synthetic-private-driver-bearer-credential";
  const host = await serve(new AgenticDriver({ providers: [mockProvider(() => ({ text: "Unused" }))] }), { port: 0, tokens: [{ token, subject: "fixture", providers: ["mock"] }] });
  const catalog = new AgenticDriverRegistry();
  const store = new DriverConnectionStore(path.join(root, ".litagent/driver-connection.json"));
  const settings = new AgentProviderSettingsStore(path.join(root, ".litagent/provider-settings.json"));
  const service = new DriverPanelService(catalog, store, settings, {});
  await service.reload();
  const app = express(); app.use(express.json()); app.use("/driver", driverConnectionRoutes(catalog, store, settings, () => service.reload()));
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/driver`;
  const send = (body: unknown, origin = "http://localhost:5173", local = "1") => fetch(url, { method: "PUT", headers: { "Content-Type": "application/json", Origin: origin, "X-LitAgent-Local": local }, body: JSON.stringify(body) });
  try {
    expect((await send({ url: host.url, token }, "https://evil.example")).status).toBe(403);
    expect((await send({ url: host.url, token }, "http://localhost:5173", "")).status).toBe(403);
    expect((await send({ url: "http://remote.example", token })).status).toBe(400);
    const tokenFile = path.join(root, "private.token"); fs.writeFileSync(tokenFile, token, { mode: 0o600 });
    const result = await send({ url: host.url, tokenFile });
    const text = await result.text(); expect(result.status).toBe(200);
    expect(text).not.toContain(token); expect(text).not.toContain(tokenFile);
    expect(JSON.parse(text).connection.status).toBe("ready");
    expect(JSON.parse(text).providers.find((p: { id: string }) => p.id === "driver.mock").enabled).toBe(false);
    expect(fs.statSync(store.file).mode & 0o777).toBe(0o600);
    expect(new DriverConnectionStore(store.file).read()).toMatchObject({ url: host.url, token });
    expect(store.read()?.connectionId).toMatch(/^[a-f0-9-]{36}$/);
    settings.patch("driver.mock", { enabled: true, connected: true, defaultModel: "demo" }, [catalog.definition("driver.mock")!]);
    catalog.setSettings(settings.read());
    await send({ url: host.url });
    expect(settings.read()["driver.mock"]?.enabled).toBe(true);
    const denied = await send({ url: host.url, token: "different-account-credential-not-permitted" });
    expect((await denied.json() as { connection: { status: string } }).connection.status).toBe("error");
    expect(settings.read()["driver.mock"]?.enabled).toBe(false);
    expect(settings.read()["driver.mock"]?.defaultModel).toBe(null);
    expect(store.prepare({ url: host.url }).token).toBe("different-account-credential-not-permitted");
    fs.symlinkSync(tokenFile, path.join(root, "linked.token"));
    expect((await send({ url: host.url, tokenFile: path.join(root, "linked.token") })).status).toBe(400);
    const bad = await send({ url: `https://secret-user:${token}@example.test`, token });
    expect(await bad.text()).not.toContain(token);
    store.add({ url: host.url, token: "second-synthetic-credential" });
    const before = store.list();
    expect((await send({ url: host.url, token })).status).toBe(409);
    expect(store.list()).toEqual(before);
  } finally { await host.close(); await new Promise<void>((resolve) => server.close(() => resolve())); fs.rmSync(root, { recursive: true, force: true }); }
}, 15_000);

it("migrates the old private connection without reassigning provider IDs and never reuses a removed namespace", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-connection-migration-"));
  try {
    const file = path.join(root, "driver-connection.json");
    fs.writeFileSync(file, JSON.stringify({ url: "https://driver.example", token: "private-original-credential" }), { mode: 0o600 });
    const store = new DriverConnectionStore(file);
    store.initialize({});
    const original = store.read()!;
    expect(original).toMatchObject({ legacyIds: true, deviceName: "driver.example" });
    const client = store.clientIdentity();
    const other = store.add(store.prepare({ url: "https://other.example", token: "separate-private-credential", label: "Lab", deviceName: "lab-pc" }, null));
    expect(other.legacyIds).toBe(false);
    expect(() => store.prepare({ url: "https://driver.example" }, null)).toThrow();
    expect(() => store.add(store.prepare({ url: "https://other.example", token: "separate-private-credential" }, null))).toThrow("CONNECTION_EXISTS");
    expect(new DriverConnectionStore(file).clientIdentity()).toEqual(client);
    expect(new DriverConnectionStore(file).read(original.id)?.id).toBe(original.id);
    store.disconnect(original.id); store.disconnect(other.id);
    store.initialize({ AGENTICDRIVER_URL: "https://driver.example", AGENTICDRIVER_TOKEN: "should-not-reconnect" });
    expect(store.list()).toEqual([]);
    expect(store.add({ url: "https://new.example", token: "new-private-credential" }).legacyIds).toBe(false);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
