import type { QaResponse, QaThread } from "@litagent/contracts";

export interface ChatScope {
  projectId: string | null;
  paperId: string | null;
}

interface ChatRequest extends ChatScope {
  question: string;
  threadRevision: number;
  providerId: string;
  model: string | null;
}

interface ChatApi {
  qaThread(scope: ChatScope): Promise<QaThread>;
  qa(request: ChatRequest): Promise<QaResponse>;
  clearQaThread(scope: ChatScope & { threadRevision?: number }): Promise<QaThread>;
}

export interface ChatSession {
  thread: QaThread | null;
  selectedAnswerId: string | null;
  draft: string;
  pending: ChatRequest | null;
  error: { operation: "answer" | "archive"; question: string; message: string } | null;
  loadError: string | null;
  loading: boolean;
  clearing: boolean;
}

interface SessionEntry {
  state: ChatSession;
  version: number;
  loading: Promise<void> | null;
}

function scopeKey(scope: ChatScope): string {
  return JSON.stringify([scope.projectId, scope.paperId]);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The request could not be completed.";
}

/** One state record per source scope; navigation never owns an in-flight request. */
export class ChatSessions {
  private entries = new Map<string, SessionEntry>();
  private listeners = new Set<() => void>();

  constructor(private api: ChatApi) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  get(scope: ChatScope): ChatSession {
    return this.entry(scope).state;
  }

  setDraft(scope: ChatScope, draft: string): void {
    this.update(this.entry(scope), { draft });
  }

  selectAnswer(scope: ChatScope, messageId: string): void {
    const entry = this.entry(scope);
    if (entry.state.thread?.messages.some((message) => message.id === messageId && message.role === "assistant" && message.response)) {
      this.update(entry, { selectedAnswerId: messageId });
    }
  }

  load(scope: ChatScope): Promise<void> {
    const entry = this.entry(scope);
    if (entry.state.pending || entry.state.clearing) return Promise.resolve();
    if (entry.loading) return entry.loading;
    const version = ++entry.version;
    this.update(entry, { loading: true, loadError: null });
    const loading = Promise.resolve().then(async () => {
      try {
        const thread = await this.api.qaThread(scope);
        if (entry.version === version) {
          if (thread.projectId !== scope.projectId || thread.paperId !== scope.paperId) {
            throw new Error("The returned conversation does not match the selected sources.");
          }
          const answers = thread.messages.filter((message) => message.role === "assistant" && message.response);
          const latestId = answers.at(-1)?.id ?? null;
          const previousLatestId = entry.state.thread?.messages.filter((message) => message.role === "assistant" && message.response).at(-1)?.id ?? null;
          const keepSelection = latestId === previousLatestId && answers.some((message) => message.id === entry.state.selectedAnswerId);
          this.update(entry, { thread, selectedAnswerId: keepSelection ? entry.state.selectedAnswerId : latestId });
        }
      } catch (error) {
        if (entry.version === version) this.update(entry, { loadError: errorMessage(error) });
      } finally {
        if (entry.version === version) {
          entry.loading = null;
          this.update(entry, { loading: false });
        }
      }
    });
    entry.loading = loading;
    return loading;
  }

  async ask(scope: ChatScope, question: string, selection: Pick<ChatRequest, "providerId" | "model">): Promise<boolean> {
    const entry = this.entry(scope);
    question = question.trim();
    if (!question || !entry.state.thread || entry.state.pending || entry.state.clearing || entry.state.loading) return false;
    ++entry.version;
    entry.loading = null;
    const request = { ...scope, ...selection, question, threadRevision: entry.state.thread.revision };
    this.update(entry, { pending: request, error: null, draft: "" });
    try {
      const response = await this.api.qa(request);
      const thread = entry.state.thread!;
      const timestamp = new Date().toISOString();
      const messageId = response.messageId ?? `pending-${timestamp}`;
      // The POST has already saved the exchange. Keep it visible even if the
      // following history refresh fails; retrying a successful send duplicates it.
      this.update(entry, {
        pending: null,
        selectedAnswerId: messageId,
        thread: {
          ...thread,
          revision: response.threadRevision ?? thread.revision,
          messages: [...thread.messages,
            { id: `${messageId}-user`, role: "user", content: question, createdAt: timestamp, response: null },
            { id: messageId, role: "assistant", content: response.answer, createdAt: timestamp, response }
          ],
          updatedAt: timestamp
        }
      });
      void this.load(scope);
      return true;
    } catch (error) {
      this.update(entry, {
        pending: null,
        draft: entry.state.draft || question,
        error: { operation: "answer", question, message: errorMessage(error) }
      });
      void this.load(scope);
      return false;
    }
  }

  async clear(scope: ChatScope): Promise<boolean> {
    const entry = this.entry(scope);
    if (entry.state.pending || entry.state.clearing) return false;
    ++entry.version;
    entry.loading = null;
    this.update(entry, { clearing: true, loading: false, error: null, loadError: null });
    try {
      const revision = entry.state.thread?.revision;
      const thread = await this.api.clearQaThread({ ...scope, ...(revision === undefined ? {} : { threadRevision: revision }) });
      this.update(entry, { thread, selectedAnswerId: null, draft: "", clearing: false });
      return true;
    } catch (error) {
      this.update(entry, { clearing: false, error: { operation: "archive", question: "", message: errorMessage(error) } });
      void this.load(scope);
      return false;
    }
  }

  private entry(scope: ChatScope): SessionEntry {
    const key = scopeKey(scope);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        state: { thread: null, selectedAnswerId: null, draft: "", pending: null, error: null, loadError: null, loading: false, clearing: false },
        version: 0,
        loading: null
      };
      this.entries.set(key, entry);
    }
    return entry;
  }

  private update(entry: SessionEntry, patch: Partial<ChatSession>): void {
    entry.state = { ...entry.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
}
