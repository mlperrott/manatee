import type { DocumentHint, DocumentSnapshot, SourcePatch } from "./types";
import type { MetadataValue } from "../metadata/types";

export type SourceTransactionReason = "visual" | "cleanup" | "reset-layout";

export interface DiagramPoint {
  readonly x: number;
  readonly y: number;
}

export interface DiagramBounds extends DiagramPoint {
  readonly width: number;
  readonly height: number;
}

export interface PresentationAppearance {
  readonly fill?: string;
  readonly stroke?: string;
}

export type PresentationCommand =
  | {
      readonly type: "move";
      readonly elementId: string;
      readonly dx: number;
      readonly dy: number;
    }
  | {
      readonly type: "resize";
      readonly elementId: string;
      readonly bounds: DiagramBounds;
    }
  | {
      readonly type: "route";
      readonly elementId: string;
      readonly waypoints: readonly DiagramPoint[];
    }
  | {
      readonly type: "set-appearance";
      readonly elementId: string;
      readonly appearance: PresentationAppearance;
    }
  | {
      readonly type: "set-attribute";
      readonly elementId: string;
      readonly name: string;
      readonly value: Extract<MetadataValue, string | number | boolean>;
    }
  | {
      readonly type: "create-styling-rule";
      readonly attribute: string;
      readonly value: Extract<MetadataValue, string | number | boolean>;
      readonly appearance: PresentationAppearance;
    }
  | {
      readonly type: "set-spacing";
      readonly spacing: "node" | "layer";
      readonly value: number;
    }
  | {
      readonly type: "use-automatic-position";
      readonly elementId: string;
    }
  | { readonly type: "reset-layout" }
  | { readonly type: "cleanup-unmatched" };

export type PresentationCommandType = PresentationCommand["type"];

export class CommandUnavailableError extends Error {
  constructor(
    readonly commandType: PresentationCommandType,
    message: string,
  ) {
    super(message);
    this.name = "CommandUnavailableError";
  }
}

export type DocumentCommand =
  | {
      readonly type: "replace-source";
      readonly source: string;
    }
  | {
      readonly type: "select";
      readonly elementId: string | undefined;
    }
  | { readonly type: "undo" }
  | { readonly type: "redo" }
  | PresentationCommand;

export type TransactionCommand =
  | Exclude<DocumentCommand, PresentationCommand>
  | {
      readonly type: "apply-patches";
      readonly patches: readonly SourcePatch[];
      readonly reason: SourceTransactionReason;
    };

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

export interface TransactionEngine<Snapshot extends DocumentSnapshot> {
  open(source: string, hint?: DocumentHint): Promise<Snapshot>;
  execute(command: TransactionCommand): Promise<CommandResult<Snapshot>>;
  replaceSource(source: string): Promise<Snapshot>;
  snapshot(): Snapshot;
}
