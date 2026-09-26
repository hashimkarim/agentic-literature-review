import { expect, it } from "vitest";
import { providerSelectionPreference } from "./provider-preferences";

it("retains the exact host-scoped provider/model pair without choosing a replacement", () => {
  const selection = { providerId: "driver.01234567-0123-0123-0123-012345678901:shared", model: "fast" };
  expect(providerSelectionPreference(JSON.parse(JSON.stringify(selection)))).toEqual(selection);
  expect(providerSelectionPreference({ providerId: "driver.removed", model: null })).toEqual({ providerId: "driver.removed", model: null });
  for (const invalid of [null, {}, { providerId: "", model: "demo" }, { providerId: "driver.x", model: 2 }])
    expect(() => providerSelectionPreference(invalid)).toThrow();
});
