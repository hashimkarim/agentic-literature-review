import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ManuscriptNodePathSchema, type TexRuntimeStatus } from "@litagent/contracts";
import { TectonicCompiler, type TexCompiler, type TexCompileDocument } from "./tex-runtime";

const MAX_FILE = 16 * 1024 * 1024;
const Manifest = z.object({
  schema: z.literal(1), platform: z.literal("linux"), arch: z.literal("x64"),
  version: z.string().max(200), biberVersion: z.string().max(100),
  files: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/))
});
type BuildStep = { label: string; command: string; args: string[] };

// Read only the generated glossary declarations, not arbitrary Perl/latexmk
// commands. Extension allowlists keep every command inside the build directory.
export function glossarySteps(aux: string, stem: string): BuildStep[] {
  const steps: BuildStep[] = [];
  const used = new Set<string>();
  for (const match of aux.matchAll(/\\@newglossary\{[^{}\r\n]+\}\{([a-z]{2,8})\}\{([a-z]{2,8})\}\{([a-z]{2,8})\}/g)) {
    const [, log, output, input] = match as unknown as [string, string, string, string];
    if (![log, output, input].every((ext) => /^(?:glg|gls|glo|alg|acr|acn|slg|sls|slo|ilg|ind|idx)$/.test(ext))) throw new Error("Unsupported glossary file extension. Use standard makeindex glossary types.");
    if (used.has(input)) continue;
    used.add(input);
    steps.push({ label: `Glossary (${input})`, command: "/usr/bin/makeindex", args: ["-s", `/output/${stem}.ist`, "-t", `/output/${stem}.${log}`, "-o", `/output/${stem}.${output}`, `/output/${stem}.${input}`] });
  }
  if (steps.length > 8) throw new Error("Too many glossary steps.");
  return steps;
}

export class TexLiveCompiler implements TexCompiler {
  private verifiedManifest: string | null = null;
  constructor(
    readonly runtime = path.resolve(process.env.LITAGENT_TEXLIVE_RUNTIME_DIR ?? fileURLToPath(new URL("../../../resources/texlive", import.meta.url))),
    readonly bwrap = process.env.LITAGENT_BWRAP_BIN ?? "/usr/bin/bwrap",
    readonly prlimit = process.env.LITAGENT_PRLIMIT_BIN ?? "/usr/bin/prlimit",
    readonly timeoutMs = 300_000
  ) {}

  status(): TexRuntimeStatus {
    if (process.platform !== "linux" || process.arch !== "x64") return { available: false, version: null, message: "The prepared TeX Live runtime currently supports Linux x64 only." };
    if (![this.bwrap, this.prlimit].every((file) => fs.existsSync(file))) return { available: false, version: null, message: "TeX compilation requires Bubblewrap and prlimit. No unrestricted fallback is enabled." };
    if (!["manifest.json", "rootfs/usr/bin/xetex", "rootfs/usr/bin/biber"].every((file) => fs.existsSync(path.join(this.runtime, file)))) return { available: false, version: null, message: "Prepare the offline TeX Live runtime with bun run prepare:texlive-runtime on the build host." };
    return { available: true, engine: "texlive", version: "TeX Live 2026 / Biber 2.22", message: "XeLaTeX, Biber, BibTeX, makeindex glossaries and bundled fonts are available offline." };
  }

