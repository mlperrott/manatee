import { afterEach, describe, expect, it, vi } from "vitest";

import type { DocumentCommand } from "./DocumentEngine";
import {
  DocumentSession,
  type DocumentStore,
  type SavedDocument,
  type SessionDocumentAdapter,
} from "./DocumentSession";
import type { DocumentHint, DocumentKind, DocumentSnapshot } from "./types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function snapshot(
  source: string,
  kind: DocumentKind = "mermaid",
): DocumentSnapshot {
  const valid = !source.endsWith("[");
  return Object.freeze({
    kind,
    source,
    semanticModel: valid ? {} : undefined,
    presentationModel: valid ? {} : undefined,
    view: valid ? { source } : undefined,
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
        move: { state: "inapplicable" },
        resize: { state: "inapplicable" },
        route: { state: "inapplicable" },
        "set-appearance": { state: "inapplicable" },
        "set-attribute": { state: "inapplicable" },
        "create-styling-rule": { state: "inapplicable" },
        "set-spacing": { state: "inapplicable" },
        "use-automatic-position": { state: "inapplicable" },
        "reset-layout": { state: "inapplicable" },
        "cleanup-unmatched": { state: "inapplicable" },
      },
    } as const,
  });
}

class FakeAdapter implements SessionDocumentAdapter {
  readonly kind: DocumentKind;
  readonly replacements: string[] = [];
  readonly events: string[] = [];
  disposed = false;
  openCalls = 0;
  current: DocumentSnapshot | undefined;
  openResult: (source: string) => Promise<DocumentSnapshot>;
  replaceResult: (source: string) => Promise<DocumentSnapshot>;

  constructor(
    kind: DocumentKind = "mermaid",
    openResult = async (source: string) => snapshot(source, kind),
    replaceResult = async (source: string) => snapshot(source, kind),
  ) {
    this.kind = kind;
    this.openResult = openResult;
    this.replaceResult = replaceResult;
  }

  matches(_source: string, _hint?: DocumentHint): boolean {
    return true;
  }

  async open(source: string): Promise<DocumentSnapshot> {
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

  async replaceSource(source: string): Promise<DocumentSnapshot> {
    this.events.push(`replace:${source}`);
    this.replacements.push(source);
    this.current = await this.replaceResult(source);
    return this.current;
  }

  snapshot(): DocumentSnapshot {
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

function registrations(adapters: FakeAdapter[]) {
  return {
    mermaid: { create: () => adapters.shift()! },
    bpmn: { create: () => new FakeAdapter("bpmn") },
  };
}

afterEach(() => vi.useRealTimers());

describe("DocumentSession", () => {
  it("prevents a delayed document open from replacing a newer document", async () => {
    const firstOpen = deferred<DocumentSnapshot>();
    const first = new FakeAdapter("mermaid", () => firstOpen.promise);
    const second = new FakeAdapter();
    const session = new DocumentSession({
      adapters: registrations([first, second]),
      store: new MemoryStore(),
    });

    const openingFirst = session.open({
      kind: "mermaid",
      filename: "first.mmd",
      source: "first",
    });
    await vi.waitFor(() => expect(first.openCalls).toBe(1));
    await session.open({
      kind: "mermaid",
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
    const firstEdit = deferred<DocumentSnapshot>();
    const adapter = new FakeAdapter("mermaid", undefined, (source) =>
      source === "first"
        ? firstEdit.promise
        : Promise.resolve(snapshot(source)),
    );
    const session = new DocumentSession({
      adapters: registrations([adapter]),
      store: new MemoryStore(),
      sourceEditDelayMs: 20,
    });
    await session.open({ kind: "mermaid", filename: "a.mmd", source: "base" });

    session.editSource("first");
    await vi.advanceTimersByTimeAsync(20);
    session.editSource("second");
    firstEdit.resolve(snapshot("first"));
    await vi.advanceTimersByTimeAsync(20);
    await vi.waitFor(() =>
      expect(session.state().snapshot?.source).toBe("second"),
    );

    expect(adapter.replacements).toEqual(["first", "second"]);
    expect(session.state().source).toBe("second");
    session.dispose();
  });

  it("applies pending source text before a following command", async () => {
    const adapter = new FakeAdapter();
    const session = new DocumentSession({
      adapters: registrations([adapter]),
      store: new MemoryStore(),
      sourceEditDelayMs: 10_000,
    });
    await session.open({ kind: "mermaid", filename: "a.mmd", source: "base" });

    session.editSource("typed");
    await session.execute({ type: "select", elementId: "A" });

    expect(adapter.events).toEqual(["replace:typed", "execute:select"]);
    expect(session.state().source).toBe("typed");
    session.dispose();
  });

  it("enables persistence when storage initialization finishes after an open", async () => {
    const loaded = deferred<SavedDocument | undefined>();
    const store = new MemoryStore();
    store.loadResult = () => loaded.promise;
    const session = new DocumentSession({
      adapters: registrations([new FakeAdapter()]),
      store,
    });
    const initializing = session.initialize({
      kind: "mermaid",
      filename: "fallback.mmd",
      source: "fallback",
    });
    await session.open({
      kind: "mermaid",
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
      adapters: registrations([new FakeAdapter(), new FakeAdapter()]),
      store,
      now: () => 42,
    });
    await session.initialize({
      kind: "mermaid",
      filename: "first.mmd",
      source: "first",
    });
    await session.open({
      kind: "mermaid",
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
      kind: "mermaid",
      source: "flowchart LR\nA[",
      lastValidSource: "flowchart LR\nA --> B",
      savedAt: 1,
    };
    const fallback = new FakeAdapter();
    const recovered = new FakeAdapter();
    const session = new DocumentSession({
      adapters: registrations([fallback, recovered]),
      store,
    });
    await session.initialize({
      kind: "mermaid",
      filename: "example.mmd",
      source: "example",
    });
    expect(session.state().recovery?.filename).toBe("recovered.mmd");

    await session.recoverAutosave();

    expect(recovered.replacements).toEqual(["flowchart LR\nA["]);
    expect(session.state()).toMatchObject({
      filename: "recovered.mmd",
      source: "flowchart LR\nA[",
      recovery: undefined,
    });
    session.dispose();
  });
});
