export interface ProviderSelectionPreference { providerId: string; model: string | null }

export function providerSelectionPreference(value: unknown): ProviderSelectionPreference {
  if (!value || typeof value !== "object" || !("providerId" in value) || !("model" in value) ||
    typeof value.providerId !== "string" || value.providerId.length > 1024 || (!value.providerId && value.model !== null) ||
    !(value.model === null || (typeof value.model === "string" && value.model.length > 0 && value.model.length <= 1024))) {
    throw new Error("Invalid provider selection preference");
  }
  return { providerId: value.providerId, model: value.model };
}
