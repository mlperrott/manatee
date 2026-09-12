export interface EditorUiState {
  sourceOpen: boolean;
  inspectorOpen: boolean;
  stageWidth: number;
}

export function initialEditorUiState(): EditorUiState {
  return {
    sourceOpen: false,
    inspectorOpen: true,
    stageWidth: 0,
  };
}

export function sourceToggleLabel(sourceOpen: boolean): string {
  return sourceOpen ? "Hide source" : "Show source";
}
