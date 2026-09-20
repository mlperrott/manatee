import { afterEach, describe, expect, it, vi } from "vitest";

import type { DocumentCommand } from "./commands";
import {
  DocumentSession,
  type DocumentStore,
  type SavedDocument,
  type SessionDocument,
} from "./DocumentSession";
import type { MermaidDocumentSnapshot } from "../../mermaid/MermaidDocument";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function snapshot(source: string): MermaidDocumentSnapshot {
  const valid = !source.endsWith("[");
  return Object.freeze({
    source,
    model: undefined,
    metadata: undefined,
    scene: undefined,
    diagnostics: [],
    selectedElementId: undefined,
    valid,
    previewOutdated: false,
    dirty: false,
    commands: {
      visualEditing: valid,
      imageExport: valid,
      undo: false,
      redo: false,
      presentation: {
        "edit-metadata": { state: "inapplicable" },
        move: { state: "inapplicable" },
        "set-appearance": { state: "inapplicable" },
        "set-notation": { state: "inapplicable" },
        "set-attribute": { state: "inapplicable" },
        "create-styling-rule": { state: "inapplicable" },
        "set-spacing": { state: "inapplicable" },
        "use-automatic-position": { state: "inapplicable" },
        "reset-layout": { state: "inapplicable" },
        "cleanup-unmatched": { state: "inapplicable" },
      },
    } as const,
  }) as MermaidDocumentSnapshot;
}

class FakeDocument implements SessionDocument {
  readonly replacements: string[] = [];
  readonly events: string[] = [];
  disposed = false;
  openCalls = 0;
  current: MermaidDocumentSnapshot | undefined;
  openResult: (source: string) => Promise<MermaidDocumentSnapshot>;
  replaceResult: (source: string) => Promise<MermaidDocumentSnapshot>;

  constructor(
    openResult = async (source: string) => snapshot(source),
    replaceResult = async (source: string) => snapshot(source),
  ) {
    this.openResult = openResult;
    this.replaceResult = replaceResult;
  }

  async open(source: string): Promise<MermaidDocumentSnapshot> {
    this.openCalls += 1;
    this.current = await this.openResult(source);
    return this.current;
  }

  async execute(command: DocumentCommand) {
    this.events.push(`execute:${command.type}`);
    if (command.type === "replace-source") {
      const next = await this.replaceSource(command.source);
      return { snapshot: next, patches: [] };
    }
    return { snapshot: this.snapshot(), patches: [] };
  }

  async replaceSource(source: string): Promise<MermaidDocumentSnapshot> {
    this.events.push(`replace:${source}`);
    this.replacements.push(source);
    this.current = await this.replaceResult(source);
    return this.current;
  }

  snapshot(): MermaidDocumentSnapshot {
    if (!this.current) throw new Error("Document is not open.");
    return this.current;
  }

  dispose(): void {
    this.disposed = true;
  }
}

class MemoryStore implements DocumentStore {
  loaded: SavedDocument | undefined;
  readonly saved: SavedDocument[] = [];
  clearCount = 0;
  loadResult: () => Promise<SavedDocument | undefined> = async () =>
    this.loaded;
  saveResult: (record: SavedDocument) => Promise<void> = async () => {};

  async load(): Promise<SavedDocument | undefined> {
    return await this.loadResult();
  }

  async save(record: SavedDocument): Promise<void> {
    this.saved.push(record);
    await this.saveResult(record);
  }

  async clear(): Promise<void> {
    this.clearCount += 1;
  }
}

function documentFactory(documents: FakeDocument[]) {
  return () => documents.shift()!;
}

afterEach(() => vi.useRealTimers());

