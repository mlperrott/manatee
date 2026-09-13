export interface SourceRange {
  readonly start: number;
  readonly end: number;
}

export type DiagnosticSeverity = "info" | "warning" | "error";

export interface DocumentDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly severity: DiagnosticSeverity;
  readonly range?: SourceRange;
  readonly path?: string;
}

export interface CommandAvailability {
  readonly visualEditing: boolean;
  readonly imageExport: boolean;
  readonly undo: boolean;
  readonly redo: boolean;
  readonly presentation: Readonly<
    Record<
      import("./commands").PresentationCommandType,
      PresentationCommandAvailability
    >
  >;
}

export type PresentationCommandAvailability =
  | { readonly state: "available" }
  | { readonly state: "disabled"; readonly reason: string }
  | { readonly state: "inapplicable" };

export interface SourcePatch {
  readonly range: SourceRange;
  readonly replacement: string;
}
