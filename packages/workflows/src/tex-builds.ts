import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ManuscriptError, ManuscriptStore } from "@litagent/library";
import { TexBuildRequestSchema, TexBuildStateSchema, type ManuscriptDocument, type TexBuild, type TexBuildState, type TexDiagnostic } from "@litagent/contracts";
import { type TexCompiler, type TexCompileDocument } from "./tex-runtime";
import { defaultTexCompiler } from "./texlive-runtime";

type StoredState = Omit<TexBuildState, "runtime">;
export function texDiagnostics(log: string, paths: string[]): TexDiagnostic[] {
  const diagnostics: TexDiagnostic[] = [];
  // Earlier passes normally have unresolved citations. Only report diagnostics
  // from the final attempted pass and its subsequent bibliography/PDF steps.
  const finalPass = log.lastIndexOf("[XeLaTeX pass ");
  if (finalPass >= 0) log = log.slice(finalPass);
  for (const raw of log.split(/\r?\n/)) {
    const native = /^(?:\.\/|\/work\/)?([^:]+):(\d+):\s*(.*)$/.exec(raw);
    const normalized = native && paths.includes(native[1]!) ? `error: ${native[1]}:${native[2]}: ${native[3]}` : raw
      .replace(/^(?:LaTeX|Package [\w-]+) Warning:\s*/, "warning: ")
      .replace(/^WARN -\s*/, "warning: ").replace(/^ERROR -\s*/, "error: ");
    const match = /^(error|warning):\s*(.*)$/.exec(normalized);
    if (!match) continue;
    const location = /^(?:\/work\/|\.\/)?([^:]+):(\d+):\s*(.*)$/.exec(match[2]!);
    const file = location && paths.includes(location[1]!) ? location[1]! : null;
    const line = Number(location?.[2]);
    diagnostics.push({ severity: match[1] as "error" | "warning", message: (location?.[3] ?? match[2]!).slice(0, 2000), path: file, line: file && Number.isSafeInteger(line) && line > 0 ? line : null });
    if (diagnostics.length === 100) break;
  }
  return diagnostics;
}
const revisionsOf = (document: ManuscriptDocument) => Object.fromEntries([...document.files, ...(document.assets ?? [])].map((file) => [file.path, file.revision]));
const sameRevisions = (a: Record<string, string>, b: Record<string, string>) => Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([name, revision]) => b[name] === revision);

export class TexBuildService {
  private active: { manuscriptId: string; id: string; controller: AbortController; finished: Promise<void> } | null = null;
  constructor(readonly store: ManuscriptStore, readonly compiler: TexCompiler = defaultTexCompiler()) {}

  private file(manuscriptId: string, name: string): string {
    // Manuscript identity is validated by every public method before cache access.
    let current = this.store.root;
    for (const component of [".litagent", "tex-builds", manuscriptId]) {
      current = path.join(current, component);
      if (!fs.existsSync(current)) fs.mkdirSync(current);
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new ManuscriptError(400, "unsafe_build_cache", "Build cache cannot contain symbolic links.");
    }
    const file = path.join(current, name);
    if (fs.existsSync(file) && !fs.lstatSync(file).isFile()) throw new ManuscriptError(400, "unsafe_build_cache", "Invalid build cache file.");
    return file;
  }

  private readState(manuscriptId: string): StoredState {
    const file = this.file(manuscriptId, "state.json");
    if (!fs.existsSync(file)) return { latest: null, lastSuccessful: null };
    const state = TexBuildStateSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
    if ([state.latest, state.lastSuccessful].some((build) => build && build.manuscriptId !== manuscriptId)) throw new ManuscriptError(409, "build_identity_changed", "Build identity does not match its document.");
    if (state.latest?.status === "running" && this.active?.id !== state.latest.id) {
      state.latest.status = "interrupted";
      state.latest.finishedAt = new Date().toISOString();
      state.latest.diagnostics = state.latest.diagnostics.slice(0, 99);
      state.latest.diagnostics.push({ severity: "error", message: "The server restarted during compilation. Compile again to retry.", path: null, line: null });
      this.writeState(manuscriptId, state);
    }
    return state;
  }

