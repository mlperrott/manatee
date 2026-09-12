import type {
  DocumentStore,
  SavedDocument,
} from "../core/document/DocumentSession";

export type {
  DocumentStore as DocumentRepository,
  SavedDocument,
} from "../core/document/DocumentSession";

const DATABASE = "manatee-studio";
const STORE = "documents";
const ACTIVE_DOCUMENT = "active";

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
      const request = database
        .transaction(STORE, "readonly")
        .objectStore(STORE)
        .get(ACTIVE_DOCUMENT);
      return (await requestResult(request)) as SavedDocument | undefined;
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
