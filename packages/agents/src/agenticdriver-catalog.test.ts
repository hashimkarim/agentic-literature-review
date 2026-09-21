import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DriverError, type ProviderInfo } from "agenticdriver";
import { AgenticClient } from "agenticdriver/client";
import { mockProvider } from "agenticdriver/providers";
import type { ProviderAsset, UsageStatAccountQuota, UsageStatQuotaIdentity } from "agenticdriver/catalog";
import { AgentProviderSettingsSchema } from "@litagent/contracts";
import { AgentProviderCatalog } from "./index";
import { AgenticDriverCatalog, agenticDriverCatalogFromEnvironment } from "./agenticdriver";
import type { AgenticDriverCatalogBinding, AgenticDriverCatalogConfiguration } from "./agenticdriver-catalog";

const now = Date.parse("2026-09-21T03:00:00Z");
const maxAgeMs = 300_000;
const provider: ProviderInfo = {
  ...mockProvider().info, id: "codex-work", name: "Configured Codex", usageStatId: "codex",
};
const identity: UsageStatQuotaIdentity = {
  hostId: "research-host", provider: provider.id, accountId: "work-account", subject: "researcher",
};
const binding: AgenticDriverCatalogBinding = { identity, accountLabel: "Research account" };
const client = new AgenticClient({ url: "http://127.0.0.1:7433", token: "offline-catalog-test-token-32-characters" });
const asset: ProviderAsset = {
  providerId: "codex", variant: "monochrome", src: `/assets/providers/${"a".repeat(64)}.svg`,
  mediaType: "image/svg+xml", sha256: "a".repeat(64), monochrome: true, supportsCurrentColor: true,
  license: { id: "MIT", attribution: "Reviewed upstream notices", noticeUrl: `/assets/providers/${"b".repeat(64)}.txt` },
};

