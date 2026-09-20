import type { SourcePatch } from "./types";
import type { MetadataEdit, MetadataValue } from "../metadata/types";

export interface PresentationAppearance {
  readonly fill?: string;
  readonly stroke?: string;
}

export type NotationChoice =
  | "task"
  | "start-event"
  | "end-event"
  | "exclusive-gateway"
  | "parallel-gateway"
  | "timer-event"
  | "boundary-timer"
  | "collapsed-subprocess"
  | "pool"
  | "lane"
  | "sequence-flow"
  | "message-flow";

export interface BoundaryTimerSettings {
  readonly hostId: string;
  readonly attachmentRelationshipId: string;
  readonly anchor?: {
    readonly side: "top" | "right" | "bottom" | "left";
    readonly offset: number;
  };
}

export type PresentationCommand =
  | { readonly type: "edit-metadata"; readonly edits: readonly MetadataEdit[] }
  | {
      readonly type: "move";
      readonly elementId: string;
      readonly dx: number;
      readonly dy: number;
    }
  | {
      readonly type: "set-appearance";
      readonly elementId: string;
      readonly appearance: PresentationAppearance;
    }
  | {
      readonly type: "set-notation";
      readonly elementId: string;
      readonly notation: NotationChoice | undefined;
      readonly boundaryTimer?: BoundaryTimerSettings;
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
  | { readonly type: "set-source-editing"; readonly allowed: boolean }
  | {
      readonly type: "edit-structure";
      readonly edit: import("../../mermaid/authoring").StructureEdit;
    }
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

export interface CommandResult<Snapshot> {
  readonly snapshot: Snapshot;
  readonly patches: readonly SourcePatch[];
}
