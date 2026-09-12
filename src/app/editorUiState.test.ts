import { describe, expect, it } from "vitest";

import { initialEditorUiState, sourceToggleLabel } from "./editorUiState";

describe("editor UI state", () => {
  it("opens as a canvas-first Studio workspace", () => {
    expect(initialEditorUiState()).toEqual({
      sourceOpen: false,
      inspectorOpen: true,
      stageWidth: 0,
    });
  });

  it("describes the source-panel action", () => {
    expect(sourceToggleLabel(false)).toBe("Show source");
    expect(sourceToggleLabel(true)).toBe("Hide source");
  });
});
