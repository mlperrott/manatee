import {
  DocumentSession,
  type DocumentSessionState,
  type DocumentStore,
  type OpenDocumentRequest,
  type SavedDocument,
  type SessionDocument,
} from "./DocumentSession";
import type { DocumentCommand } from "./commands";

export interface WorkspaceTab {
  readonly id: string;
  readonly filename: string;
  readonly source: string;
  readonly lastValidSource?: string;
  readonly sourceEditing: boolean;
  readonly savedSource: string;
  readonly exampleId?: string;
}
export interface SavedWorkspace {
  readonly version: 1;
  readonly activeId: string;
  readonly tabs: readonly WorkspaceTab[];
}
export interface WorkspaceStore extends DocumentStore {
  loadWorkspace(): Promise<SavedWorkspace | undefined>;
  saveWorkspace(workspace: SavedWorkspace): Promise<void>;
}
interface OpenTab {
  tab: WorkspaceTab;
  session: DocumentSession;
  unsubscribe: () => void;
}
const memoryStore: DocumentStore = {
  load: async () => undefined,
  save: async () => {},
  clear: async () => {},
};

/** Each open document owns a session; switching tabs never reopens its document. */
export class DocumentWorkspace {
  readonly #store: WorkspaceStore;
  readonly #createDocument: () => SessionDocument;
  readonly #listeners = new Set<(state: DocumentSessionState) => void>();
  #tabs: OpenTab[] = [];
  #activeId = "";
  #legacy: SavedDocument | undefined;
  #ready = false;
  #adding = 0;
  #saveRevision = 0;
  #savedRevision = 0;
  #lastRecord = "";
  #saveFailed = false;
  #disposed = false;
  #saveTail: Promise<void> = Promise.resolve();
  #initial: DocumentSessionState;
  #initialization: Promise<void> | undefined;
  #selectionRevision = 0;
  constructor(options: {
    store: WorkspaceStore;
    createDocument: () => SessionDocument;
    initialFilename: string;
    initialSource: string;
  }) {
    this.#store = options.store;
    this.#createDocument = options.createDocument;
    this.#initial = {
      filename: options.initialFilename,
      source: options.initialSource,
      snapshot: undefined,
      recovery: undefined,
      status: { kind: "ready" },
    };
  }
  state(): DocumentSessionState {
    return {
      ...(this.#active()?.session.state() ?? this.#initial),
      recovery: this.#legacy,
      workspaceSaving: this.#saveRevision !== this.#savedRevision,
      workspaceSaveFailed: this.#saveFailed,
    };
  }
  tabs(): readonly WorkspaceTab[] {
    return this.#tabs.map(({ tab }) => tab);
  }
  activeId(): string {
    return this.#activeId;
  }
  activeTab(): WorkspaceTab | undefined {
    return this.#active()?.tab;
  }
  subscribe(listener: (state: DocumentSessionState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  initialize(fallback: OpenDocumentRequest): Promise<void> {
    this.#initialization ??= this.#initialize(fallback);
    return this.#initialization;
  }
  async #initialize(fallback: OpenDocumentRequest): Promise<void> {
    try {
      const saved = await this.#store.loadWorkspace();
      if (this.#disposed) return;
      this.#legacy = await this.#store.load();
      if (saved?.tabs.length) {
        for (const tab of saved.tabs) await this.#add(tab);
        this.#activeId = this.#tabs.some(({ tab }) => tab.id === saved.activeId)
          ? saved.activeId
          : this.#tabs[0]!.tab.id;
      } else {
        await this.#open(fallback, true);
      }
      this.#ready = true;
      this.#publish();
    } catch (error) {
      await this.#open(fallback, true);
      this.#ready = true;
      this.reportError(error);
    }
  }
  async open(
    request: OpenDocumentRequest,
    sourceEditing = false,
    exampleId?: string,
  ): Promise<string> {
    await this.#initialization;
    return this.#open(request, sourceEditing, exampleId);
  }
  async #open(
    request: OpenDocumentRequest,
    sourceEditing = false,
    exampleId?: string,
  ): Promise<string> {
    const revision = ++this.#selectionRevision;
    const source = await request.source;
    const id = crypto.randomUUID();
    await this.#add({
      id,
      filename: request.filename,
      source,
      sourceEditing,
      savedSource: source,
      ...(request.previewSource
        ? { lastValidSource: request.previewSource }
        : {}),
      ...(exampleId ? { exampleId } : {}),
    });
    if (revision === this.#selectionRevision) this.#activeId = id;
    this.#publish();
    return id;
  }
  select(id: string): void {
    if (this.#tabs.some(({ tab }) => tab.id === id)) {
      this.#selectionRevision += 1;
      this.#activeId = id;
      this.#publish();
    }
  }
  dirty(id = this.#activeId): boolean {
    const tab = this.#tabs.find((entry) => entry.tab.id === id)?.tab;
    return !!tab && tab.source !== tab.savedSource;
  }
  markSaved(id: string, savedSource: string): void {
    const entry = this.#tabs.find(({ tab }) => tab.id === id);
    if (entry) {
      entry.tab = { ...entry.tab, savedSource };
      this.#publish();
    }
  }
  rename(filename: string): void {
    const entry = this.#active();
    if (entry && filename.trim()) {
      entry.session.rename(filename.trim());
    }
  }
  close(id: string): void {
    const index = this.#tabs.findIndex(({ tab }) => tab.id === id);
    if (index < 0 || this.#tabs.length === 1) return;
    const [entry] = this.#tabs.splice(index, 1);
    entry!.unsubscribe();
    entry!.session.dispose();
    if (this.#activeId === id)
      this.#activeId =
        this.#tabs[Math.min(index, this.#tabs.length - 1)]!.tab.id;
    this.#publish();
  }
  execute(command: DocumentCommand): Promise<void> {
    return this.#active()?.session.execute(command) ?? Promise.resolve();
  }
  editSource(source: string): void {
    this.#active()?.session.editSource(source);
  }
  reportError(error: unknown): void {
    this.#active()?.session.reportError(error);
  }
  async recoverAutosave(): Promise<void> {
    const saved = this.#legacy;
    if (!saved) return;
    await this.open(
      {
        filename: saved.filename,
        source: saved.source,
        ...(saved.lastValidSource
          ? { previewSource: saved.lastValidSource }
          : {}),
      },
      false,
    );
    this.#legacy = undefined;
    await this.#store.clear();
    this.#publish();
  }
  async discardAutosave(): Promise<void> {
    await this.#store.clear();
    this.#legacy = undefined;
    this.#publish();
  }
  async flushPersistence(): Promise<void> {
    await this.#saveTail;
  }
  dispose(): void {
    this.#disposed = true;
    for (const entry of this.#tabs) {
      entry.unsubscribe();
      entry.session.dispose();
    }
    this.#listeners.clear();
  }
  async #add(tab: WorkspaceTab): Promise<void> {
    if (this.#disposed) return;
    this.#adding += 1;
    const session = new DocumentSession({
      createDocument: this.#createDocument,
      store: memoryStore,
      initialSource: tab.source,
      initialFilename: tab.filename,
    });
    const entry: OpenTab = { tab, session, unsubscribe: () => {} };
    this.#tabs.push(entry);
    entry.unsubscribe = session.subscribe((state) => {
      entry.tab = {
        ...entry.tab,
        filename: state.filename,
        source: state.source,
        sourceEditing: state.snapshot?.sourceEditing ?? entry.tab.sourceEditing,
        ...(state.snapshot?.valid
          ? { lastValidSource: state.snapshot.source }
          : {}),
      };
      this.#publish();
    });
    try {
      await session.initialize({
        filename: tab.filename,
        source: tab.source,
        ...(tab.lastValidSource ? { previewSource: tab.lastValidSource } : {}),
      });
      await session.execute({
        type: "set-source-editing",
        allowed: tab.sourceEditing,
      });
    } finally {
      this.#adding -= 1;
    }
  }
  #active(): OpenTab | undefined {
    return this.#tabs.find(({ tab }) => tab.id === this.#activeId);
  }
  #notify(): void {
    if (!this.#disposed)
      for (const listener of this.#listeners) listener(this.state());
  }
  #publish(): void {
    if (this.#disposed || !this.#ready || this.#adding > 0) return;
    const record: SavedWorkspace = {
      version: 1,
      activeId: this.#activeId,
      tabs: this.tabs(),
    };
    const serialized = JSON.stringify(record);
    if (serialized === this.#lastRecord) {
      this.#notify();
      return;
    }
    this.#lastRecord = serialized;
    const revision = ++this.#saveRevision;
    this.#saveFailed = false;
    this.#notify();
    this.#saveTail = this.#saveTail
      .then(() => this.#store.saveWorkspace(record))
      .then(() => {
        this.#savedRevision = revision;
        this.#notify();
      })
      .catch((error: unknown) => {
        this.#lastRecord = "";
        if (revision === this.#saveRevision) this.#saveFailed = true;
        this.#savedRevision = revision;
        const state = {
          ...this.state(),
          status: {
            kind: "error" as const,
            message: `Workspace recovery could not be saved: ${error instanceof Error ? error.message : String(error)}`,
          },
        };
        if (!this.#disposed)
          for (const listener of this.#listeners) listener(state);
      });
  }
}
