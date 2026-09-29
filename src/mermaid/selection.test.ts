import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { MermaidDocument } from "./MermaidDocument";
import { changesMermaid } from "./editScope";
import { selectionMovements, selectionRoots } from "./layout/selection";
import { renderMermaidSvg } from "./render/svg";
import type { Arrangement } from "../core/document/commands";
import { MermaidLayout } from "./layout/MermaidLayout";

const source = `---
title: Keep this title
manatee:
  version: 1
  elements:
    nodes:
      A: { position: { x: 80, y: 100 }, style: { fill: '#aabbcc' } }
      B: { position: { x: 340, y: 250 } }
      C: { position: { x: 760, y: 480 } }
      D: { position: { x: 1000, y: 80 } }
---
flowchart LR
%% Preserve this authored comment
A[One] --> B[A wider label]
B --> C[Three]
D[Unaffected]
`;

describe("multi-selection presentation commands", () => {
  for (const fixture of [
    "flowchart-baseline",
    "swimlane-baseline",
    "c4-context-baseline",
    "c4-container-baseline",
  ]) {
    it(`moves a batch in ${fixture} without running automatic layout`, async () => {
      const layout = new MermaidLayout(false);
      const document = new MermaidDocument(layout);
      const original = await readFile(
        `src/mermaid/fixtures/${fixture}.mmd`,
        "utf8",
      );
      const before = await document.open(original);
      const layoutCall = vi.spyOn(layout, "layout");
      const ids = [...before.scene!.groups, ...before.scene!.nodes].map(
        (item) => item.id,
      );
      await document.execute({
        type: "move-elements",
        elementIds: ids,
        dx: 40,
        dy: 60,
      });
      expect(layoutCall).not.toHaveBeenCalled();
      expect(changesMermaid(original, document.snapshot().source)).toBe(false);
      for (const item of [...before.scene!.groups, ...before.scene!.nodes]) {
        const after = [
          ...document.snapshot().scene!.groups,
          ...document.snapshot().scene!.nodes,
        ].find((candidate) => candidate.id === item.id)!;
        expect(after.x).toBeCloseTo(item.x + 40);
        expect(after.y).toBeCloseTo(item.y + 60);
      }
      document.dispose();
    });
  }

  it("carries boundary timers with their host once and keeps their anchor", async () => {
    const document = new MermaidDocument();
    await document.open(
      await readFile("src/mermaid/fixtures/process-notation.mmd", "utf8"),
    );
    const before = document.snapshot();
    const timer = before.scene!.nodes.find((item) => item.id === "timeout")!;
    await expect(
      document.execute({
        type: "arrange-elements",
        elementIds: ["timeout", "escalate"],
        arrangement: "top",
      }),
    ).rejects.toThrow("boundary timer");
    expect(document.snapshot().source).toBe(before.source);
    await document.execute({
      type: "move-elements",
      elementIds: ["review", "timeout", "escalate"],
      dx: 30,
      dy: 40,
    });
    const after = document
      .snapshot()
      .scene!.nodes.find((item) => item.id === "timeout")!;
    expect(after.x - timer.x).toBe(30);
    expect(after.y - timer.y).toBe(40);
    expect(document.snapshot().source).toContain(
      "anchor: { side: bottom, offset: 0.8 }",
    );
    document.dispose();
  });
  for (const arrangement of [
    "left",
    "center",
    "right",
    "top",
    "middle",
    "bottom",
    "horizontal",
    "vertical",
  ] as const) {
    it(`applies ${arrangement} atomically in presentation-only mode`, async () => {
      const document = new MermaidDocument();
      const before = await document.open(source);
      await document.execute({ type: "set-source-editing", allowed: false });
      await document.execute({
        type: "select",
        elementId: "C",
        elementIds: ["A", "B", "C"],
      });
      const after = (
        await document.execute({
          type: "arrange-elements",
          elementIds: ["A", "B", "C"],
          arrangement,
        })
      ).snapshot;
      const nodes = after.scene!.nodes.filter((node) => node.id !== "D");
      const horizontal = ["left", "center", "right", "horizontal"].includes(
        arrangement,
      );
      const axis = horizontal ? "x" : "y";
      const extent = horizontal ? "width" : "height";
      if (arrangement === "horizontal" || arrangement === "vertical") {
        expect(
          nodes[1]![axis] - nodes[0]![axis] - nodes[0]![extent],
        ).toBeCloseTo(nodes[2]![axis] - nodes[1]![axis] - nodes[1]![extent]);
        for (const id of ["A", "C"])
          expect(nodes.find((node) => node.id === id)![axis]).toBe(
            before.scene!.nodes.find((node) => node.id === id)![axis],
          );
      } else {
        const fraction =
          arrangement === "center" || arrangement === "middle"
            ? 0.5
            : arrangement === "right" || arrangement === "bottom"
              ? 1
              : 0;
        const values = nodes.map(
          (node) => node[axis] + node[extent] * fraction,
        );
        expect(values[0]).toBeCloseTo(values[1]!);
        expect(values[1]).toBeCloseTo(values[2]!);
      }
      expect(after.scene!.nodes.find((node) => node.id === "D")).toEqual(
        before.scene!.nodes.find((node) => node.id === "D"),
      );
      expect(changesMermaid(source, after.source)).toBe(false);
      expect(after.source).toContain("#aabbcc");
      expect(after.selectedElementIds).toEqual(["A", "B", "C"]);
      const reopened = new MermaidDocument();
      const reloaded = await reopened.open(after.source);
      for (const node of nodes) {
        const saved = reloaded.scene!.nodes.find(
          (item) => item.id === node.id,
        )!;
        expect(saved.x).toBeCloseTo(node.x);
        expect(saved.y).toBeCloseTo(node.y);
      }
      await document.execute({ type: "undo" });
      expect(document.snapshot().source).toBe(source);
      expect(document.snapshot().commands.undo).toBe(false);
      await document.execute({ type: "redo" });
      expect(document.snapshot().source).toBe(after.source);
      reopened.dispose();
      document.dispose();
    });
  }

  it("moves nested selected containers once and preserves local child positions", async () => {
    const document = new MermaidDocument();
    await document.open(
      "flowchart LR\nsubgraph outer\nsubgraph inner\nA[A] --> B[B]\nend\nend\nC[C]",
    );
    const before = document.snapshot();
    const scene = before.scene!;
    expect(
      selectionRoots(scene, ["outer", "inner", "A", "B", "C"]).map(
        (item) => item.id,
      ),
    ).toEqual(["outer", "C"]);
    await document.execute({
      type: "move-elements",
      elementIds: ["outer", "inner", "A", "B", "C"],
      dx: 55,
      dy: 75,
    });
    const after = document.snapshot();
    for (const item of [...scene.nodes, ...scene.groups]) {
      const moved = [...after.scene!.nodes, ...after.scene!.groups].find(
        (candidate) => candidate.id === item.id,
      )!;
      expect(moved.x - item.x).toBe(55);
      expect(moved.y - item.y).toBe(75);
    }
    expect(after.source).not.toMatch(/inner:\s*\n\s*position/);
    await document.execute({ type: "undo" });
    expect(document.snapshot().source).toBe(before.source);
    document.dispose();
  });

  it("aligns nodes across nested coordinate spaces and rejects impossible alignment atomically", async () => {
    const document = new MermaidDocument();
    await document.open("flowchart LR\nsubgraph G\nA[A]\nend\nB[B]");
    const before = document.snapshot();
    await document.execute({
      type: "arrange-elements",
      elementIds: ["A", "B"],
      arrangement: "right",
    });
    const [a, b] = document.snapshot().scene!.nodes;
    expect(a!.x + a!.width).toBeCloseTo(b!.x + b!.width);
    await document.execute({ type: "undo" });
    const scene = document.snapshot().scene!;
    const altered = {
      ...scene,
      nodes: scene.nodes.map((node) =>
        node.id === "B" ? { ...node, x: 0 } : node,
      ),
    };
    expect(() => selectionMovements(altered, ["A", "B"], "left")).toThrow(
      "outside its container",
    );
    expect(document.snapshot().source).toBe(before.source);
    document.dispose();
  });

  it("translates a manual route only when both endpoints move together", async () => {
    const document = new MermaidDocument();
    await document.open(source);
    const relationship = document.snapshot().scene!.relationships[0]!;
    await document.execute({
      type: "set-route",
      elementId: relationship.id,
      waypoints: [
        { x: 260, y: 120 },
        { x: 260, y: 260 },
      ],
    });
    const before = document.snapshot().scene!.relationships[0]!;
    await document.execute({
      type: "move-elements",
      elementIds: ["A", "B"],
      dx: 50,
      dy: 70,
    });
    const moved = document.snapshot().scene!.relationships[0]!;
    expect(moved.manualWaypoints).toEqual(
      before.manualWaypoints.map((point) => ({
        x: point.x + 50,
        y: point.y + 70,
      })),
    );
    await document.execute({
      type: "arrange-elements",
      elementIds: ["A", "B"],
      arrangement: "top",
    });
    expect(
      document.snapshot().scene!.relationships[0]!.manualWaypoints,
    ).toEqual(moved.manualWaypoints);
    const reopened = new MermaidDocument();
    expect(
      (await reopened.open(document.snapshot().source)).scene!.relationships[0]!
        .manualWaypoints,
    ).toEqual(moved.manualWaypoints);
    reopened.dispose();
    document.dispose();
  });

  it("clamps collective movement together, rejects invalid batches, and reconciles selection", async () => {
    const document = new MermaidDocument();
    const before = await document.open(source);
    for (const arrangement of ["horizontal", "vertical"] as Arrangement[]) {
      await expect(
        document.execute({
          type: "arrange-elements",
          elementIds: ["A", "B"],
          arrangement,
        }),
      ).rejects.toThrow("three");
    }
    await expect(
      document.execute({
        type: "move-elements",
        elementIds: ["A", "missing"],
        dx: 20,
        dy: 20,
      }),
    ).rejects.toThrow();
    await expect(
      document.execute({
        type: "move-elements",
        elementIds: ["A", "B"],
        dx: NaN,
        dy: 20,
      }),
    ).rejects.toThrow("finite");
    expect(document.snapshot().source).toBe(source);
    await document.execute({
      type: "move-elements",
      elementIds: ["A", "B"],
      dx: -1000,
      dy: 0,
    });
    const nodes = document.snapshot().scene!.nodes;
    expect(nodes[0]!.x).toBe(0);
    expect(nodes[1]!.x - nodes[0]!.x).toBe(
      before.scene!.nodes[1]!.x - before.scene!.nodes[0]!.x,
    );
    await document.execute({
      type: "select",
      elementId: "A",
      elementIds: ["A", "B", "C"],
    });
    await document.execute({
      type: "replace-source",
      source: "flowchart LR\nA[A]\nC[C]",
    });
    expect(document.snapshot().selectedElementIds).toEqual(["A", "C"]);
    await document.execute({
      type: "replace-source",
      source: "flowchart LR\nC[C]",
    });
    expect(document.snapshot().selectedElementId).toBe("C");
    expect(document.snapshot().selectedElementIds).toEqual(["C"]);
    await document.execute({
      type: "replace-source",
      source: "flowchart LR\nA[A]\nC[C]",
    });
    const svg = renderMermaidSvg(document.snapshot().scene!, {
      interactive: true,
      selectedElementIds: ["A", "C"],
    });
    expect(svg.match(/class="node selected"/g)).toHaveLength(2);
    expect(renderMermaidSvg(document.snapshot().scene!)).not.toContain(
      'class="node selected"',
    );
    document.dispose();
  });
});
