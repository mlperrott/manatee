import type {
  SavedWorkspace,
  WorkspaceTab,
} from "../core/document/DocumentWorkspace";
import type {
  DocumentStore,
  SavedDocument,
} from "../core/document/DocumentSession";

export type {
  DocumentStore as DocumentRepository,
  SavedDocument,
} from "../core/document/DocumentSession";

export interface RetiredSource {
  readonly filename: string;
  readonly source: string;
  readonly savedAt: number;
}

const DATABASE = "manatee-studio";
const STORE = "documents";
const ACTIVE_DOCUMENT = "active";
const RETIRED_BPMN_DOCUMENT = "retired-bpmn";

type StoredRecord = Record<string, unknown>;

function storedRecord(value: unknown): StoredRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as StoredRecord)
    : undefined;
}

function savedDocument(value: unknown): SavedDocument | undefined {
  const record = storedRecord(value);
  if (
    !record ||
    record.kind === "bpmn" ||
    typeof record.filename !== "string" ||
    typeof record.source !== "string" ||
    typeof record.savedAt !== "number"
  ) {
    return undefined;
  }
  return {
    schemaVersion: 2,
    filename: record.filename,
    source: record.source,
    ...(typeof record.lastValidSource === "string"
      ? { lastValidSource: record.lastValidSource }
      : {}),
    savedAt: record.savedAt,
  };
}

function retiredSource(value: unknown): RetiredSource | undefined {
  const record = storedRecord(value);
  return record?.kind === "bpmn" &&
    typeof record.filename === "string" &&
    typeof record.source === "string" &&
    typeof record.savedAt === "number"
    ? {
        filename: record.filename,
        source: record.source,
        savedAt: record.savedAt,
      }
    : undefined;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

export class IndexedDbDocumentRepository implements DocumentStore {
  readonly #indexedDb: IDBFactory;

  constructor(indexedDb: IDBFactory = indexedDB) {
    this.#indexedDb = indexedDb;
  }

  async load(): Promise<SavedDocument | undefined> {
    const database = await this.#open();
    try {
      const stored = await requestResult(
        database
          .transaction(STORE, "readonly")
          .objectStore(STORE)
          .get(ACTIVE_DOCUMENT),
      );
      if (storedRecord(stored)?.kind === "bpmn") {
        const store = database
          .transaction(STORE, "readwrite")
          .objectStore(STORE);
        const retire = requestResult(store.put(stored, RETIRED_BPMN_DOCUMENT));
        const removeActive = requestResult(store.delete(ACTIVE_DOCUMENT));
        await Promise.all([retire, removeActive]);
        return undefined;
      }
      return savedDocument(stored);
    } finally {
      database.close();
    }
  }

  async save(document: SavedDocument): Promise<void> {
    const database = await this.#open();
    try {
      const request = database
        .transaction(STORE, "readwrite")
        .objectStore(STORE)
        .put(document, ACTIVE_DOCUMENT);
      await requestResult(request);
    } finally {
      database.close();
    }
  }

  async loadRetiredSource(): Promise<RetiredSource | undefined> {
    const database = await this.#open();
    try {
      const stored = await requestResult(
        database
          .transaction(STORE, "readonly")
          .objectStore(STORE)
          .get(RETIRED_BPMN_DOCUMENT),
      );
      return retiredSource(stored);
    } finally {
      database.close();
    }
  }

  async discardRetiredSource(): Promise<void> {
    const database = await this.#open();
    try {
      await requestResult(
        database
          .transaction(STORE, "readwrite")
          .objectStore(STORE)
          .delete(RETIRED_BPMN_DOCUMENT),
      );
    } finally {
      database.close();
    }
  }

  async clear(): Promise<void> {
    const database = await this.#open();
    try {
      const request = database
        .transaction(STORE, "readwrite")
        .objectStore(STORE)
        .delete(ACTIVE_DOCUMENT);
      await requestResult(request);
    } finally {
      database.close();
    }
  }

  async loadWorkspace(): Promise<SavedWorkspace | undefined> {
    const database = await this.#open();
    try {
      const value = storedRecord(
        await requestResult(
          database
            .transaction(STORE, "readonly")
            .objectStore(STORE)
            .get("workspace"),
        ),
      );
      if (
        value?.version !== 1 ||
        !Array.isArray(value.tabs) ||
        typeof value.activeId !== "string"
      )
        return;
      const tabs = value.tabs.filter((tab: unknown): tab is WorkspaceTab => {
        const record = storedRecord(tab);
        return (
          !!record &&
          typeof record.id === "string" &&
          typeof record.filename === "string" &&
          typeof record.source === "string" &&
          typeof record.sourceEditing === "boolean" &&
          typeof record.savedSource === "string"
        );
      });
      return { version: 1, activeId: value.activeId, tabs };
    } finally {
      database.close();
    }
  }

  async saveWorkspace(workspace: SavedWorkspace): Promise<void> {
    const database = await this.#open();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORE, "readwrite");
        transaction.objectStore(STORE).put(workspace, "workspace");
        transaction.oncomplete = () => resolve();
        transaction.onerror = transaction.onabort = () =>
          reject(transaction.error ?? new Error("Workspace save failed."));
      });
    } finally {
      database.close();
    }
  }

  #open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = this.#indexedDb.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("Could not open autosave storage."));
    });
  }
}
