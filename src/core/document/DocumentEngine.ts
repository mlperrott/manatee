import type { DocumentHint, DocumentSnapshot, SourcePatch } from "./types";

export type SourceTransactionReason = "visual" | "cleanup" | "reset-layout";

export type DocumentCommand =
  | {
      readonly type: "replace-source";
      readonly source: string;
    }
  | {
      readonly type: "apply-patches";
      readonly patches: readonly SourcePatch[];
      readonly reason: SourceTransactionReason;
    }
  | {
      readonly type: "select";
      readonly elementId: string | undefined;
    }
  | { readonly type: "undo" }
  | { readonly type: "redo" };

export interface CommandResult<Snapshot extends DocumentSnapshot> {
  readonly snapshot: Snapshot;
  readonly patches: readonly SourcePatch[];
}

export interface DocumentEngine<Snapshot extends DocumentSnapshot> {
  open(source: string, hint?: DocumentHint): Promise<Snapshot>;
  execute(command: DocumentCommand): Promise<CommandResult<Snapshot>>;
  replaceSource(source: string): Promise<Snapshot>;
  snapshot(): Snapshot;
}
