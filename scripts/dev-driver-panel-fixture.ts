import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { managedHost } from "@litagent/driver-panel-sdk/management";
import { configuredServer } from "@litagent/driver-panel-sdk/host";
import { withConnections } from "@litagent/driver-panel-sdk/connections";
import { connectionInvitation } from "@litagent/driver-panel-sdk/client";
import { serve } from "@litagent/driver-panel-sdk/server";

// Disposable metadata/pairing fixtures for native T3 browser checks. No real providers.
const { values } = parseArgs({ options: {
  directory: { type: "string" }, device: { type: "string" }, port: { type: "string" },
} });
if (values.device && !["desktop", "lab"].includes(values.device)) throw new Error("Choose desktop or lab.");
if (values.port && (!values.device || !/^\d+$/.test(values.port) || Number(values.port) > 65535)) throw new Error("A port requires one fixture device.");
const root = values.directory ? path.resolve(values.directory) : fs.mkdtempSync(path.join(os.tmpdir(), "litagent-driver-panel-ui-"));
fs.mkdirSync(root, { recursive: true });
const servers: Awaited<ReturnType<typeof serve>>[] = [];
for (const name of values.device ? [values.device] : ["desktop", "lab"]) {
  const token = randomBytes(32).toString("hex");
  const config = path.join(root, `${name}.json`);
  if (!fs.existsSync(config)) fs.writeFileSync(config, JSON.stringify({ version: 1, listen: { host: "127.0.0.1", port: 0 },
    providers: [{ id: "shared", kind: "mock", name: "Fixture provider", models: ["demo", "fast"] }],
    tokens: [{ id: "operator", subject: "fixture-operator", providers: [], manageProviders: true, tokenRef: { env: "FIXTURE_ONLY" } }],
  }), { mode: 0o600 });
  const existing = JSON.parse(fs.readFileSync(config, "utf8"));
  if (!Array.isArray(existing.providers) || existing.providers.some((entry: { kind?: string }) => entry.kind !== "mock"))
    throw new Error("This fixture may only reopen mock providers.");
  const host = await managedHost(config);
  const server = await serve(host.driver, withConnections({
    ...await configuredServer(host.config(), config, async () => token), host: "127.0.0.1", port: Number(values.port ?? 0), management: host.management,
  }, host.connections));
  servers.push(server);
  const grant = await host.connections.create({ grant: { subject: `LitAgent on ${os.hostname()}`, providers: ["shared"], manageProviders: name === "desktop" } });
  const invitationFile = path.join(root, `${name}.invitation`);
  fs.writeFileSync(invitationFile, connectionInvitation(server.url, grant.code), { mode: 0o600 });
  console.log(JSON.stringify({ device: name, url: server.url, invitationFile }));
}
process.on("SIGINT", () => { void Promise.all(servers.map((server) => server.close())).then(() => process.exit(0)); });
process.on("SIGTERM", () => { void Promise.all(servers.map((server) => server.close())).then(() => process.exit(0)); });