function receipt(scope = identity, used = 20): UsageStatAccountQuota {
  return {
    identity: { ...scope }, upstreamInstanceId: "private-upstream-instance",
    snapshot: {
      displayName: "private administrative display", source: "api", fetchedAt: new Date(now).toISOString(),
      resources: { weekly: { label: "Weekly tokens", used, limit: 100, remaining: 100 - used, unit: "tokens" } },
    },
  };
}
function configuration(overrides: Partial<AgenticDriverCatalogConfiguration> = {}): AgenticDriverCatalogConfiguration {
  return {
    hostId: identity.hostId, subject: identity.subject,
    bindingFor: () => structuredClone(binding), accountLimits: async (scope) => receipt(scope),
    metadata: [{ id: "codex", displayName: "Codex", brandColor: "#123456" }],
    maxAgeMs, now: () => now, ...overrides,
  };
}
function catalog(config: AgenticDriverCatalogConfiguration = configuration(), providers = [provider]) {
  return new AgenticDriverCatalog(client, providers, {}, config);
}
function entry(value: AgenticDriverCatalog, id = provider.id) {
  return value.discover().find((item) => item.id === `driver.${id}`)!;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  // These tests exercise the SDK catalog surface without probing installed CLIs.
  vi.spyOn(AgentProviderCatalog.prototype, "discover").mockReturnValue([]);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("AgenticDriver catalog discovery", () => {
  it("keeps provider instances, linked accounts and quota observations distinct", async () => {
    const personal = { ...provider, id: "codex-personal" };
    const read = vi.fn(async (scope: UsageStatQuotaIdentity) => receipt(scope, scope.accountId === "work-account" ? 20 : 80));
    const value = catalog(configuration({
      assets: [asset], accountLimits: read,
      bindingFor: (id) => ({
        identity: { ...identity, provider: id, accountId: id === provider.id ? "work-account" : "personal-account" },
        accountLabel: id === provider.id ? "Research account" : "Personal account",
      }),
    }), [provider, personal]);
    await value.refreshCatalog();
    const work = entry(value), other = entry(value, personal.id);
    expect(work.label).toBe("Configured Codex (AgenticDriver)");
    expect(work.driverCatalog?.provider).toMatchObject({
      providerId: provider.id, name: "Codex", account: { id: "work-account", label: "Research account" },
      accessibleName: "Codex · Research account (codex-work)", icon: { kind: "asset", asset },
    });
    expect(other.driverCatalog?.provider.account?.id).toBe("personal-account");
    expect(other.driverCatalog?.provider.accessibleName).not.toBe(work.driverCatalog?.provider.accessibleName);
    expect(work.driverCatalog?.quota.resources[0]?.used).toBe(20);
    expect(other.driverCatalog?.quota.resources[0]?.used).toBe(80);
    expect(read).toHaveBeenCalledWith(identity);
    expect(read).toHaveBeenCalledWith({ ...identity, provider: personal.id, accountId: "personal-account" });
    expect(work.enabled).toBe(false);
    expect(() => value.createAdapter(work.id)!.startSession({ cwd: ".", runId: "catalog-does-not-authorize", prompt: "Q" })).toThrow("Enable");
    const serialized = JSON.stringify(work);
    expect(serialized).not.toContain("private-upstream-instance");
    expect(serialized).not.toContain("private administrative display");
    expect(serialized).not.toContain(identity.hostId);
    expect(serialized).not.toContain('"subject"');
  });

  it("returns SDK fallbacks with no configuration and leaves the default environment integration absent", async () => {
    const value = new AgenticDriverCatalog(client, [provider]);
    await value.refreshCatalog();
    expect(entry(value).driverCatalog).toMatchObject({
      provider: { accountLabel: "Account not linked", icon: { kind: "fallback", reason: "metadata-missing" } },
      quota: { state: "unbound", resources: [] },
    });
    vi.stubEnv("AGENTICDRIVER_URL", "");
    vi.stubEnv("AGENTICDRIVER_TOKEN", "");
    const discovery = vi.spyOn(AgenticClient.prototype, "providers");
    const local = await agenticDriverCatalogFromEnvironment({}, configuration());
    expect(local).not.toBeInstanceOf(AgenticDriverCatalog);
    expect(discovery).not.toHaveBeenCalled();
  });

  it("matches metadata only by usageStatId and omits raw administrative fields", () => {
    const value = catalog(configuration({ metadata: [{
      id: "codex", displayName: "Codex", secret: "catalog-token", icon: { kind: "svg", path: "/private/catalog/icon.svg" },
    }], assets: [asset] }));
    expect(entry(value).driverCatalog?.provider.icon.kind).toBe("asset");
    expect(JSON.stringify(entry(value))).not.toContain("catalog-token");
    expect(JSON.stringify(entry(value))).not.toContain("/private/catalog");
    value.setCatalogConfiguration(configuration({ metadata: [{ id: provider.id, displayName: "Wrong provider" }, { id: identity.accountId, displayName: "Wrong account" }] }));
    expect(entry(value).driverCatalog?.provider).toMatchObject({
      name: provider.name, icon: { kind: "fallback", reason: "metadata-missing" },
    });
  });

  it("preserves missing-icon and missing-variant fallbacks, ignoring unsafe or ambiguous asset paths", () => {
    const value = catalog();
    expect(entry(value).driverCatalog?.provider.icon).toMatchObject({ kind: "fallback", reason: "icon-missing" });
    value.setCatalogConfiguration(configuration({ assets: [asset], variant: "color" }));
    expect(entry(value).driverCatalog?.provider.icon).toMatchObject({ kind: "fallback", reason: "variant-missing" });
    value.setCatalogConfiguration(configuration({ assets: [{ ...asset, src: "https://private.example/credential" }] }));
    expect(entry(value).driverCatalog?.provider.icon).toMatchObject({ kind: "fallback", reason: "icon-missing" });
    value.setCatalogConfiguration(configuration({ assets: [asset, asset] }));
    expect(entry(value).driverCatalog?.provider.icon).toMatchObject({ kind: "fallback", reason: "icon-missing" });
  });

  it.each(["hostId", "provider", "subject"] as const)("does not read quotas for a binding with a different %s", async (key) => {
    const read = vi.fn(async () => receipt());
    const value = catalog(configuration({
      bindingFor: () => ({ ...binding, identity: { ...identity, [key]: "outside-scope" } }), accountLimits: read,
    }));
    await value.refreshCatalog();
    expect(read).not.toHaveBeenCalled();
    expect(entry(value).driverCatalog?.provider.account).toBeUndefined();
    expect(entry(value).driverCatalog?.quota).toMatchObject({ state: "unbound", resources: [] });
  });

  it.each(["hostId", "provider", "accountId", "subject"] as const)("suppresses a quota receipt with a different %s", async (key) => {
    const value = catalog(configuration({ accountLimits: async () => receipt({ ...identity, [key]: "other-identity" }) }));
    await value.refreshCatalog();
    expect(entry(value).driverCatalog?.quota).toMatchObject({ state: "unbound", resources: [] });
  });

  it("allows explicit bindings without installing a quota reader", async () => {
    const config = configuration();
    delete config.accountLimits;
    const value = catalog(config);
    await value.refreshCatalog();
    expect(entry(value).driverCatalog?.provider.account?.id).toBe(identity.accountId);
    expect(entry(value).driverCatalog?.quota).toMatchObject({ state: "unavailable", resources: [] });
  });
});

describe("catalog quota freshness and errors", () => {
  it("recomputes freshness on discovery and retains the SDK cached quality", async () => {
    let clock = now;
    const quota = receipt();
    quota.snapshot.source = "cached";
    const value = catalog(configuration({ now: () => clock, accountLimits: async () => quota }));
    await value.refreshCatalog();
    expect(entry(value).driverCatalog?.quota).toMatchObject({ state: "fresh", quality: "cached", ageMs: 0 });
    quota.snapshot.resources.weekly!.used = 999;
    clock += maxAgeMs;
    expect(entry(value).driverCatalog?.quota).toMatchObject({
      state: "stale", quality: "cached", ageMs: maxAgeMs, resources: [{ used: 20 }],
    });
  });

  it("marks a passed reset boundary stale without fabricating a new balance", async () => {
    let clock = now;
    const quota = receipt();
    quota.snapshot.resources.weekly!.resetsAt = new Date(now + 1000).toISOString();
    const value = catalog(configuration({ now: () => clock, accountLimits: async () => quota }));
    await value.refreshCatalog();
    expect(entry(value).driverCatalog?.quota.state).toBe("fresh");
    clock += 1000;
    expect(entry(value).driverCatalog?.quota).toMatchObject({
      state: "stale", label: "Quota window ended; refresh required", resources: [{ used: 20, remaining: 80 }],
    });
  });

  it.each(["future", "negative", "invalid-date"])("preserves SDK unknown fallback for a %s snapshot", async (kind) => {
    const quota = receipt();
    if (kind === "future") quota.snapshot.fetchedAt = new Date(now + 1).toISOString();
    if (kind === "negative") quota.snapshot.resources.weekly!.used = -1;
    if (kind === "invalid-date") quota.snapshot.fetchedAt = "private invalid upstream value";
    const value = catalog(configuration({ accountLimits: async () => quota }));
    await value.refreshCatalog();
    expect(entry(value).driverCatalog?.quota).toMatchObject({ state: "unknown", resources: [] });
    expect(JSON.stringify(entry(value))).not.toContain("private invalid upstream value");
  });

  it("suppresses previous success after refresh failure without returning private error text", async () => {
    let error: Error | undefined;
    const value = catalog(configuration({ accountLimits: async () => { if (error) throw error; return receipt(); } }));
    await value.refreshCatalog();
    expect(entry(value).driverCatalog?.quota.state).toBe("fresh");
    error = new Error("private-account-token in upstream error");
    await value.refreshCatalog();
    expect(entry(value).driverCatalog?.quota).toMatchObject({ state: "error", label: "Quota refresh failed", resources: [] });
    expect(JSON.stringify(entry(value))).not.toContain("private-account-token");
    error = new DriverError("QUOTA_UNBOUND", "private-account-token in binding error");
    await value.refreshCatalog();
    expect(entry(value).driverCatalog?.quota).toMatchObject({ state: "unbound", resources: [] });
    expect(JSON.stringify(entry(value))).not.toContain("private-account-token");
  });
});

describe("catalog authorization and refresh races", () => {
  it.each(["replace", "revoke", "resolver-error"])("discards a pending quota when the binding changes: %s", async (change) => {
    let current: AgenticDriverCatalogBinding | undefined = structuredClone(binding);
    let resolverError = false;
    const pending = deferred<UsageStatAccountQuota>();
    const read = vi.fn(() => pending.promise);
    const value = catalog(configuration({
      bindingFor: () => { if (resolverError) throw new Error("private-binding-token"); return current; }, accountLimits: read,
    }));
    const refresh = value.refreshCatalog();
    if (change === "replace") current!.identity.accountId = "replacement-account";
    if (change === "revoke") current = undefined;
    if (change === "resolver-error") resolverError = true;
    pending.resolve(receipt());
    await refresh;
    expect(read).toHaveBeenCalledWith(identity);
    expect(entry(value).driverCatalog?.quota.resources).toEqual([]);
    expect(entry(value).driverCatalog?.quota.state).toBe(change === "replace" ? "unavailable" : "unbound");
    expect(entry(value).driverCatalog?.provider.account?.id).toBe(change === "replace" ? "replacement-account" : undefined);
    expect(JSON.stringify(entry(value))).not.toContain("private-binding-token");
  });

  it("rechecks binding values on every discovery and drops revoked cached observations", async () => {
    let current: AgenticDriverCatalogBinding | undefined = structuredClone(binding);
    const value = catalog(configuration({ bindingFor: () => current && structuredClone(current) }));
    await value.refreshCatalog();
    expect(entry(value).driverCatalog?.quota.state).toBe("fresh");
    current = undefined;
    expect(entry(value).driverCatalog?.quota.state).toBe("unbound");
    current = structuredClone(binding);
    expect(entry(value).driverCatalog?.quota.state).toBe("unavailable");
  });

  it("does not let an older refresh overwrite a newer observation", async () => {
    const first = deferred<UsageStatAccountQuota>(), second = deferred<UsageStatAccountQuota>();
    let count = 0;
    const value = catalog(configuration({ accountLimits: () => ++count === 1 ? first.promise : second.promise }));
    const older = value.refreshCatalog(), newer = value.refreshCatalog();
    second.resolve(receipt(identity, 40));
    await newer;
    expect(entry(value).driverCatalog?.quota.resources[0]?.used).toBe(40);
    first.resolve(receipt(identity, 10));
    await older;
    expect(entry(value).driverCatalog?.quota.resources[0]?.used).toBe(40);
  });

  it("invalidates a pending refresh on configuration or semantic settings changes", async () => {
    const pending = deferred<UsageStatAccountQuota>();
    const value = catalog(configuration({ accountLimits: () => pending.promise }));
    const refresh = value.refreshCatalog();
    value.setCatalogConfiguration();
    pending.resolve(receipt());
    await refresh;
    expect(entry(value).driverCatalog?.quota.state).toBe("unbound");
    value.setCatalogConfiguration(configuration());
    await value.refreshCatalog();
    value.setSettings({});
    expect(entry(value).driverCatalog?.quota.state).toBe("fresh");
    const next = deferred<UsageStatAccountQuota>();
    value.setCatalogConfiguration(configuration({ accountLimits: () => next.promise }));
    const nextRefresh = value.refreshCatalog();
    value.setSettings({ "driver.codex-work": AgentProviderSettingsSchema.parse({ providerId: "driver.codex-work", enabled: false, updatedAt: new Date(now).toISOString() }) });
    next.resolve(receipt());
    await nextRefresh;
    expect(entry(value).driverCatalog?.quota.state).toBe("unavailable");
  });

  it("revokes the prior configuration when a replacement lacks a valid freshness policy", async () => {
    const value = catalog();
    await value.refreshCatalog();
    expect(entry(value).driverCatalog?.quota.state).toBe("fresh");
    expect(() => value.setCatalogConfiguration(configuration({ maxAgeMs: 0 }))).toThrow("trusted scope");
    expect(entry(value).driverCatalog?.quota.state).toBe("unbound");
  });
});
