import type { DocumentKind } from "../core/document/types";

export interface SavedDocument {
  readonly filename: string;
  readonly kind: DocumentKind;
  readonly source: string;
  readonly lastValidSource?: string;
  readonly savedAt: number;
}

export interface DocumentRepository {
  load(): Promise<SavedDocument | undefined>;
  save(document: SavedDocument): Promise<void>;
  clear(): Promise<void>;
}
