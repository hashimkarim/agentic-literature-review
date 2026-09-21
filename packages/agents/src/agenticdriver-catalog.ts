import { isDeepStrictEqual } from "node:util";
import { DriverError, type ProviderInfo } from "agenticdriver";
import {
  providerAssetSchema,
  providerPresentation,
  quotaPresentation,
  type IconVariant,
  type ProviderAsset,
  type UsageStatAccountQuota,
  type UsageStatProvider,
  type UsageStatQuotaIdentity,
} from "agenticdriver/catalog";
import { AgenticDriverCatalogEntrySchema, type AgenticDriverCatalogEntry } from "@litagent/contracts";

export interface AgenticDriverCatalogBinding {
  identity: UsageStatQuotaIdentity;
  accountLabel: string;
}

/** Trusted server configuration, never provider settings or request/assistant metadata. */
export interface AgenticDriverCatalogConfiguration {
  hostId: string;
  subject: string;
  /** Resolve the current authorized binding; return undefined after revocation. */
  bindingFor(providerId: string): AgenticDriverCatalogBinding | undefined;
  /** Supply only the SDK's scoped accountLimits read, never raw limits() or usage(). */
  accountLimits?(identity: UsageStatQuotaIdentity): Promise<UsageStatAccountQuota>;
  metadata?: readonly UsageStatProvider[];
  /** Reviewed same-origin manifest deployed with its matching asset cache. */
  assets?: readonly ProviderAsset[];
  variant?: IconVariant;
  maxAgeMs: number;
  now?: () => number;
}

interface QuotaObservation {
  binding: AgenticDriverCatalogBinding;
  receipt?: UsageStatAccountQuota;
  error?: true | DriverError;
}

const validId = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= 128;

/** Owns display state only. It cannot grant execution or accept a research artifact. */
export class AgenticDriverCatalogPresentation {
  private configuration: AgenticDriverCatalogConfiguration | undefined;
  private refreshVersion = 0;
  private readonly observations = new Map<string, QuotaObservation>();

  constructor(configuration?: AgenticDriverCatalogConfiguration) {
    this.configure(configuration);
  }

  configure(configuration?: AgenticDriverCatalogConfiguration): void {
    this.invalidate();
    this.configuration = undefined;
    if (!configuration) return;
    if (!validId(configuration.hostId) || !validId(configuration.subject) ||
        typeof configuration.bindingFor !== "function" ||
        (configuration.accountLimits !== undefined && typeof configuration.accountLimits !== "function") ||
        !Number.isSafeInteger(configuration.maxAgeMs) || configuration.maxAgeMs <= 0 ||
        (configuration.variant !== undefined && !["monochrome", "color"].includes(configuration.variant))) {
      throw new Error("AgenticDriver catalog requires a trusted scope and an explicit quota freshness policy.");
    }
    // Retain only the public metadata fields the SDK's presentation helper needs.
    // Raw administrative catalogs may carry local paths or other private fields.
    const metadata = (configuration.metadata ?? []).map((entry) => ({
      id: entry.id,
      ...(typeof entry.name === "string" ? { name: entry.name } : {}),
      ...(typeof entry.displayName === "string" ? { displayName: entry.displayName } : {}),
      ...(typeof entry.brandColor === "string" ? { brandColor: entry.brandColor } : {}),
    }));
    const assets = (configuration.assets ?? []).flatMap((entry) => {
      const parsed = providerAssetSchema.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    });
    this.configuration = { ...configuration, metadata, assets };
  }

  /** Invalidate pending reads as well as cached observations when settings change. */
  invalidate(): void {
    this.refreshVersion += 1;
    this.observations.clear();
  }

  private binding(provider: ProviderInfo): AgenticDriverCatalogBinding | undefined {
    const configuration = this.configuration;
    if (!configuration) return undefined;
    try {
      const binding = configuration.bindingFor(provider.id);
      const identity = binding?.identity;
      if (!identity || ![identity.hostId, identity.provider, identity.accountId, identity.subject].every(validId) ||
          identity.hostId !== configuration.hostId || identity.subject !== configuration.subject ||
          identity.provider !== provider.id || !binding.accountLabel?.trim()) return undefined;
      // The resolver can return new objects each time. Compare immutable values,
      // and never let a caller mutate the in-flight lookup's identity.
      return {
        identity: {
          hostId: identity.hostId, provider: identity.provider,
          accountId: identity.accountId, subject: identity.subject,
        },
        accountLabel: binding.accountLabel,
      };
    } catch {
      return undefined;
    }
  }

  async refresh(providers: readonly ProviderInfo[]): Promise<void> {
    this.invalidate();
    const version = this.refreshVersion;
    const configuration = this.configuration;
    if (!configuration?.accountLimits) return;
    await Promise.all(providers.map(async (provider) => {
      const binding = this.binding(provider);
      if (!binding) return;
      let observation: QuotaObservation;
      try {
        const receipt = await configuration.accountLimits!({ ...binding.identity });
        observation = { binding, receipt: structuredClone(receipt) };
      } catch (error) {
        observation = {
          binding,
          // Preserve the SDK's unbound state without retaining private error text.
          error: error instanceof DriverError && error.code === "QUOTA_UNBOUND"
            ? new DriverError("QUOTA_UNBOUND", "Quota account not linked") : true,
        };
      }
      if (this.configuration !== configuration || this.refreshVersion !== version ||
          !isDeepStrictEqual(this.binding(provider), binding)) return;
      this.observations.set(provider.id, observation);
    }));
  }

  describe(provider: ProviderInfo): AgenticDriverCatalogEntry {
    const configuration = this.configuration;
    const binding = this.binding(provider);
    const matches = configuration?.metadata?.filter((entry) => entry.id === provider.usageStatId) ?? [];
    const metadata = matches.length === 1 ? matches[0] : undefined;
    const options = {
      ...(binding ? { account: { id: binding.identity.accountId, label: binding.accountLabel } } : {}),
      ...(metadata ? { metadata } : {}),
      ...(configuration?.variant ? { variant: configuration.variant } : {}),
    };
    let presentation;
    try {
      presentation = providerPresentation(provider, {
        ...options,
        assets: configuration?.assets?.filter((asset) => asset.providerId === metadata?.id) ?? [],
      });
    } catch {
      // Ambiguous/missing assets never expose private paths or break discovery.
      presentation = providerPresentation(provider, options);
    }
    const observation = this.observations.get(provider.id);
    const current = binding && observation && isDeepStrictEqual(observation.binding, binding)
      ? observation : undefined;
    if (!current) this.observations.delete(provider.id);
    const identity = binding?.identity ?? { hostId: "", provider: provider.id, accountId: "", subject: "" };
    let quota;
    try {
      // Recompute age and reset boundaries on every discovery, never cache "fresh".
      quota = quotaPresentation(identity, current?.receipt, {
        maxAgeMs: configuration?.maxAgeMs ?? 300_000,
        now: configuration?.now?.() ?? Date.now(),
        error: current?.error,
      });
    } catch {
      quota = quotaPresentation(identity, undefined, { maxAgeMs: 300_000, error: true });
    }
    return AgenticDriverCatalogEntrySchema.parse({ provider: presentation, quota });
  }
}
