import type { MermaidDocumentSnapshot } from "../../mermaid/MermaidDocument";
import type { DocumentCommand } from "./commands";

export interface SavedDocument {
  readonly schemaVersion: 2;
  readonly filename: string;
  readonly source: string;
  readonly lastValidSource?: string;
  readonly savedAt: number;
}

export interface DocumentStore {
  load(): Promise<SavedDocument | undefined>;
  save(record: SavedDocument): Promise<void>;
  clear(): Promise<void>;
}

export interface SessionDocument {
  open(source: string): Promise<MermaidDocumentSnapshot>;
  execute(
    command: DocumentCommand,
  ): Promise<{ snapshot: MermaidDocumentSnapshot }>;
  replaceSource(source: string): Promise<MermaidDocumentSnapshot>;
  dispose(): void;
}

export interface OpenDocumentRequest {
  readonly filename: string;
  readonly source: string | Promise<string>;
  readonly previewSource?: string;
}

export type DocumentSessionStatus =
  | { readonly kind: "ready" }
  | { readonly kind: "loading"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

export interface DocumentSessionState {
  readonly filename: string;
  readonly source: string;
  readonly snapshot: MermaidDocumentSnapshot | undefined;
  readonly recovery: SavedDocument | undefined;
  readonly status: DocumentSessionStatus;
}

export interface DocumentSessionOptions {
  readonly createDocument: () => SessionDocument | Promise<SessionDocument>;
  readonly store: DocumentStore;
  readonly initialFilename?: string;
  readonly initialSource?: string;
  readonly sourceEditDelayMs?: number;
  readonly now?: () => number;
  readonly schedule?: (callback: () => void, delayMs: number) => () => void;
}

type StateListener = (state: DocumentSessionState) => void;

interface PendingSourceEdit {
  readonly source: string;
  readonly revision: number;
  readonly active: SessionDocument;
}

const defaultSchedule = (callback: () => void, delayMs: number) => {
  const handle = setTimeout(callback, delayMs);
  return () => clearTimeout(handle);
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class DocumentSession implements Disposable {
  readonly #createDocument: DocumentSessionOptions["createDocument"];
  readonly #store: DocumentStore;
  readonly #sourceEditDelayMs: number;
  readonly #now: () => number;
  readonly #schedule: NonNullable<DocumentSessionOptions["schedule"]>;
  readonly #listeners = new Set<StateListener>();
  #state: DocumentSessionState;
  #active: SessionDocument | undefined;
  #fallback: OpenDocumentRequest | undefined;
  #lastValidSource: string | undefined;
  #revision = 0;
  #cancelSourceEdit: (() => void) | undefined;
  #pendingSourceEdit: PendingSourceEdit | undefined;
  #commandTail: Promise<void> = Promise.resolve();
  #persistenceReady = false;
  #pendingSave: SavedDocument | undefined;
  #saving = false;
  #disposed = false;

  constructor(options: DocumentSessionOptions) {
    this.#createDocument = options.createDocument;
    this.#store = options.store;
    this.#sourceEditDelayMs = options.sourceEditDelayMs ?? 180;
    this.#now = options.now ?? Date.now;
    this.#schedule = options.schedule ?? defaultSchedule;
    this.#state = Object.freeze({
      filename: options.initialFilename ?? "",
      source: options.initialSource ?? "",
      snapshot: undefined,
      recovery: undefined,
      status: Object.freeze({ kind: "ready" as const }),
    });
  }

  state(): DocumentSessionState {
    return this.#state;
  }

  subscribe(listener: StateListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async initialize(fallback: OpenDocumentRequest): Promise<void> {
    this.#fallback = fallback;
    const revision = this.#revision;
    try {
      const saved = await this.#store.load();
      if (this.#disposed) return;
      if (saved) this.#update({ recovery: saved });
      else {
        this.#persistenceReady = true;
        this.#saveCurrentState();
      }
    } catch (error) {
      if (this.#disposed) return;
      this.#persistenceReady = true;
      this.#saveCurrentState();
      this.reportError(error);
    }
    if (this.#isCurrent(revision)) await this.open(fallback);
  }

  async open(
    requestInput: OpenDocumentRequest | Promise<OpenDocumentRequest>,
    loadingMessage?: string,
  ): Promise<void> {
    const revision = this.#beginOperation();
    this.#commandTail = Promise.resolve();
    this.#active?.dispose();
    this.#active = undefined;
    const immediate = "filename" in requestInput ? requestInput : undefined;
    this.#update({
      ...(typeof immediate?.source === "string"
        ? { source: immediate.source }
        : {}),
      snapshot: undefined,
      status: Object.freeze({
        kind: "loading",
        message:
          loadingMessage ??
          (immediate ? `Opening ${immediate.filename}…` : "Opening document…"),
      }),
    });

    let candidate: SessionDocument | undefined;
    try {
      const request = await Promise.resolve(requestInput);
      if (!this.#isCurrent(revision)) return;
      const [active, source] = await Promise.all([
        this.#createDocument(),
        Promise.resolve(request.source),
      ]);
      candidate = active;
      if (!this.#isCurrent(revision)) {
        candidate.dispose();
        return;
      }
      this.#active = candidate;
      this.#lastValidSource = request.previewSource;
      let snapshot = await candidate.open(request.previewSource ?? source);
      if (!this.#owns(revision, candidate)) return;
      if (request.previewSource && request.previewSource !== source) {
        snapshot = await candidate.replaceSource(source);
      }
      await this.#accept(snapshot, request.filename, revision, candidate);
    } catch (error) {
      if (this.#isCurrent(revision)) {
        candidate?.dispose();
        if (this.#active === candidate) this.#active = undefined;
        this.reportError(error);
      } else if (candidate && this.#active !== candidate) {
        candidate.dispose();
      }
    }
  }

  execute(command: DocumentCommand): Promise<void> {
    this.#flushPendingSourceEdit();
    const revision = this.#revision;
    const active = this.#active;
    if (!active) return Promise.resolve();
    return this.#enqueue(async () => {
      if (!this.#owns(revision, active)) return;
      try {
        const result = await active.execute(command);
        await this.#accept(
          result.snapshot,
          this.#state.filename,
          revision,
          active,
        );
      } catch (error) {
        if (this.#owns(revision, active)) this.reportError(error);
      }
    });
  }

  editSource(source: string): void {
    const active = this.#active;
    if (!active) return;
    const revision = this.#beginOperation();
    this.#update({ source });
    const edit = { source, revision, active };
    this.#pendingSourceEdit = edit;
    this.#cancelSourceEdit = this.#schedule(() => {
      this.#cancelSourceEdit = undefined;
      if (this.#pendingSourceEdit === edit) this.#pendingSourceEdit = undefined;
      void this.#enqueue(() => this.#applySourceEdit(edit));
    }, this.#sourceEditDelayMs);
  }

  async recoverAutosave(): Promise<void> {
    const saved = this.#state.recovery;
    if (!saved) return;
    this.#persistenceReady = true;
    this.#update({ recovery: undefined });
    await this.open({
      filename: saved.filename,
      source: saved.source,
      ...(saved.lastValidSource
        ? { previewSource: saved.lastValidSource }
        : {}),
    });
  }

  async discardAutosave(): Promise<void> {
    const fallback = this.#fallback;
    if (!fallback) return;
    const revision = this.#beginOperation();
    this.#commandTail = Promise.resolve();
    this.#active?.dispose();
    this.#active = undefined;
    this.#update({
      snapshot: undefined,
      status: Object.freeze({
        kind: "loading",
        message: "Discarding autosaved work…",
      }),
    });
    try {
      await this.#store.clear();
      if (!this.#isCurrent(revision)) return;
      this.#persistenceReady = true;
      this.#update({ recovery: undefined });
      await this.open(fallback);
    } catch (error) {
      if (this.#isCurrent(revision)) this.reportError(error);
    }
  }

  reportError(error: unknown): void {
    if (this.#disposed) return;
    this.#update({
      status: Object.freeze({ kind: "error", message: errorMessage(error) }),
    });
  }

  [Symbol.dispose](): void {
    this.dispose();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#revision += 1;
    this.#cancelPendingSourceEdit();
    this.#active?.dispose();
    this.#active = undefined;
    this.#listeners.clear();
    this.#pendingSave = undefined;
  }

  #beginOperation(): number {
    this.#revision += 1;
    this.#cancelPendingSourceEdit();
    return this.#revision;
  }

  #cancelPendingSourceEdit(): void {
    this.#cancelSourceEdit?.();
    this.#cancelSourceEdit = undefined;
    this.#pendingSourceEdit = undefined;
  }

  #flushPendingSourceEdit(): void {
    const edit = this.#pendingSourceEdit;
    if (!edit) return;
    this.#cancelSourceEdit?.();
    this.#cancelSourceEdit = undefined;
    this.#pendingSourceEdit = undefined;
    void this.#enqueue(() => this.#applySourceEdit(edit));
  }

  async #applySourceEdit(edit: PendingSourceEdit): Promise<void> {
    if (!this.#owns(edit.revision, edit.active)) return;
    try {
      const snapshot = await edit.active.replaceSource(edit.source);
      await this.#accept(
        snapshot,
        this.#state.filename,
        edit.revision,
        edit.active,
      );
    } catch (error) {
      if (this.#owns(edit.revision, edit.active)) this.reportError(error);
    }
  }

  #isCurrent(revision: number): boolean {
    return !this.#disposed && revision === this.#revision;
  }

  #owns(revision: number, active: SessionDocument): boolean {
    return this.#isCurrent(revision) && active === this.#active;
  }

  async #accept(
    snapshot: MermaidDocumentSnapshot,
    filename: string,
    revision: number,
    active: SessionDocument,
  ): Promise<void> {
    if (!this.#owns(revision, active)) return;
    if (snapshot.valid) this.#lastValidSource = snapshot.source;
    this.#update({ filename, source: snapshot.source, snapshot });
    if (!this.#owns(revision, active)) return;
    this.#update({ status: Object.freeze({ kind: "ready" }) });
    if (this.#persistenceReady) {
      this.#scheduleSave({
        filename,
        schemaVersion: 2,
        source: snapshot.source,
        ...(this.#lastValidSource
          ? { lastValidSource: this.#lastValidSource }
          : {}),
        savedAt: this.#now(),
      });
    }
  }

  #enqueue(work: () => Promise<void>): Promise<void> {
    const next = this.#commandTail.then(work, work);
    this.#commandTail = next.catch(() => undefined);
    return next;
  }

  #scheduleSave(record: SavedDocument): void {
    this.#pendingSave = record;
    if (!this.#saving) void this.#drainSaves();
  }

  #saveCurrentState(): void {
    const snapshot = this.#state.snapshot;
    if (!snapshot || this.#state.status.kind !== "ready") return;
    this.#scheduleSave({
      filename: this.#state.filename,
      schemaVersion: 2,
      source: snapshot.source,
      ...(this.#lastValidSource
        ? { lastValidSource: this.#lastValidSource }
        : {}),
      savedAt: this.#now(),
    });
  }

  async #drainSaves(): Promise<void> {
    this.#saving = true;
    while (!this.#disposed && this.#pendingSave) {
      const record = this.#pendingSave;
      this.#pendingSave = undefined;
      try {
        await this.#store.save(record);
      } catch (error) {
        if (
          this.#state.filename === record.filename &&
          this.#state.snapshot?.source === record.source
        ) {
          this.reportError(error);
        }
      }
    }
    this.#saving = false;
  }

  #update(changes: Partial<DocumentSessionState>): void {
    if (this.#disposed) return;
    this.#state = Object.freeze({ ...this.#state, ...changes });
    for (const listener of this.#listeners) listener(this.#state);
  }
}
