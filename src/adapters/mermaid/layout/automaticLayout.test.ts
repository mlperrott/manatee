import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { MermaidDocumentAdapter } from "../MermaidDocumentAdapter";
import type {
  MermaidGroup,
  MermaidNode,
  MermaidRelationship,
  MermaidSemanticModel,
} from "../model";
import { computeMermaidScene, rerouteMermaidScene } from "./automaticLayout";
import { renderMermaidExportSvg, renderMermaidPreviewSvg } from "../render/svg";

const emptyStyle = { declarations: {} } as const;

function node(id: string, parentId?: string, label = id): MermaidNode {
  return {
    id,
    label,
    kind: "rectangle",
    parentId,
    classes: [],
    style: emptyStyle,
    technology: undefined,
    description: undefined,
  };
}

function group(id: string, parentId?: string): MermaidGroup {
  return {
    id,
    label: id,
    kind: "subgraph",
    parentId,
    direction: "LR",
    classes: [],
    style: emptyStyle,
  };
}

function relationship(
  id: string,
  source: string,
  target: string,
): MermaidRelationship {
  return {
    id,
    identity: { kind: "authored", id },
    source,
    target,
    kind: "arrow_point",
    label: "",
    technology: undefined,
    description: undefined,
    directionHint: undefined,
    classes: [],
    style: emptyStyle,
  };
}

function model(
  nodes: readonly MermaidNode[],
  groups: readonly MermaidGroup[] = [],
  relationships: readonly MermaidRelationship[] = [],
): MermaidSemanticModel {
  return {
    family: "flowchart",
    direction: "LR",
    nodes,
    groups,
    relationships,
    classDefinitions: {},
    diagnostics: [],
  };
}