  private atomicFile(manuscriptId: string, name: string, bytes: string | Buffer) {
    const destination = this.file(manuscriptId, name);
    const temporary = this.file(manuscriptId, `${randomUUID()}.tmp`);
    try {
      const fd = fs.openSync(temporary, "wx", 0o600);
      try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temporary, destination);
    } finally { fs.rmSync(temporary, { force: true }); }
  }
  private writeState(id: string, state: StoredState) { this.atomicFile(id, "state.json", JSON.stringify(TexBuildStateSchema.parse(state))); }

  get(manuscriptId: string): TexBuildState {
    this.store.describe(manuscriptId);
    return { ...this.readState(manuscriptId), runtime: this.compiler.status() };
  }

  start(manuscriptId: string, input: unknown): TexBuildState {
    const request = TexBuildRequestSchema.parse(input);
    const document = this.store.read(manuscriptId);
    const state = this.readState(manuscriptId);
    if (state.latest?.id === request.requestId) {
      if (!sameRevisions(request.revisions, state.latest.revisions) || (request.entryFile && request.entryFile !== state.latest.entryFile)) throw new ManuscriptError(409, "build_request_changed", "A build request ID cannot be reused for changed sources.");
      return { ...state, runtime: this.compiler.status() };
    }
    if (!sameRevisions(request.revisions, revisionsOf(document)) || (request.entryFile && request.entryFile !== document.entryFile)) throw new ManuscriptError(409, "build_source_changed", "Saved sources changed. Reload or resolve your draft before compiling.");
    if (this.active) throw new ManuscriptError(409, "build_busy", "Another document is compiling. Wait for it to finish or cancel it first.");
    const runtime = this.compiler.status();
    if (!runtime.available) throw new ManuscriptError(503, "tex_unavailable", runtime.message);
    const build: TexBuild = { id: request.requestId, manuscriptId, entryFile: document.entryFile, revisions: request.revisions, status: "running", startedAt: new Date().toISOString(), finishedAt: null, diagnostics: [], log: "" };
    const snapshot = { ...document, assetContents: (document.assets ?? []).map((file) => ({ path: file.path, bytes: this.store.asset(manuscriptId, file.path, file.revision) })) };
    const controller = new AbortController();
    this.writeState(manuscriptId, { ...state, latest: build });
    const active = { manuscriptId, id: build.id, controller, finished: Promise.resolve() };
    this.active = active;
    active.finished = this.execute(snapshot, build, state.lastSuccessful, controller.signal).finally(() => { if (this.active === active) this.active = null; });
    // A failed cache write must not terminate the server; the persisted running
    // record is reconciled to interrupted on the next read and can be retried.
    void active.finished.catch(() => console.error("Could not persist TeX build state; the next read will reconcile the interrupted build."));
    return { latest: structuredClone(build), lastSuccessful: state.lastSuccessful, runtime };
  }

  cancel(manuscriptId: string, buildId: string): TexBuildState {
    const state = this.get(manuscriptId);
    if (state.latest?.id !== buildId) throw new ManuscriptError(404, "build_not_found", "Build not found.");
    if (this.active?.manuscriptId === manuscriptId && this.active.id === buildId) this.active.controller.abort();
    return state;
  }
  async idle() { await this.active?.finished; }

  pdf(manuscriptId: string, buildId: string): Buffer {
    const state = this.get(manuscriptId);
    if (!state.lastSuccessful || state.lastSuccessful.id !== buildId) throw new ManuscriptError(404, "build_pdf_not_found", "No PDF for this build.");
    const file = this.file(manuscriptId, `${state.lastSuccessful.id}.pdf`);
    if (!fs.existsSync(file)) throw new ManuscriptError(404, "build_pdf_not_found", "The cached PDF was removed. Compile again.");
    return fs.readFileSync(file);
  }

  private async execute(document: TexCompileDocument, build: TexBuild, previous: TexBuild | null, signal: AbortSignal) {
    let successful = previous;
    try {
      const result = await this.compiler.compile(document, signal, (phase) => {
        build.phase = phase.slice(0, 120);
        this.writeState(document.id, { latest: build, lastSuccessful: previous });
      });
      signal.throwIfAborted();
      build.log = result.log.slice(-64_000);
      build.diagnostics = texDiagnostics(build.log, document.files.map((file) => file.path));
      if (result.pdf) {
        if (result.pdf.length > 16 * 1024 * 1024 || result.pdf.subarray(0, 5).toString() !== "%PDF-") throw new Error("Invalid compiler PDF output.");
        this.atomicFile(document.id, `${build.id}.pdf`, result.pdf);
        build.status = "succeeded";
        successful = build;
      } else {
        build.status = "failed";
        if (!build.diagnostics.some((item) => item.severity === "error")) build.diagnostics = [...build.diagnostics.slice(0, 99), { severity: "error", message: "Compilation failed. See the build log for details.", path: null, line: null }];
      }
    } catch (error) {
      build.status = signal.aborted ? "cancelled" : "failed";
      build.diagnostics = [{ severity: "error", message: signal.aborted ? "Compilation cancelled." : (error instanceof Error ? error.message : "Compilation failed.").slice(0, 2000), path: null, line: null }];
    }
    build.finishedAt = new Date().toISOString();
    this.writeState(document.id, { latest: build, lastSuccessful: successful });
    if (successful?.id === build.id && previous) fs.rmSync(this.file(document.id, `${previous.id}.pdf`), { force: true });
  }
}
