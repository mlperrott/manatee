export type DocumentKind = "mermaid" | "bpmn";

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

export interface DocumentHint {
  readonly filename?: string;
  readonly kind?: DocumentKind;
}

export interface CommandAvailability {
  readonly visualEditing: boolean;
  readonly imageExport: boolean;
  readonly undo: boolean;
  readonly redo: boolean;
}

export interface DocumentSnapshot<
  SemanticModel = unknown,
  PresentationModel = unknown,
  View = unknown,
> {
  readonly kind: DocumentKind;
  readonly source: string;
  readonly semanticModel: SemanticModel;
  readonly presentationModel: PresentationModel;
  readonly view: View;
  readonly diagnostics: readonly DocumentDiagnostic[];
  readonly selectedElementId?: string;
  readonly valid: boolean;
  readonly previewOutdated: boolean;
  readonly dirty: boolean;
  readonly commands: CommandAvailability;
}

export interface SourcePatch {
  readonly range: SourceRange;
  readonly replacement: string;
}
