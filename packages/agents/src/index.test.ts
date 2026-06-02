import { describe, expect, it } from "vitest";

import { AgentProviderCatalog } from "./index";

describe("AgentProviderCatalog", () => {
  it("discovers known provider definitions", () => {
    const providers = new AgentProviderCatalog().discover();
    expect(providers.map((provider) => provider.id)).toContain("codex");
    expect(providers.map((provider) => provider.id)).toContain("claude");
    expect(providers.every((provider) => typeof provider.installed === "boolean")).toBe(true);
  });
});
