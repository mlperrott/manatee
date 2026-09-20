import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { c4Shapes } from "./authoring";
import { renderMermaidSvg } from "./render/svg";
import { MermaidDocument } from "./MermaidDocument";
import { changesMermaid } from "./editScope";
import { studioExamples, newDocumentSources } from "../app/studio/examples";
import { elementPath } from "../app/studio/metadataControls";

describe("Studio editing scope and visual authoring", () => {
  it("enforces the Mermaid restriction for commands, source replacement and history", async () => {
    const document = new MermaidDocument();
    const original =
      "---\ntitle: Keep me\n---\nflowchart LR\n%% authored comment\nA[First] --> B[Second]\n";
    await document.open(original);
    await document.execute({ type: "set-source-editing", allowed: false });
    await document.execute({
      type: "edit-metadata",
      edits: [
        {
          type: "set",
          path: ["elements", "nodes", "A", "style", "text"],
          value: { size: 20, italic: true, weight: 700, color: "#11223399" },
        },
      ],
    });
    expect(changesMermaid(original, document.snapshot().source)).toBe(false);
    await expect(
      document.execute({
        type: "edit-structure",
        edit: { action: "node", id: "A", label: "Changed", kind: "rectangle" },
      }),
    ).rejects.toThrow("Enable");
    await expect(
      document.replaceSource(original.replace("First", "Changed")),
    ).rejects.toThrow("Enable");
    await expect(
      document.replaceSource(original.replace("Keep me", "Changed")),
    ).rejects.toThrow("Enable");
    await document.execute({ type: "undo" });
    expect(document.snapshot().source).toBe(original);
    await document.execute({ type: "set-source-editing", allowed: true });
    await document.execute({
      type: "edit-structure",
      edit: { action: "node", id: "A", label: "Changed", kind: "rectangle" },
    });
    expect(document.snapshot().source).toContain("%% authored comment");
    await document.execute({ type: "set-source-editing", allowed: false });
    await expect(document.execute({ type: "undo" })).rejects.toThrow("Enable");
    await document.execute({ type: "set-source-editing", allowed: true });
    await document.execute({ type: "undo" });
    expect(document.snapshot().source).toBe(original);
    document.dispose();
  });
  it("rejects malformed presentation edits without modifying the source", async () => {
    const document = new MermaidDocument();
    await document.open("flowchart LR\nA-->B");
    const before = document.snapshot().source;
    await expect(
      document.execute({
        type: "edit-metadata",
        edits: [
          { type: "set", path: ["layout", "spacing", "node"], value: -1 },
        ],
      }),
    ).rejects.toThrow("Invalid");
    expect(document.snapshot().source).toBe(before);
    document.dispose();
  });
  for (const example of studioExamples)
    it(`opens and visually edits ${example.title}`, async () => {
      const document = new MermaidDocument();
      const before = await document.open(example.source);
      expect(before.valid, JSON.stringify(before.diagnostics)).toBe(true);
      const node = before.model!.nodes[0]!;
      await document.execute({
        type: "edit-structure",
        edit: { action: "node", ...node, label: "Updated label" },
      });
      const after = document.snapshot();
      expect(after.valid).toBe(true);
      expect(
        after.model!.nodes.find((item) => item.id === node.id)?.label,
      ).toBe("Updated label");
      expect(after.model!.nodes).toHaveLength(before.model!.nodes.length);
      expect(after.model!.groups).toHaveLength(before.model!.groups.length);
      for (const previous of before.model!.nodes) {
        const next = after.model!.nodes.find(
          (item) => item.id === previous.id,
        )!;
        expect({
          kind: next.kind,
          parentId: next.parentId,
          technology: next.technology,
          description: next.description,
        }).toEqual({
          kind: previous.kind,
          parentId: previous.parentId,
          technology: previous.technology,
          description: previous.description,
        });
      }
      expect(after.model!.relationships).toHaveLength(
        before.model!.relationships.length,
      );
      expect(after.metadata).toEqual(before.metadata);
      await document.execute({ type: "undo" });
      expect(document.snapshot().source).toBe(example.source);
      document.dispose();
    });
  for (const [family, source] of Object.entries(newDocumentSources))
    it(`creates a new ${family} and authors its first elements`, async () => {
      const document = new MermaidDocument();
      expect((await document.open(source)).valid).toBe(true);
      const flow = family === "flowchart" || family === "swimlane";
      await document.execute({
        type: "edit-structure",
        edit: {
          action: "node",
          id: "first",
          label: "First",
          kind: flow ? "rectangle" : "system",
        },
      });
      await document.execute({
        type: "edit-structure",
        edit: {
          action: "node",
          id: "second",
          label: "Second",
          kind: flow ? "diamond" : "system",
        },
      });
      await document.execute({
        type: "edit-structure",
        edit: {
          action: "relationship",
          id: "connect",
          source: "first",
          target: "second",
          label: "Uses",
          kind: flow ? "arrow_point" : "rel",
        },
      });
      expect(document.snapshot().model!.nodes).toHaveLength(2);
      expect(document.snapshot().model!.relationships).toHaveLength(1);
      document.dispose();
    });
  it("rejects group cycles and preserves children when deleting a group", async () => {
    const document = new MermaidDocument();
    await document.open(
      "flowchart TD\nsubgraph outer[Outer]\nsubgraph inner[Inner]\nA[Task]\nend\nend\n",
    );
    await expect(
      document.execute({
        type: "edit-structure",
        edit: {
          action: "group",
          id: "outer",
          label: "Outer",
          parentId: "inner",
        },
      }),
    ).rejects.toThrow("ancestors");
    await document.execute({
      type: "edit-structure",
      edit: { action: "delete", id: "inner" },
    });
    expect(document.snapshot().model!.nodes[0]?.parentId).toBe("outer");
    document.dispose();
  });
  it("removes deleted timer attachments atomically and keeps unrelated settings", async () => {
    const document = new MermaidDocument();
    await document.open(
      studioExamples.find((example) => example.id === "process")!.source,
    );
    await document.execute({
      type: "edit-structure",
      edit: { action: "delete", id: "review" },
    });
    expect(document.snapshot().commands.visualEditing).toBe(true);
    expect(
      document
        .snapshot()
        .model!.relationships.every(
          (edge) => edge.source !== "review" && edge.target !== "review",
        ),
    ).toBe(true);
    expect(JSON.stringify(document.snapshot().metadata)).not.toContain(
      '"boundary-timer"',
    );
    await document.execute({ type: "undo" });
    expect(JSON.stringify(document.snapshot().metadata)).toContain(
      '"boundary-timer"',
    );
    document.dispose();
  });
  it("preserves shapes, styled connections and classes through a structural edit", async () => {
    const document = new MermaidDocument();
    const before = await document.open(
      await readFile("src/mermaid/fixtures/flowchart-baseline.mmd", "utf8"),
    );
    await document.execute({
      type: "edit-structure",
      edit: { action: "direction", direction: "LR" },
    });
    const after = document.snapshot();
    expect(
      after
        .model!.nodes.map(({ id, kind, classes }) => ({ id, kind, classes }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    ).toEqual(
      before
        .model!.nodes.map(({ id, kind, classes }) => ({ id, kind, classes }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    );
    expect(
      after.scene!.relationships.map(({ kind, label, style }) => ({
        kind,
        label,
        style,
      })),
    ).toEqual(
      before.scene!.relationships.map(({ kind, label, style }) => ({
        kind,
        label,
        style,
      })),
    );
    expect(after.model!.classDefinitions).toEqual(
      before.model!.classDefinitions,
    );
    document.dispose();
  });
  it("edits relationship typography and migrates endpoint-based styling", async () => {
    const document = new MermaidDocument();
    const snapshot = await document.open("flowchart LR\nA-->B\nC[Third]\n");
    const edge = snapshot.model!.relationships[0]!;
    const target = elementPath(snapshot, edge.id)!;
    await document.execute({
      type: "edit-metadata",
      edits: [
        ...target.initial,
        {
          type: "set",
          path: [...target.path, "text"],
          value: { size: 24, color: "#112233", italic: true },
        },
      ],
    });
    await document.execute({
      type: "edit-structure",
      edit: { action: "relationship", ...edge, target: "C" },
    });
    expect(document.snapshot().scene!.relationships[0]!.style.text.size).toBe(
      24,
    );
    document.dispose();
  });
  it("preserves every supported C4 element and relationship type", async () => {
    const source =
      "C4Container\n" +
      Object.entries(c4Shapes)
        .map(
          ([kind, fn], index) =>
            `${fn}(item${index}, "${kind}", "${fn.startsWith("Container") ? 'Tech", "Description' : "Description"}")`,
        )
        .join("\n") +
      '\nBiRel(item0,item1,"Both")\nRel_Back(item1,item2,"Back")\n';
    const document = new MermaidDocument();
    const before = await document.open(source);
    expect(before.valid, JSON.stringify(before.diagnostics)).toBe(true);
    await document.execute({
      type: "edit-structure",
      edit: { action: "node", ...before.model!.nodes[0]!, label: "Renamed" },
    });
    expect(
      document
        .snapshot()
        .model!.nodes.map(({ kind, technology, description }) => ({
          kind,
          technology,
          description,
        })),
    ).toEqual(
      before.model!.nodes.map(({ kind, technology, description }) => ({
        kind,
        technology,
        description,
      })),
    );
    expect(
      document.snapshot().model!.relationships.map(({ kind }) => kind),
    ).toEqual(["birel", "rel_b"]);
    const svg = renderMermaidSvg(document.snapshot().scene!);
    expect(svg.match(/marker-start=/g)).toHaveLength(2);
    expect(svg.match(/marker-end=/g)).toHaveLength(1);
    document.dispose();
  });
  it("names an existing connection while retaining its styling", async () => {
    const document = new MermaidDocument();
    let snapshot = await document.open("flowchart TD\nA-->B\n");
    const edge = snapshot.model!.relationships[0]!;
    await document.execute({
      type: "set-appearance",
      elementId: edge.id,
      appearance: { stroke: "#123456" },
    });
    await document.execute({
      type: "edit-structure",
      edit: { action: "relationship", ...edge, authoredId: "named" },
    });
    snapshot = document.snapshot();
    expect(snapshot.model!.relationships[0]!.identity).toEqual({
      kind: "authored",
      id: "named",
    });
    expect(snapshot.scene!.relationships[0]!.style.color).toBe("#123456");
    document.dispose();
  });
  it("resets a moved node's old parent-relative position across save and reopen", async () => {
    const document = new MermaidDocument();
    await document.open(
      "flowchart TD\nsubgraph one[One]\nA[Task]\nend\nsubgraph two[Two]\nB[Other]\nend\n",
    );
    await document.execute({ type: "move", elementId: "A", dx: 30, dy: 20 });
    await document.execute({
      type: "edit-structure",
      edit: {
        action: "node",
        id: "A",
        label: "Task",
        kind: "square",
        parentId: "two",
      },
    });
    const before = document.snapshot();
    const reopened = new MermaidDocument();
    const after = await reopened.open(before.source);
    expect(after.scene!.nodes.find(({ id }) => id === "A")).toMatchObject({
      x: before.scene!.nodes.find(({ id }) => id === "A")!.x,
      y: before.scene!.nodes.find(({ id }) => id === "A")!.y,
      manual: false,
    });
    document.dispose();
    reopened.dispose();
  });

  it("round-trips quoted labels from the visual editor", async () => {
    for (const source of [
      "flowchart TD\nA[Task]\n",
      'C4Context\nSystem(A,"Task")\n',
    ]) {
      const document = new MermaidDocument();
      const before = await document.open(source);
      await document.execute({
        type: "edit-structure",
        edit: {
          action: "node",
          ...before.model!.nodes[0]!,
          label: 'Say "Yes" & continue',
        },
      });
      expect(document.snapshot().model!.nodes[0]!.label).toBe(
        'Say "Yes" & continue',
      );
      document.dispose();
    }
  });
  it("preserves styling statements authored on the same line as structure", async () => {
    const document = new MermaidDocument();
    const before = await document.open(
      'flowchart LR; A["A; with semicolon"]:::critical --> B[Second]; style B fill:#abcdef\nclassDef critical fill:#ffaaaa,stroke:#112233\nlinkStyle 0 stroke:#ff0000\n',
    );
    expect(before.valid, JSON.stringify(before.diagnostics)).toBe(true);
    await document.execute({
      type: "edit-structure",
      edit: { action: "direction", direction: "TB" },
    });
    const after = document.snapshot();
    expect(after.model!.relationships).toHaveLength(1);
    expect(after.scene!.nodes.map(({ id, style }) => ({ id, style }))).toEqual(
      before.scene!.nodes.map(({ id, style }) => ({ id, style })),
    );
    expect(after.scene!.relationships[0]!.style).toEqual(
      before.scene!.relationships[0]!.style,
    );
    for (const direction of ["LR", "TB", "LR"] as const) {
      await document.execute({
        type: "edit-structure",
        edit: { action: "direction", direction },
      });
      expect(document.snapshot().source.match(/linkStyle/g)).toHaveLength(1);
      expect(document.snapshot().scene!.relationships[0]!.style).toEqual(
        before.scene!.relationships[0]!.style,
      );
    }
    document.dispose();
  });

  it("moves C4 relationship styling with edited endpoints and removes deleted element styling", async () => {
    const document = new MermaidDocument();
    const before = await document.open(
      'C4Context\nSystem(a,"First")\nSystem(b,"Second")\nSystem(c,"Third")\nRel(a,b,"Uses")\nUpdateRelStyle(a,b,$lineColor="#ff0000")\nUpdateElementStyle(b,$bgColor="#abcdef")\n',
    );
    expect(before.valid, JSON.stringify(before.diagnostics)).toBe(true);
    await document.execute({
      type: "edit-structure",
      edit: {
        action: "relationship",
        ...before.model!.relationships[0]!,
        target: "c",
      },
    });
    expect(document.snapshot().source).toContain(
      'UpdateRelStyle(a, c,$lineColor="#ff0000")',
    );
    expect(document.snapshot().scene!.relationships[0]!.style).toEqual(
      before.scene!.relationships[0]!.style,
    );
    await document.execute({
      type: "edit-structure",
      edit: { action: "delete", id: "b" },
    });
    expect(document.snapshot().source).not.toContain("UpdateElementStyle(b");
    expect(document.snapshot().valid).toBe(true);
    document.dispose();
  });
});
