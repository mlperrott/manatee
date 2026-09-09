import type { DocumentEngine } from "../core/document/DocumentEngine";
import type {
  DocumentHint,
  DocumentKind,
  DocumentSnapshot,
} from "../core/document/types";

export interface DocumentAdapter<
  Snapshot extends DocumentSnapshot,
> extends DocumentEngine<Snapshot> {
  readonly kind: DocumentKind;
  matches(source: string, hint?: DocumentHint): boolean;
}
