export type AppStatus =
  | { readonly kind: "ready" }
  | { readonly kind: "loading"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

export interface EditorUiState {
  sourceOpen: boolean;
  inspectorOpen: boolean;
  stageWidth: number;
  status: AppStatus;
}

export function initialEditorUiState(): EditorUiState {
  return {
    sourceOpen: false,
    inspectorOpen: true,
    stageWidth: 0,
    status: { kind: "ready" },
  };
}

export function sourceToggleLabel(sourceOpen: boolean): string {
  return sourceOpen ? "Hide source" : "Show source";
}
