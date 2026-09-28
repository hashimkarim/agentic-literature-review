import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const hook = fileURLToPath(new URL("job-started.ts", import.meta.url));
const repository = "hashimkarim/agentic-literature-review";

function check(ref: string, event: string, repo = repository) {
  return spawnSync("bun", [hook], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, GITHUB_REPOSITORY: repo, GITHUB_REF: ref, GITHUB_EVENT_NAME: event }
  });
}

describe("Prometheus trusted-source policy", () => {
  it.each([
    ["refs/heads/main", "push"],
    ["refs/heads/main", "workflow_dispatch"],
    ["refs/heads/chat-reliability", "push"],
    ["refs/heads/chat-reliability", "workflow_dispatch"]
  ])("accepts the reviewed ref %s for %s", (ref, event) => {
    const result = check(ref, event);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("trusted-source gate passed");
  });

  it.each([
    ["refs/heads/main", "pull_request"],
    ["refs/heads/main", "pull_request_target"],
    ["refs/heads/main", "workflow_run"],
    ["refs/pull/1/merge", "push"],
    ["refs/heads/unreviewed", "workflow_dispatch"],
    ["refs/heads/main-suffix", "push"],
    ["refs/tags/main", "push"],
    ["", "push"],
    ["refs/heads/main", ""]
  ])("rejects %s for %s", (ref, event) => {
    expect(check(ref, event).status).toBe(1);
  });

  it("rejects the same ref in another repository", () => {
    expect(check("refs/heads/main", "push", "someone/agentic-literature-review").status).toBe(1);
  });
});
