# AgenticDriver Provider Panel Candidate

`agenticdriver-panel-3217b8d.tgz` is the explicitly supplied, unpublished SDK
candidate for the shared provider settings/pairing integration. It is installed
under the `@litagent/driver-panel-sdk` alias, only in the web and server apps.
Execution continues to use the registry `@agenticdriver/sdk@0.1.0` dependency
in `packages/agents`. No provider runtime is started by this integration.

- Source: `agenticdriver/agenticdriver@3217b8d426e96aa5beb6c87dcf0fc76d7628ebbd`
- Archive SHA-256: `65b68ebdca8d497e4e175473b55344d2640c136626b3614ffb4540284e9adb3a`
- License: MIT; the complete upstream LICENSE is included in the archive.
- Upstream archive name: `agenticdriver-sdk-0.1.0.tgz`

The embedded version is still 0.1.0, but this is **not** the npm registry 0.1.0
archive. Do not replace it by that version number or a sibling source checkout.
Remove this transitional alias when an independently verified registry release
includes the panel/management/pairing entrypoints and the app checks pass.

`litagent-driver-panel-3217b8d.tgz` is the metadata-only repack installed by the
apps. `bun scripts/prepare-driver-panel.ts` verifies the original checksum and
changes only package.json: name/version distinguish the candidate from the
registry package, and removing `bin` prevents CLI installation conflicts. Every
runtime, type, documentation and license file is unchanged. This avoids Bun and
TypeScript deduplicating the two different upstream 0.1.0 packages. The local
metadata suffix is not a registry version or a new upstream release.