  private async verify(signal: AbortSignal) {
    const bytes = await fs.promises.readFile(path.join(this.runtime, "manifest.json"));
    const identity = createHash("sha256").update(bytes).digest("hex");
    // Prepared resources are immutable application assets. Verify the complete
    // installation once per process, and again when its manifest changes.
    if (identity === this.verifiedManifest) { signal.throwIfAborted(); return; }
    const manifest = Manifest.parse(JSON.parse(bytes.toString("utf8")));
    if (manifest.arch !== process.arch || !manifest.files["usr/bin/xetex"] || !manifest.files["usr/bin/biber"]) throw new Error("TeX Live runtime architecture or manifest mismatch.");
    const remaining = new Set(Object.keys(manifest.files));
    const root = path.join(this.runtime, "rootfs");
    if (!(await fs.promises.lstat(root)).isDirectory()) throw new Error("Invalid TeX Live runtime root.");
    const visit = async (directory: string): Promise<void> => {
      for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
        signal.throwIfAborted();
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(absolute);
        else if (entry.isFile()) {
          const relative = path.relative(root, absolute);
          if (!remaining.delete(relative)) throw new Error("Unexpected file in TeX Live runtime.");
          const hash = createHash("sha256").update(await fs.promises.readFile(absolute)).digest("hex");
          if (hash !== manifest.files[relative]) throw new Error("TeX Live runtime integrity check failed. Prepare it again.");
        } else throw new Error("TeX Live runtime cannot contain links or special files.");
      }
    };
    await visit(root);
    if (remaining.size) throw new Error("Incomplete TeX Live runtime.");
    this.verifiedManifest = identity;
  }

  async compile(document: TexCompileDocument, signal: AbortSignal, progress?: (phase: string) => void) {
    const status = this.status();
    if (!status.available) throw new Error(status.message);
    progress?.("Checking offline runtime");
    await this.verify(signal);
    progress?.("Preparing source snapshot");
    const temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), "litagent-texlive-"));
    const work = path.join(temporary, "work"), scratch = path.join(temporary, "scratch"), out = path.join(temporary, "output");
    let log = "", logged = 0;
    const deadline = Date.now() + this.timeoutMs;
    const append = (text: string) => { logged += Buffer.byteLength(text); log = (log + text).slice(-64_000); };
    try {
      await fs.promises.mkdir(out); await fs.promises.mkdir(work); await fs.promises.mkdir(scratch);
      for (const file of [...document.files.map((file) => ({ path: file.path, bytes: Buffer.from(file.content) })), ...(document.assetContents ?? [])]) {
        const relative = ManuscriptNodePathSchema.parse(file.path);
        const destination = path.join(work, relative);
        await fs.promises.mkdir(path.dirname(destination), { recursive: true });
        // TeX creates per-chapter .aux files for \include, but not their folders.
        if (/\.tex$/i.test(relative)) await fs.promises.mkdir(path.dirname(path.join(out, relative)), { recursive: true });
        await fs.promises.writeFile(destination, file.bytes, { flag: "wx", mode: 0o600 });
      }
      const entry = ManuscriptNodePathSchema.parse(document.entryFile);
      const stem = path.parse(entry).name;
      const environment: Record<string, string> = {
        PATH: "/usr/bin", HOME: "/tmp", TMPDIR: "/tmp", LANG: "C.UTF-8", LC_ALL: "C.UTF-8",
        TEXMFCNF: "/etc/texlive:/usr/share/texlive/texmf-dist/web2c",
        TEXINPUTS: "/output//:/work//:", BIBINPUTS: "/work//:", BSTINPUTS: "/work//:",
        FONTCONFIG_FILE: "/etc/fonts/fonts.conf", FONTCONFIG_PATH: "/etc/fonts",
        OSFONTDIR: "/usr/share/fonts//:/work//", TEXMFOUTPUT: "/output",
        shell_escape: "f", openin_any: "p", openout_any: "p", MKTEXFMT: "0", MKTEXPK: "0", MKTEXTFM: "0"
      };
      const run = async (step: BuildStep) => {
        signal.throwIfAborted();
        progress?.(step.label);
        append(`\n[${step.label}]\n`);
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error(`Compilation exceeded the ${this.timeoutMs / 1000}-second time limit.`);
        const args = ["--as=4294967296", "--cpu=240", `--fsize=${MAX_FILE}`, "--nofile=256", "--core=0", "--", this.bwrap,
          "--unshare-all", "--die-with-parent", "--new-session", "--cap-drop", "ALL", "--clearenv",
          "--ro-bind", path.join(this.runtime, "rootfs"), "/", "--bind", work, "/work", "--bind", out, "/output", "--bind", scratch, "/tmp", "--dev", "/dev", "--proc", "/proc",
          ...Object.entries(environment).flatMap(([key, value]) => ["--setenv", key, value]), "--chdir", "/work", "--", step.command, ...step.args];
        return new Promise<boolean>((resolve, reject) => {
          const child = spawn(this.prlimit, args, { env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" }, stdio: ["ignore", "pipe", "pipe"], detached: true });
          let closed = false, checking = false;
          let failure: Error | undefined;
          const stop = () => { if (!closed && child.pid) try { process.kill(-child.pid, "SIGKILL"); } catch { /* Exited. */ } };
          const timer = setTimeout(() => { failure = new Error(`Compilation exceeded the ${this.timeoutMs / 1000}-second time limit.`); stop(); }, remaining);
          const limit = setInterval(() => {
            if (checking || closed) return;
            checking = true;
            void (async () => {
              let count = 0, bytes = 0;
              async function inspect(directory: string): Promise<void> {
                for (const item of await fs.promises.readdir(directory, { withFileTypes: true })) {
                  if (++count > 2048) throw new Error("Compilation created too many files.");
                  const file = path.join(directory, item.name);
                  if (item.isDirectory()) await inspect(file);
                  else if (item.isFile()) {
                    try { bytes += (await fs.promises.stat(file)).size; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
                  } else throw new Error("Unexpected special file in compiler output.");
                  if (bytes > 256 * 1024 * 1024) throw new Error("Compilation exceeded the output size limit.");
                }
              }
              await inspect(work); await inspect(out); await inspect(scratch);
            })().catch((error: Error) => { failure = error; stop(); }).finally(() => { checking = false; });
          }, 250);
          const collect = (data: Buffer) => { append(data.toString("utf8")); if (logged > 2_000_000) { failure = new Error("Compilation exceeded the log limit."); stop(); } };
          child.stdout.on("data", collect); child.stderr.on("data", collect);
          signal.addEventListener("abort", stop, { once: true });
          if (signal.aborted) stop();
          child.on("error", (error) => { failure = error; });
          child.on("close", (code) => { closed = true; clearTimeout(timer); clearInterval(limit); signal.removeEventListener("abort", stop); if (failure) reject(failure); else if (signal.aborted) reject(signal.reason ?? new Error("Compilation cancelled.")); else resolve(code === 0); });
        });
      };
      const tex = (pass: number): BuildStep => ({ label: `XeLaTeX pass ${pass}`, command: "/usr/bin/xetex", args: ["-fmt=xelatex", "-progname=xelatex", "-no-shell-escape", "-no-pdf", "-interaction=nonstopmode", "-halt-on-error", "-file-line-error", "-recorder", "-synctex=1", "-output-directory=/output", `-jobname=${stem}`, `./${entry}`] });
      const fingerprint = async () => {
        const hash = createHash("sha256");
        let citations = false;
        async function visit(directory: string): Promise<void> {
          for (const entry of (await fs.promises.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) await visit(file);
            else if (entry.isFile() && /\.(aux|toc|out|lof|lot)$/.test(file)) {
              const bytes = await fs.promises.readFile(file);
              hash.update(path.relative(out, file)).update(bytes);
              if (file.endsWith(".aux") && /\\citation\{[^}]+\}/.test(bytes.toString("utf8"))) citations = true;
            }
          }
        }
        await visit(out);
        return { hash: hash.digest("hex"), citations };
      };
      const processed = new Map<string, string>();
      let previous = "", converged = false;
      for (let pass = 1; pass <= 5; pass++) {
        if (!await run(tex(pass))) return { log, pdf: null };
        const { hash: next, citations } = await fingerprint();
        const aux = await fs.promises.readFile(path.join(out, `${stem}.aux`), "utf8");
        const steps = glossarySteps(aux, stem).map((step) => ({ step, input: path.basename(step.args.at(-1)!) }));
        if (fs.existsSync(path.join(out, `${stem}.bcf`))) steps.unshift({ input: `${stem}.bcf`, step: { label: "Biber bibliography", command: "/usr/bin/biber", args: ["--noconf", "--output-directory", "/output", `/output/${stem}.bcf`] } });
        else if (/\\bibdata\{/.test(aux) && citations) steps.unshift({ input: `${stem}.aux`, step: { label: "BibTeX bibliography", command: "/usr/bin/bibtex", args: [`/output/${stem}`] } });
        let auxiliariesChanged = false;
        for (const { step, input } of steps) {
          if (!fs.existsSync(path.join(out, input))) continue;
          const bytes = await fs.promises.readFile(path.join(out, input));
          if (!bytes.length) continue;
          const identity = createHash("sha256").update(bytes);
          if (step.command.endsWith("/bibtex")) identity.update(next);
          if (step.command.endsWith("makeindex")) identity.update(await fs.promises.readFile(path.join(out, `${stem}.ist`)));
          const digest = identity.digest("hex");
          if (processed.get(input) === digest) continue;
          if (!await run(step)) return { log, pdf: null };
          processed.set(input, digest); auxiliariesChanged = true;
        }
        if (next === previous && !auxiliariesChanged) { converged = true; break; }
        previous = next;
      }
      if (!converged) append("\nwarning: Cross-references did not stabilize after five passes. Check the build log.\n");
      if (!await run({ label: "PDF generation", command: "/usr/bin/xdvipdfmx", args: ["-q", "-o", `/output/${stem}.pdf`, `/output/${stem}.xdv`] })) return { log, pdf: null };
      const output = path.join(out, `${stem}.pdf`);
      const stat = await fs.promises.lstat(output);
      if (!stat.isFile() || stat.size > MAX_FILE) throw new Error("Invalid or oversized compiler PDF output.");
      const pdf = await fs.promises.readFile(output);
      if (pdf.subarray(0, 5).toString() !== "%PDF-") throw new Error("Compiler output is not a PDF.");
      return { log, pdf };
    } catch (error) {
      signal.throwIfAborted();
      append(`\nerror: ${error instanceof Error ? error.message : "Compilation failed."}\n`);
      return { log, pdf: null };
    } finally { await fs.promises.rm(temporary, { recursive: true, force: true }); }
  }
}

export function defaultTexCompiler(): TexCompiler {
  const full = new TexLiveCompiler();
  // Choose once at startup. Never retry a failed document with another engine.
  return process.env.LITAGENT_TEXLIVE_RUNTIME_DIR || fs.existsSync(path.join(full.runtime, "manifest.json")) ? full : new TectonicCompiler();
}
