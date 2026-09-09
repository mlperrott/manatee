import type { DocumentHint, DocumentSnapshot, SourcePatch } from "./types";

export interface DocumentCommand {
  readonly type: string;
  readonly payload?: unknown;
}

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
