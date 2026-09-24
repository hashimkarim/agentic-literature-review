#!/usr/bin/env bun
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Maintainer-only packaging: capture the system-managed TeX distribution and
// native dependency closure. Document builds never use the host installation.
const destination = path.resolve(process.env.LITAGENT_TEXLIVE_RUNTIME_DIR ?? fileURLToPath(new URL("../resources/texlive", import.meta.url)));
if (process.platform !== "linux" || process.arch !== "x64") throw new Error("This packaging recipe is qualified for Linux x64 only.");
if (fs.existsSync(destination)) throw new Error(`Runtime already exists: ${destination}. Move it aside before preparing a replacement.`);
const env = { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", HOME: "/nonexistent" };
function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { env, encoding: "utf8", timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw result.error ?? new Error(`${command}: ${result.stderr}`);
  return result.stdout;
}
const version = run("/usr/bin/xetex", ["--version"]).split("\n")[0]!;
const biberVersion = run("/usr/bin/biber", ["--version"]).trim();
if (!version.includes("TeX Live 2026") || !biberVersion.endsWith("2.22")) throw new Error("This recipe requires the tested TeX Live 2026 / Biber 2.22 pair.");
fs.mkdirSync(path.dirname(destination), { recursive: true });
const stage = fs.mkdtempSync(path.join(path.dirname(destination), ".texlive-prepare-"));
const root = path.join(stage, "rootfs");
const files: Record<string, string> = {};
const native = new Set<string>();
let bytes = 0;
function write(relative: string, data: Buffer | string, mode = 0o644) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data, { mode });
  files[relative] = createHash("sha256").update(data).digest("hex");
  bytes += Buffer.byteLength(data);
}
function copy(source: string, relative = source.slice(1)) {
  if (files[relative]) return;
  const real = fs.realpathSync(source);
  if (!/^(?:\/usr\/|\/lib64\/|\/etc\/texlive\/|\/var\/lib\/texmf\/)/.test(real) && real !== "/etc/paperspecs") throw new Error(`Non-system dependency rejected: ${source}`);
  const stat = fs.statSync(real);
  if (stat.isDirectory()) {
    for (const item of fs.readdirSync(real)) copy(path.join(real, item), `${relative}/${item}`);
  } else if (stat.isFile()) {
    const data = fs.readFileSync(real);
    write(relative, data, stat.mode & 0o111 ? 0o755 : 0o644);
    if (data.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) native.add(real);
  } else throw new Error(`Non-file runtime dependency: ${source}`);
}
try {
  for (const directory of ["work", "output", "tmp", "dev", "proc"]) fs.mkdirSync(path.join(root, directory), { recursive: true });
  console.log(`Packaging ${version}, ${biberVersion}`);
  for (const binary of ["xetex", "xdvipdfmx", "biber", "bibtex", "makeindex", "kpsewhich", "perl"]) copy(`/usr/bin/${binary}`);
  // Exclude package executors, documentation, local TeX trees and user fonts.
  for (const subtree of ["tex", "fonts", "bibtex", "makeindex", "web2c", "dvipdfmx", "dvips"]) {
    console.log(`Copying TeX support: ${subtree}`);
    copy(`/usr/share/texlive/texmf-dist/${subtree}`);
  }
  for (const file of ["ls-R", "web2c/xetex/xelatex.fmt", "fonts"]) copy(`/var/lib/texmf/${file}`);
  copy("/usr/share/texlive/texmf-dist/ls-R");
  for (const directory of ["/usr/share/perl5", "/usr/lib64/perl5", "/usr/share/fonts/liberation-sans-fonts", "/usr/share/fonts/liberation-mono-fonts"]) copy(directory);
  copy("/usr/bin/fc-cache-64");
  copy("/etc/paperspecs");
  copy("/usr/lib/locale/C.utf8");
  // ldd is only applied to trusted system binaries, never imported files. Its
  // environment excludes LD_PRELOAD and all application/provider credentials.
  for (const binary of native) {
    const output = run("/usr/bin/ldd", [binary]);
    if (output.includes("not found")) throw new Error(`Unresolved native dependencies: ${binary}\n${output}`);
    for (const line of output.split("\n")) {
      const dependency = /(?:=>\s+|^\s*)(\/(?:usr\/)?lib(?:64)?\/[^\s]+)/.exec(line)?.[1];
      if (dependency) copy(dependency);
    }
  }
  write("etc/fonts/fonts.conf", `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd"><fontconfig>
<dir>/usr/share/fonts</dir><dir>/usr/share/texlive/texmf-dist/fonts/opentype</dir><dir>/usr/share/texlive/texmf-dist/fonts/truetype</dir>
<dir>/work</dir><cachedir>/tmp/fontconfig</cachedir></fontconfig>`);
  write("etc/texlive/texmf.cnf", `TEXMFROOT = /usr/share/texlive
TEXMFDIST = $TEXMFROOT/texmf-dist
TEXMF = {!!/var/lib/texmf,!!$TEXMFDIST}
TEXMFDBS = $TEXMF
TEXMFVAR = /tmp/texmf
TEXMFCONFIG = /tmp/texmf-config
TEXMFHOME = /nonexistent
TEXMFCACHE = /tmp/texmf
shell_escape = f
openin_any = p
openout_any = p
parse_first_line = f
MKTEXFMT = 0
MKTEXPK = 0
MKTEXTFM = 0
MKTEXMF = 0
`);
  for (const name of ["LICENSE.CTAN", "LICENSE.TL", "release-texlive.txt", "licenses"]) copy(`/usr/share/texlive/${name}`);
  // Include licensing for TeX, Perl, fonts and the actual native dependencies,
  // not unrelated desktop applications installed on the packaging host.
  const packages = new Set(run("/usr/bin/rpm", ["-qa", "--qf", "%{NAME}\n"]).trim().split("\n").filter((name) => /^(texlive|perl|biber|liberation)/.test(name)));
  for (const name of run("/usr/bin/rpm", ["-qf", "--qf", "%{NAME}\n", ...native]).trim().split("\n")) packages.add(name);
  const licenseFiles = run("/usr/bin/rpm", ["-q", "--qf", "[%{FILENAMES}\n]", ...packages]).split("\n").filter((file) => file.startsWith("/usr/share/licenses/"));
  for (const file of new Set(licenseFiles)) {
    if (fs.existsSync(file)) copy(file);
    else console.warn(`Missing packaged license path: ${file}`);
  }
  const inventory = run("/usr/bin/rpm", ["-q", "--qf", "%{NEVRA}\t%{LICENSE}\n", ...packages]).split("\n").sort().join("\n");
  write("usr/share/litagent/build-host-packages.txt", inventory);
  fs.writeFileSync(path.join(stage, "manifest.json"), JSON.stringify({ schema: 1, platform: "linux", arch: "x64", version, biberVersion, files, bytes }, null, 2));
  fs.renameSync(stage, destination);
  console.log(`Prepared ${Object.keys(files).length} files, ${(bytes / 1024 / 1024).toFixed(0)} MiB at ${destination}`);
} catch (error) { fs.rmSync(stage, { recursive: true, force: true }); throw error; }