describe("Mermaid automatic layout", () => {
  it("treats nested manual positions as content-local and carries them with a group", async () => {
    const semantic = model([node("child", "container")], [group("container")]);
    const at = async (x: number) =>
      computeMermaidScene({
        model: semantic,
        metadata: {
          elements: {
            groups: { container: { position: { x, y: 80 } } },
            nodes: { child: { position: { x: 12, y: 20 } } },
          },
        },
      });
    const first = await at(100);
    const moved = await at(170);
    expect(first.groups[0]).toMatchObject({ x: 100, y: 80 });
    expect(first.nodes[0]).toMatchObject({ x: 136, y: 152, manual: true });
    expect(moved.nodes[0]!.x - first.nodes[0]!.x).toBe(70);
  });

  it("keeps manual nodes fixed, moves automatic collisions, and expands containers", async () => {
    const semantic = model(
      [node("manual", "container"), node("automatic", "container")],
      [group("container")],
    );
    const scene = await computeMermaidScene({
      model: semantic,
      metadata: {
        elements: {
          nodes: { manual: { position: { x: 700, y: 20 } } },
        },
      },
    });
    const manual = scene.nodes.find(({ id }) => id === "manual")!;
    const automatic = scene.nodes.find(({ id }) => id === "automatic")!;
    const container = scene.groups[0]!;
    expect(manual.manual).toBe(true);
    expect(automatic.x).not.toBe(manual.x);
    expect(container.x + container.width).toBeGreaterThanOrEqual(
      manual.x + manual.width + container.padding,
    );
  });

  it("clears stale positions on reparent and ignores positions on reset", async () => {
    const before = model([node("A", "one")], [group("one"), group("two")]);
    const after = model([node("A", "two")], [group("one"), group("two")]);
    const metadata = {
      elements: { nodes: { A: { position: { x: 900, y: 900 } } } },
    };
    const reparented = await computeMermaidScene({
      model: after,
      metadata,
      options: { previousModel: before },
    });
    const reset = await computeMermaidScene({
      model: before,
      metadata,
      options: { reset: true },
    });
    expect(reparented.nodes[0]?.manual).toBe(false);
    expect(reset.nodes[0]?.manual).toBe(false);
    expect(reparented.nodes[0]?.x).toBeLessThan(900);
    expect(reset.nodes[0]?.y).toBeLessThan(900);
  });

  it("diagnoses unresolved manual overlap and applies style precedence", async () => {
    const semantic = model([node("A"), node("B")]);
    const scene = await computeMermaidScene({
      model: semantic,
      metadata: {
        rules: [
          {
            match: { attributes: { risk: { eq: "high" } } },
            style: { fill: "red" },
          },
        ],
        elements: {
          nodes: {
            A: {
              position: { x: 20, y: 20 },
              attributes: { risk: "high" },
              style: { fill: "blue" },
            },
            B: { position: { x: 20, y: 20 } },
          },
        },
      },
    });
    expect(scene.diagnostics.map(({ code }) => code)).toContain(
      "layout.overlap.unresolved",
    );
    expect(scene.nodes.find(({ id }) => id === "A")?.style.fill).toBe("blue");
  });

  it("routes node and group endpoints and reroutes moved geometry quickly", async () => {
    const semantic = model(
      [node("A", "container"), node("B")],
      [group("container")],
      [
        relationship("inside", "A", "B"),
        relationship("boundary", "container", "B"),
      ],
    );
    const scene = await computeMermaidScene({
      model: semantic,
      metadata: undefined,
    });
    expect(scene.relationships).toHaveLength(2);
    const moved = {
      ...scene,
      nodes: scene.nodes.map((item) =>
        item.id === "B" ? { ...item, y: item.y + 120 } : item,
      ),
    };
    const started = performance.now();
    const rerouted = rerouteMermaidScene(moved);
    expect(performance.now() - started).toBeLessThan(250);
    expect(rerouted.relationships[0]?.points).not.toEqual(
      scene.relationships[0]?.points,
    );
    for (const edge of rerouted.relationships) {
      for (let index = 1; index < edge.points.length; index += 1) {
        const previous = edge.points[index - 1]!;
        const current = edge.points[index]!;
        expect(current.x === previous.x || current.y === previous.y).toBe(true);
      }
    }
  });

  it.each([
    "flowchart-baseline.mmd",
    "swimlane-baseline.mmd",
    "c4-context-baseline.mmd",
    "c4-container-baseline.mmd",
  ])("lays out the %s fixture with finite geometry", async (name) => {
    const source = await readFile(
      resolve("src/adapters/mermaid/fixtures", name),
      "utf8",
    );
    const snapshot = await new MermaidDocumentAdapter().open(source);
    const scene = await computeMermaidScene({
      model: snapshot.semanticModel!,
      metadata: snapshot.presentationModel?.metadata,
    });
    expect(scene.nodes.length).toBeGreaterThan(0);
    expect(scene.relationships).toHaveLength(
      snapshot.semanticModel?.relationships.length ?? 0,
    );
    for (const item of [...scene.nodes, ...scene.groups]) {
      expect(
        [item.x, item.y, item.width, item.height].every(Number.isFinite),
      ).toBe(true);
      expect(item.width).toBeGreaterThan(0);
      expect(item.height).toBeGreaterThan(0);
    }
  });

  it("lays out a representative 100-node, 150-relationship model within two seconds", async () => {
    const nodes = Array.from({ length: 100 }, (_, index) => node(`n${index}`));
    const relationships = Array.from({ length: 150 }, (_, index) =>
      relationship(
        `r${index}`,
        `n${index % 100}`,
        `n${(index * 7 + 13) % 100}`,
      ),
    );
    const started = performance.now();
    const scene = await computeMermaidScene({
      model: model(nodes, [], relationships),
      metadata: undefined,
    });
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(scene.nodes).toHaveLength(100);
    expect(scene.relationships).toHaveLength(150);
  }, 5_000);
});

describe("Mermaid SVG rendering", () => {
  it("uses one output path for preview/export with computed styles and rich labels", async () => {
    const scene = await computeMermaidScene({
      model: model([node("A", undefined, "**Bold** and _italic_")]),
      metadata: { elements: { nodes: { A: { style: { fill: "#fee2e2" } } } } },
    });
    const options = { selectedElementId: "A", outdated: true } as const;
    const preview = renderMermaidPreviewSvg(scene, options);
    expect(renderMermaidExportSvg(scene, options)).toBe(preview);
    expect(preview).toContain('fill="#fee2e2"');
    expect(preview).toContain('font-weight="700"');
    expect(preview).toContain('font-style="italic"');
    expect(preview).toContain('class="node selected"');
    expect(preview).toContain('data-outdated="true"');
  });

  it("escapes labels and rejects resource-bearing paint values", async () => {
    const scene = await computeMermaidScene({
      model: model([node("A", undefined, '<script>alert("x")</script>')]),
      metadata: {
        elements: {
          nodes: { A: { style: { fill: "url(https://bad.example/x)" } } },
        },
      },
    });
    const svg = renderMermaidPreviewSvg(scene);
    expect(svg).not.toContain("<script>");
    expect(svg).not.toContain("bad.example");
    expect(svg).toContain("&lt;script&gt;");
  });
});