describe("DocumentSession", () => {
  it("reuses the Mermaid document across sequential opens", async () => {
    const active = new FakeDocument();
    const createDocument = vi.fn(() => active);
    const session = new DocumentSession({
      createDocument,
      store: new MemoryStore(),
    });

    await session.open({ filename: "first.mmd", source: "first" });
    await session.open({ filename: "second.mmd", source: "second" });

    expect(createDocument).toHaveBeenCalledTimes(1);
    expect(active.openCalls).toBe(2);
    expect(active.disposed).toBe(false);
    session.dispose();
  });

  it("prevents a delayed document open from replacing a newer document", async () => {
    const firstOpen = deferred<MermaidDocumentSnapshot>();
    const first = new FakeDocument(() => firstOpen.promise);
    const second = new FakeDocument();
    const session = new DocumentSession({
      createDocument: documentFactory([first, second]),
      store: new MemoryStore(),
    });

    const openingFirst = session.open({
      filename: "first.mmd",
      source: "first",
    });
    await vi.waitFor(() => expect(first.openCalls).toBe(1));
    await session.open({
      filename: "second.mmd",
      source: "second",
    });
    firstOpen.resolve(snapshot("first"));
    await openingFirst;

    expect(first.disposed).toBe(true);
    expect(session.state()).toMatchObject({
      filename: "second.mmd",
      source: "second",
      snapshot: { source: "second" },
      status: { kind: "ready" },
    });
    session.dispose();
  });

  it("publishes only the latest debounced source edit", async () => {
    vi.useFakeTimers();
    const firstEdit = deferred<MermaidDocumentSnapshot>();
    const active = new FakeDocument(undefined, (source) =>
      source === "first"
        ? firstEdit.promise
        : Promise.resolve(snapshot(source)),
    );
    const session = new DocumentSession({
      createDocument: documentFactory([active]),
      store: new MemoryStore(),
      sourceEditDelayMs: 20,
    });
    await session.open({ filename: "a.mmd", source: "base" });

    session.editSource("first");
    await vi.advanceTimersByTimeAsync(20);
    session.editSource("second");
    firstEdit.resolve(snapshot("first"));
    await vi.advanceTimersByTimeAsync(20);
    await vi.waitFor(() =>
      expect(session.state().snapshot?.source).toBe("second"),
    );

    expect(active.replacements).toEqual(["first", "second"]);
    expect(session.state().source).toBe("second");
    session.dispose();
  });

  it("applies pending source text before a following command", async () => {
    const active = new FakeDocument();
    const session = new DocumentSession({
      createDocument: documentFactory([active]),
      store: new MemoryStore(),
      sourceEditDelayMs: 10_000,
    });
    await session.open({ filename: "a.mmd", source: "base" });

    session.editSource("typed");
    await session.execute({ type: "select", elementId: "A" });

    expect(active.events).toEqual(["replace:typed", "execute:select"]);
    expect(session.state().source).toBe("typed");
    session.dispose();
  });

  it("enables persistence when storage initialization finishes after an open", async () => {
    const loaded = deferred<SavedDocument | undefined>();
    const store = new MemoryStore();
    store.loadResult = () => loaded.promise;
    const session = new DocumentSession({
      createDocument: documentFactory([new FakeDocument()]),
      store,
    });
    const initializing = session.initialize({
      filename: "fallback.mmd",
      source: "fallback",
    });
    await session.open({
      filename: "chosen.mmd",
      source: "chosen",
    });

    loaded.resolve(undefined);
    await initializing;
    await vi.waitFor(() => expect(store.saved).toHaveLength(1));

    expect(session.state().filename).toBe("chosen.mmd");
    expect(store.saved[0]).toMatchObject({
      filename: "chosen.mmd",
      source: "chosen",
    });
    session.dispose();
  });

  it("serializes autosaves so the newest document is stored last", async () => {
    const firstSave = deferred<void>();
    const store = new MemoryStore();
    store.saveResult = (record) =>
      record.filename === "first.mmd" ? firstSave.promise : Promise.resolve();
    const session = new DocumentSession({
      createDocument: documentFactory([new FakeDocument(), new FakeDocument()]),
      store,
      now: () => 42,
    });
    await session.initialize({
      filename: "first.mmd",
      source: "first",
    });
    await session.open({
      filename: "second.mmd",
      source: "second",
    });
    expect(store.saved.map(({ filename }) => filename)).toEqual(["first.mmd"]);

    firstSave.resolve();
    await vi.waitFor(() => expect(store.saved).toHaveLength(2));
    expect(store.saved[1]).toMatchObject({
      filename: "second.mmd",
      source: "second",
      lastValidSource: "second",
      savedAt: 42,
    });
    session.dispose();
  });

  it("reopens the last valid source before restoring invalid autosaved text", async () => {
    const store = new MemoryStore();
    store.loaded = {
      filename: "recovered.mmd",
      schemaVersion: 2,
      source: "flowchart LR\nA[",
      lastValidSource: "flowchart LR\nA --> B",
      savedAt: 1,
    };
    const fallback = new FakeDocument();
    const session = new DocumentSession({
      createDocument: documentFactory([fallback]),
      store,
    });
    await session.initialize({
      filename: "example.mmd",
      source: "example",
    });
    expect(session.state().recovery?.filename).toBe("recovered.mmd");

    await session.recoverAutosave();

    expect(fallback.replacements).toEqual(["flowchart LR\nA["]);
    expect(session.state()).toMatchObject({
      filename: "recovered.mmd",
      source: "flowchart LR\nA[",
      recovery: undefined,
    });
    session.dispose();
  });
});
