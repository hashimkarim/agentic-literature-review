import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { WritingTargetSchema } from "@litagent/contracts";

it.each(["codex", "driver.", "driver.device:codex", `driver.${randomUUID()}:`, `driver.${randomUUID()}:a:b`, "driver.bad provider", "driver.bad/provider", `driver.${"a".repeat(180)}`])("rejects invalid writing provider IDs without changing their identity (%s)", (providerId) => {
  expect(WritingTargetSchema.safeParse({ providerId, model: "gpt-6-luna", count: 1 }).success).toBe(false);
});
