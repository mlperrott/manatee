import { describe, expect, it } from "vitest";

import { UnsafeSourcePatchError } from "../source/patches";
import type { ParsedDocument } from "./types";
import {
  TransactionalDocumentEngine,
  type DocumentParser,
} from "./TransactionalDocumentEngine";

const parser: DocumentParser<string, string, string> = {
  async parse(source): Promise<ParsedDocument<string, string, string>> {
    if (source.includes("INVALID")) {
      return {
        valid: false,
        kind: "mermaid",
        diagnostics: [
          { code: "parse", message: "Invalid source", severity: "error" },
        ],
      };
    }
    return {
      valid: true,
      kind: "mermaid",
      semanticModel: `semantic:${source}`,
      presentationModel: `presentation:${source}`,
      view: `view:${source}`,
      diagnostics: [],
    };
  },
};

describe("TransactionalDocumentEngine", () => {
  it("keeps the last valid preview and recovers through undo and redo", async () => {
    const engine = new TransactionalDocumentEngine(parser);
    const opened = await engine.open("flowchart LR\nA-->B");
    expect(opened.dirty).toBe(false);
    expect(opened.commands.undo).toBe(false);

    const invalid = await engine.replaceSource("INVALID");
    expect(invalid).toMatchObject({
      valid: false,
      previewOutdated: true,
      view: "view:flowchart LR\nA-->B",
      semanticModel: "semantic:flowchart LR\nA-->B",
      dirty: true,
      commands: { visualEditing: false, imageExport: false, undo: true },
    });

    const undone = await engine.execute({ type: "undo" });
    expect(undone.snapshot).toMatchObject({ valid: true, dirty: false });
    expect(undone.snapshot.commands.redo).toBe(true);
    expect(undone.patches).toHaveLength(1);

    const redone = await engine.execute({ type: "redo" });
    expect(redone.snapshot).toMatchObject({
      valid: false,
      previewOutdated: true,
    });
    expect(redone.patches).toHaveLength(1);
  });

  it("records a patch set as one transaction and clears redo after a new edit", async () => {
    const engine = new TransactionalDocumentEngine(parser);
    await engine.open("abc");
    const changed = await engine.execute({
      type: "apply-patches",
      reason: "visual",
      patches: [
        { range: { start: 0, end: 1 }, replacement: "A" },
        { range: { start: 2, end: 3 }, replacement: "C" },
      ],
    });
    expect(changed.snapshot.source).toBe("AbC");
    expect((await engine.execute({ type: "undo" })).snapshot.source).toBe(
      "abc",
    );
    await engine.replaceSource("xyz");
    expect(engine.snapshot().commands.redo).toBe(false);
  });

  it("leaves the snapshot unchanged when a patch cannot be applied safely", async () => {
    const engine = new TransactionalDocumentEngine(parser);
    const before = await engine.open("abcd");
    await expect(
      engine.execute({
        type: "apply-patches",
        reason: "visual",
        patches: [
          { range: { start: 0, end: 2 }, replacement: "x" },
          { range: { start: 1, end: 3 }, replacement: "y" },
        ],
      }),
    ).rejects.toThrow("must not overlap");
    expect(engine.snapshot()).toBe(before);
  });

  it("rejects a visual patch when its candidate source does not parse", async () => {
    const engine = new TransactionalDocumentEngine(parser);
    const before = await engine.open("VALID");
    await expect(
      engine.execute({
        type: "apply-patches",
        reason: "visual",
        patches: [{ range: { start: 0, end: 5 }, replacement: "INVALID" }],
      }),
    ).rejects.toBeInstanceOf(UnsafeSourcePatchError);
    expect(engine.snapshot()).toBe(before);
  });
});
