#!/usr/bin/env bun
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeDir = path.resolve(process.env.LITAGENT_MARKER_RUNTIME_DIR ?? path.join(root, "resources", "converters", "marker"));
const sourceRuntime = process.env.LITAGENT_MARKER_RUNTIME_SOURCE
  ? path.resolve(process.env.LITAGENT_MARKER_RUNTIME_SOURCE)
  : null;
const force = process.env.LITAGENT_MARKER_RUNTIME_FORCE === "1";

function markerExecutable(runtime: string): string {
  return process.platform === "win32"
    ? path.join(runtime, "Scripts", "marker_single.exe")
    : path.join(runtime, "bin", "marker_single");
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: process.env
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with exit ${result.status}`);
}

if (force && fs.existsSync(runtimeDir)) fs.rmSync(runtimeDir, { recursive: true, force: true });

if (sourceRuntime) {
  if (!fs.existsSync(sourceRuntime)) throw new Error(`Runtime source does not exist: ${sourceRuntime}`);
  fs.mkdirSync(path.dirname(runtimeDir), { recursive: true });
  if (fs.existsSync(runtimeDir)) fs.rmSync(runtimeDir, { recursive: true, force: true });
  fs.cpSync(sourceRuntime, runtimeDir, { recursive: true });
  console.log(`Copied Marker runtime to ${path.relative(root, runtimeDir)}`);
  process.exit(0);
}

const marker = markerExecutable(runtimeDir);
if (fs.existsSync(marker)) {
  console.log(`Marker runtime already exists at ${path.relative(root, runtimeDir)}`);
  process.exit(0);
}

const uv = process.env.UV_BIN ?? "uv";
fs.mkdirSync(path.dirname(runtimeDir), { recursive: true });
run(uv, ["venv", runtimeDir]);
const python = process.platform === "win32"
  ? path.join(runtimeDir, "Scripts", "python.exe")
  : path.join(runtimeDir, "bin", "python");
run(uv, ["pip", "install", "--python", python, "marker-pdf"]);

if (!fs.existsSync(marker)) {
  throw new Error(`Marker installed but marker_single was not found at ${marker}`);
}

console.log(`Prepared Marker runtime at ${path.relative(root, runtimeDir)}`);
