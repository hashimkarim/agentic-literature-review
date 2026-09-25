import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { ManuscriptDocument, TexRuntimeStatus } from "@litagent/contracts";
import { readSyncTex } from "./tex-source-map";

export type TexCompileDocument = ManuscriptDocument & { assetContents?: { path: string; bytes: Buffer }[] };
export interface TexCompiler {
  status(): TexRuntimeStatus;
  compile(document: TexCompileDocument, signal: AbortSignal, progress?: (phase: string) => void): Promise<{ log: string; pdf: Buffer | null; synctex?: Buffer | undefined }>;
}
const MAX_OUTPUT = 16 * 1024 * 1024;
const ManifestSchema = z.object({
  version: z.literal("0.17.0"), platform: z.literal("linux"), arch: z.enum(["x64", "arm64"]),
  files: z.record(z.string().regex(/^(tectonic|cache\/[A-Za-z0-9_.,/-]+)$/), z.string().regex(/^[a-f0-9]{64}$/))
});
export class TectonicCompiler implements TexCompiler {
  constructor(
    readonly runtime = path.resolve(process.env.LITAGENT_TEX_RUNTIME_DIR ?? fileURLToPath(new URL("../../../resources/tex", import.meta.url))),
    readonly bwrap = process.env.LITAGENT_BWRAP_BIN ?? "/usr/bin/bwrap",
    readonly prlimit = process.env.LITAGENT_PRLIMIT_BIN ?? "/usr/bin/prlimit",
    readonly timeoutMs = 90_000
  ) {}

  status(): TexRuntimeStatus {
    if (process.platform !== "linux") return { available: false, version: null, message: "Restricted TeX compilation is currently supported on Linux only." };
    if (![this.bwrap, this.prlimit].every((file) => fs.existsSync(file))) return { available: false, version: null, message: "The restricted TeX runtime requires Bubblewrap and prlimit. No unrestricted fallback is enabled." };
    if (!["tectonic", "manifest.json", "cache"].every((file) => fs.existsSync(path.join(this.runtime, file)))) return { available: false, version: null, message: "The offline TeX runtime is not prepared. Run bun run prepare:tex-runtime on the build host." };
    return { available: true, version: "0.17.0", message: "Offline Tectonic with filesystem/network isolation." };
  }

  private async verifyRuntime() {
    const manifest = ManifestSchema.parse(JSON.parse(await fs.promises.readFile(path.join(this.runtime, "manifest.json"), "utf8")));
    if (manifest.arch !== process.arch || !manifest.files.tectonic) throw new Error("TeX runtime architecture or manifest mismatch.");
    for (const [relative, expected] of Object.entries(manifest.files)) {
      let file = this.runtime;
      for (const part of relative.split("/")) {
        if (!part || part === "." || part === "..") throw new Error("Unsafe TeX runtime manifest.");
        file = path.join(file, part);
        if ((await fs.promises.lstat(file)).isSymbolicLink()) throw new Error("TeX runtime cannot contain symbolic links.");
      }
      const actual = createHash("sha256").update(await fs.promises.readFile(file)).digest("hex");
      if (actual !== expected) throw new Error("TeX runtime integrity check failed. Prepare it again.");
    }
  }

