import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Metadata-only repack: TypeScript and Bun otherwise merge distinct 0.1.0 SDKs.
const root = path.resolve(import.meta.dirname, "..");
const original = path.join(root, "vendor/agenticdriver-panel-3217b8d.tgz");
const sha = createHash("sha256").update(fs.readFileSync(original)).digest("hex");
if (sha !== "65b68ebdca8d497e4e175473b55344d2640c136626b3614ffb4540284e9adb3a") throw new Error("Candidate checksum mismatch");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "litagent-panel-package-"));
try {
  execFileSync("tar", ["-xzf", original, "-C", temporary]);
  const manifest = path.join(temporary, "package/package.json");
  const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
  pkg.name = "@litagent/driver-panel-sdk";
  pkg.version = "0.1.0-litagent-panel.3217b8d";
  // Do not install a competing agenticdriver executable into the app's .bin.
  delete pkg.bin;
  fs.writeFileSync(manifest, JSON.stringify(pkg, null, 2) + "\n");
  execFileSync("tar", ["--sort=name", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner", "-czf",
    path.join(root, "vendor/litagent-driver-panel-3217b8d.tgz"), "-C", temporary, "package"]);
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
