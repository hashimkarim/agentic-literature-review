import { z } from "zod";
import { WriteManuscriptFileRequestSchema, type ManuscriptDocument, type ManuscriptFile, type WriteManuscriptFileRequest } from "@litagent/contracts";

export interface WritingFile {
  path: string;
  content: string;
  savedContent: string;
  revision: string;
  state: "saved" | "dirty" | "saving" | "error" | "conflict" | "recovered";
  error: string | null;
}
const RecoverySchema = WriteManuscriptFileRequestSchema.extend({ savedContent: z.string(), updatedAt: z.number() });
type Recovery = z.infer<typeof RecoverySchema>;
type StoragePort = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;

export class WritingSession {
  private snapshot: { files: Record<string, WritingFile>; storageError: string | null };
  private listeners = new Set<() => void>();
  private pending = new Map<string, Promise<void>>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private prefix: string;
  private recoveryKeys = new Map<string, Map<string, string>>();

  constructor(readonly document: ManuscriptDocument, private write: (input: WriteManuscriptFileRequest) => Promise<ManuscriptFile>, private storage: StoragePort | null, private clientId: string) {
    this.prefix = `litagent:writing:${document.projectId}:${document.id}:`;
    this.snapshot = { files: Object.fromEntries(document.files.map((file) => [file.path, { ...file, savedContent: file.content, state: "saved" as const, error: null }])), storageError: null };
    this.recover();
  }

  getSnapshot = () => this.snapshot;
  subscribe = (callback: () => void) => { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; };
  private emit() { this.snapshot = { ...this.snapshot }; this.listeners.forEach((listener) => listener()); }
  private set(file: WritingFile) { this.snapshot.files = { ...this.snapshot.files, [file.path]: file }; this.emit(); }
  private storageFailure() { this.snapshot.storageError = "Local draft recovery is unavailable. Keep this tab open until changes are saved."; this.emit(); }
  private key(filePath: string) { return `${this.prefix}${this.clientId}:${encodeURIComponent(filePath)}`; }
  private persist(file: WritingFile) {
    if (!this.storage) { this.storageFailure(); return; }
    try {
      if (file.content === file.savedContent && file.state === "saved") {
        this.storage.removeItem(this.key(file.path));
        for (const [key, original] of this.recoveryKeys.get(file.path) ?? []) {
          if (this.storage.getItem(key) === original) this.storage.removeItem(key);
        }
        this.recoveryKeys.delete(file.path);
      } else this.storage.setItem(this.key(file.path), JSON.stringify({ path: file.path, content: file.content, expectedRevision: file.revision, savedContent: file.savedContent, updatedAt: Date.now() } satisfies Recovery));
    } catch { this.storageFailure(); }
  }

  private recover() {
    if (!this.storage) return;
    try {
      const recovered = new Map<string, Recovery>();
      for (let i = 0; i < this.storage.length; i++) {
        const key = this.storage.key(i);
        if (!key?.startsWith(this.prefix)) continue;
        let parsed: ReturnType<typeof RecoverySchema.safeParse>;
        try { parsed = RecoverySchema.safeParse(JSON.parse(this.storage.getItem(key) ?? "null")); } catch { continue; }
        if (!parsed.success) continue;
        const entry = parsed.data;
        const remote = this.snapshot.files[entry.path];
        if (!remote || entry.content === remote.content) continue;
        const keys = this.recoveryKeys.get(entry.path) ?? new Map<string, string>();
        keys.set(key, this.storage.getItem(key)!);
        this.recoveryKeys.set(entry.path, keys);
        if (entry.updatedAt > (recovered.get(entry.path)?.updatedAt ?? 0)) recovered.set(entry.path, entry);
      }
      for (const entry of recovered.values()) {
        const remote = this.snapshot.files[entry.path]!;
        this.snapshot.files[entry.path] = { ...remote, content: entry.content, savedContent: entry.savedContent, revision: entry.expectedRevision ?? remote.revision, state: "recovered", error: null };
      }
    } catch { this.storageFailure(); }
  }

  edit(filePath: string, content: string) {
    const file = this.snapshot.files[filePath];
    if (!file) return;
    const next = { ...file, content, state: file.state === "conflict" ? "conflict" as const : content === file.savedContent && !this.pending.has(filePath) ? "saved" as const : "dirty" as const, error: file.state === "conflict" ? file.error : null };
    this.set(next);
    this.persist(next);
    this.schedule(filePath);
  }
  private schedule(filePath: string) {
    clearTimeout(this.timers.get(filePath));
    if (this.snapshot.files[filePath]?.state === "dirty") this.timers.set(filePath, setTimeout(() => { void this.save(filePath); }, 1200));
  }

  save = (filePath: string): Promise<void> => {
    const pending = this.pending.get(filePath);
    if (pending) return pending;
    const file = this.snapshot.files[filePath];
    if (!file || file.state === "saved" || file.state === "conflict") return Promise.resolve();
    clearTimeout(this.timers.get(filePath));
    this.set({ ...file, state: "saving", error: null });
    const work = Promise.resolve().then(() => this.write({ path: filePath, content: file.content, expectedRevision: file.revision }))
      .then((saved) => {
        const current = this.snapshot.files[filePath]!;
        const next: WritingFile = { ...current, revision: saved.revision, savedContent: saved.content, state: current.content === saved.content ? "saved" : "dirty", error: null };
        this.set(next);
        this.persist(next);
      }).catch((error: unknown) => {
        const current = this.snapshot.files[filePath]!;
        this.set({ ...current, state: (error as { status?: number }).status === 409 ? "conflict" : "error", error: error instanceof Error ? error.message : "File could not be saved." });
      }).finally(() => { this.pending.delete(filePath); this.schedule(filePath); });
    this.pending.set(filePath, work);
    return work;
  };

  async flush(): Promise<boolean> {
    for (const file of Object.values(this.snapshot.files)) await this.save(file.path);
    return Object.values(this.snapshot.files).every((file) => file.state === "saved");
  }
  acceptRemote(remote: ManuscriptFile, keepLocal = false) {
    const current = this.snapshot.files[remote.path];
    const file: WritingFile = { ...remote, savedContent: remote.content, content: keepLocal && current ? current.content : remote.content, state: "saved", error: null };
    if (file.content !== remote.content) file.state = "dirty";
    this.set(file); this.persist(file);
    if (keepLocal) void this.save(file.path);
  }
  remove(filePath: string) {
    clearTimeout(this.timers.get(filePath));
    const file = this.snapshot.files[filePath];
    if (file) this.persist({ ...file, content: file.savedContent, state: "saved" });
    const files = { ...this.snapshot.files }; delete files[filePath];
    this.snapshot.files = files; this.emit();
  }
  dispose() {
    this.timers.forEach(clearTimeout);
    // Preserve recovery records. Pending saves belong to this document, not the next view.
  }
}
