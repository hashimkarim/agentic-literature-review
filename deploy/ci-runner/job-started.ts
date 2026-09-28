#!/usr/local/bin/bun
import { readFileSync } from "node:fs";

// Policy is baked into the image and root-owned, never supplied by workflow env.
const policy = JSON.parse(readFileSync(new URL("policy.json", import.meta.url), "utf8"));
if (!policy.repository || !Array.isArray(policy.refs) || policy.refs.length === 0 ||
    process.env.GITHUB_REPOSITORY !== policy.repository || !policy.refs.includes(process.env.GITHUB_REF) ||
    !["push", "workflow_dispatch"].includes(process.env.GITHUB_EVENT_NAME ?? "")) {
  console.error("This runner accepts only its reviewed repository/branch and push/manual events.");
  process.exit(1);
}
console.log("LitAgent trusted-source gate passed.");