  async compile(document: TexCompileDocument, signal: AbortSignal) {
    const status = this.status();
    if (!status.available) throw new Error(status.message);
    await this.verifyRuntime();
    signal.throwIfAborted();
    const temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), "litagent-tex-build-"));
    try {
      const work = path.join(temporary, "work");
      await fs.promises.mkdir(path.join(work, "out"), { recursive: true });
      const scratch = path.join(temporary, "scratch");
      await fs.promises.mkdir(scratch);
      for (const file of document.files) {
        const destination = path.join(work, file.path);
        await fs.promises.mkdir(path.dirname(destination), { recursive: true });
        await fs.promises.writeFile(destination, file.content, { flag: "wx", mode: 0o600 });
      }
      for (const asset of document.assetContents ?? []) {
        const destination = path.join(work, asset.path);
        await fs.promises.mkdir(path.dirname(destination), { recursive: true });
        await fs.promises.writeFile(destination, asset.bytes, { flag: "wx", mode: 0o600 });
      }
      // Only the source snapshot is writable. No home, repository, host binaries,
      // sockets or network interfaces are visible inside this namespace.
      const args = ["--as=1073741824", "--cpu=60", `--fsize=${MAX_OUTPUT}`, "--nofile=128", "--core=0", "--", this.bwrap,
        "--unshare-all", "--die-with-parent", "--new-session", "--cap-drop", "ALL", "--clearenv",
        "--ro-bind", path.join(this.runtime, "tectonic"), "/tectonic",
        "--ro-bind", path.join(this.runtime, "cache"), "/cache",
        "--bind", work, "/work", "--bind", scratch, "/tmp", "--dev", "/dev", "--proc", "/proc", "--remount-ro", "/",
        "--setenv", "HOME", "/tmp", "--setenv", "TECTONIC_CACHE_DIR", "/cache", "--setenv", "TECTONIC_UNTRUSTED_MODE", "1",
        "--chdir", "/work", "--", "/tectonic", "-X", "compile", "--untrusted", "--only-cached", "--keep-logs", "--synctex", "--outdir", "/work/out", document.entryFile];
      const result = await new Promise<{ code: number | null; log: string }>((resolve, reject) => {
        const child = spawn(this.prlimit, args, { cwd: temporary, env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" }, stdio: ["ignore", "pipe", "pipe"], detached: true });
        let log = "";
        let total = 0;
        let failure: string | null = null;
        let closed = false;
        const stop = () => { if (!closed && child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* Already exited. */ } } };
        const timer = setTimeout(() => { failure = `Compilation exceeded the ${this.timeoutMs / 1000}-second time limit.`; stop(); }, this.timeoutMs);
        let checkingSize = false;
        const outputLimit = setInterval(() => {
          if (checkingSize) return;
          checkingSize = true;
          void (async () => {
            let bytes = 0, count = 0;
            async function inspect(directory: string): Promise<void> {
              for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
                if (++count > 1024) throw new Error("Compilation created too many files.");
                const file = path.join(directory, entry.name);
                if (entry.isDirectory()) await inspect(file);
                else if (entry.isFile()) {
                  try { bytes += (await fs.promises.stat(file)).size; }
                  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
                }
                if (bytes > 96 * 1024 * 1024) throw new Error("Compilation exceeded the output size limit.");
              }
            }
            await inspect(work); await inspect(scratch);
          })().catch((error) => { failure = error instanceof Error ? error.message : "Could not inspect compiler output."; stop(); }).finally(() => { checkingSize = false; });
        }, 200);
        const collect = (data: Buffer) => {
          total += data.length; log = (log + data.toString("utf8")).slice(-64_000);
          if (total > 1_000_000) { failure = "Compilation exceeded the log limit."; stop(); }
        };
        child.stdout.on("data", collect); child.stderr.on("data", collect);
        signal.addEventListener("abort", stop, { once: true });
        if (signal.aborted) stop();
        child.on("error", reject);
        child.on("close", (code) => { closed = true; clearTimeout(timer); clearInterval(outputLimit); signal.removeEventListener("abort", stop); if (failure) reject(new Error(failure)); else resolve({ code, log }); });
      });
      signal.throwIfAborted();
      const output = path.join(work, "out", `${path.parse(document.entryFile).name}.pdf`);
      if (result.code !== 0 || !fs.existsSync(output)) return { log: result.log, pdf: null };
      const stat = await fs.promises.lstat(output);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_OUTPUT) throw new Error("Invalid or oversized compiler output.");
      const pdf = await fs.promises.readFile(output);
      if (!pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("Compiler output is not a PDF.");
      return { log: result.log, pdf, synctex: await readSyncTex(output.replace(/\.pdf$/, ".synctex.gz")) };
    } finally { await fs.promises.rm(temporary, { recursive: true, force: true }); }
  }
}
