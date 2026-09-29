import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { AgenticClient } from "@agenticdriver/sdk/client";
import { codex } from "@agenticdriver/sdk/providers";
import { AgentProviderSettingsPatchSchema } from "@litagent/contracts";
import { AgenticDriverCatalog } from "./agenticdriver";
import { AgentProviderSettingsStore } from "./index";

// Actual SDK adapter descriptors, never completion doubles. Live execution is
// opt-in via test:driver-live so a normal test run cannot spend account usage.
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function policy(models?: string[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-driver-policy-")); roots.push(root);
  const native = codex({ id: "local-codex", ...(models === undefined ? {} : { models }) });
  const client = new AgenticClient({ url: "http://127.0.0.1:1", token: () => { throw new Error("Policy tests must not contact a host"); } });
  const catalog = new AgenticDriverCatalog(client, [native.info]);
  const settings = new AgentProviderSettingsStore(path.join(root, "settings.json"));
  return { root, catalog, settings, native, id: "driver.local-codex" };
}

it("requires explicit enablement before contacting any provider", () => {
  const { root, catalog, id } = policy();
  expect(catalog.discover().find((p) => p.id === id)).toMatchObject({ enabled: false, defaultModel: null });
  expect(() => catalog.createAdapter(id)!.startSession({ cwd: root, prompt: "Must not run", runId: "disabled" })).toThrow(/Enable/);
});

it("persists explicit model choices and applies disablement to cached adapters", () => {
  const { root, catalog, settings, id } = policy(["gpt-6-luna"]);
  settings.patch(id, { enabled: true, defaultModel: "gpt-6-luna" }, [catalog.definition(id)!]);
  catalog.setSettings(settings.read());
  const adapter = catalog.createAdapter(id)!;
  settings.patch(id, { enabled: false }, [catalog.definition(id)!]);
  catalog.setSettings(settings.read());
  expect(() => adapter.startSession({ cwd: root, prompt: "Must not run", runId: "disabled" })).toThrow(/Enable/);
  expect(new AgentProviderSettingsStore(path.join(root, "settings.json")).read()[id]?.defaultModel).toBe("gpt-6-luna");
});

it("denies empty allowlists without inferring permission from inventory", () => {
  const { catalog, id } = policy([]);
  expect(() => catalog.validateSettings(id, { enabled: true })).toThrow(/permitted/);
  expect(() => catalog.validateSettings(id, { defaultModel: "gpt-6-luna" })).toThrow(/permitted/);
});

it("rechecks changed restrictions in cached adapters without selecting a fallback", () => {
  const { root, catalog, settings, native, id } = policy(["gpt-6-luna"]);
  settings.patch(id, { enabled: true, defaultModel: "gpt-6-luna" }, [catalog.definition(id)!]);
  catalog.setSettings(settings.read());
  const adapter = catalog.createAdapter(id)!;
  catalog.recordDiscovery([{ ...native.info, models: [] }]);
  expect(catalog.discover().find((p) => p.id === id)?.defaultModel).toBe("gpt-6-luna");
  expect(() => adapter.startSession({ cwd: root, prompt: "Must not run", runId: "revoked" })).toThrow(/permitted/);
});

it("does not restore command-based provider configuration", () => {
  expect(() => AgentProviderSettingsPatchSchema.parse({ command: "/bin/sh" })).toThrow(/command/);
});
