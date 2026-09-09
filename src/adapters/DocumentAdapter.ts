import type {
  DocumentCommand,
  CommandResult,
} from "../core/document/DocumentEngine";
import type {
  DocumentHint,
  DocumentKind,
  DocumentSnapshot,
} from "../core/document/types";

export interface DocumentAdapter<Snapshot extends DocumentSnapshot> {
  readonly kind: DocumentKind;
  matches(source: string, hint?: DocumentHint): boolean;
  open(source: string, hint?: DocumentHint): Promise<Snapshot>;
  execute(
    snapshot: Snapshot,
    command: DocumentCommand,
  ): Promise<CommandResult<Snapshot>>;
}
