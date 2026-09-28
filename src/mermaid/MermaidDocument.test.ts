import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { CommandUnavailableError } from "../core/document/commands";
import { MermaidDocument } from "./MermaidDocument";
import { MermaidLayout } from "./layout/MermaidLayout";
import { renderMermaidSvg } from "./render/svg";

async function fixture(name: string): Promise<string> {
  return readFile(resolve("src/mermaid/fixtures", name), "utf8");
}

describe("MermaidDocument baseline", () => {
  it("pins the Mermaid runtime contract", async () => {
    const packageManifest = JSON.parse(
      await readFile(resolve("node_modules/mermaid/package.json"), "utf8"),
    ) as { version?: string };
    expect(packageManifest.version).toBe("11.17.2");
  });

  it("normalizes classic flowchart syntax, nesting, identities, and styles", async () => {
    const source = await fixture("flowchart-baseline.mmd");
    const snapshot = await new MermaidDocument().open(source);
    expect(snapshot).toMatchObject({
      source,
      valid: true,
      dirty: false,
      model: { family: "flowchart", direction: "RL" },
      metadata: { version: 1, mystery: "preserved" },
    });
    const model = snapshot.model;
    expect(model?.nodes).toHaveLength(14);
    expect(model?.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "outer",
          parentId: undefined,
          direction: "TB",
        }),
        expect.objectContaining({ id: "inner", parentId: "outer" }),
      ]),
    );
    expect(model?.nodes.find(({ id }) => id === "A")).toMatchObject({
      parentId: "inner",
      classes: ["critical"],
    });
    expect(
      model?.relationships.find(({ id }) => id === "e1")?.identity,
    ).toEqual({
      kind: "authored",
      id: "e1",
    });
    expect(model?.classDefinitions.critical?.style.declarations).toMatchObject({
      fill: "#fee2e2",
      stroke: "#dc2626",
      "stroke-width": "2px",
    });
  });

  it("persists and renders common process notation without changing Mermaid semantics", async () => {
    const source = `---
manatee:
  version: 1
  elements:
    nodes:
      start: { notation: { type: start-event } }
      decide: { notation: { type: exclusive-gateway } }
      work: { notation: { type: collapsed-subprocess } }
    relationships:
      byEndpoints:
        - match: { source: decide, target: work, kind: arrow_point }
          notation: { type: message-flow }
---
flowchart LR
  start([Start]) --> decide{Ready?}
  decide --> work[Do work]
`;
    const document = new MermaidDocument();
    const opened = await document.open(source);
    expect(opened.model?.nodes.map(({ id }) => id)).toEqual([
      "start",
      "decide",
      "work",
    ]);
    expect(opened.scene?.nodes.map(({ notation }) => notation)).toEqual([
      "start-event",
      "exclusive-gateway",
      "collapsed-subprocess",
    ]);
    const svg = renderMermaidSvg(opened.scene!);
    expect(svg).toContain('data-notation="start-event"');
    expect(svg).toContain('data-notation="exclusive-gateway"');
    expect(svg).toContain('data-notation="message-flow"');

    const changed = await document.execute({
      type: "set-notation",
      elementId: "work",
      notation: "task",
    });
    expect(changed.snapshot.source).toContain("type: task");
    expect(changed.snapshot.source).toContain("flowchart LR");
    expect(changed.snapshot.scene?.nodes.at(-1)?.notation).toBe("task");
    document.dispose();
  });

  it("renders the complete process notation fixture and attaches interrupting timers", async () => {
    const source = await fixture("process-notation.mmd");
    const opened = await new MermaidDocument().open(source);
    expect(opened.valid).toBe(true);
    const scene = opened.scene;
    expect(scene?.nodes.map(({ notation }) => notation)).toEqual(
      expect.arrayContaining([
        "start-event",
        "end-event",
        "task",
        "exclusive-gateway",
        "parallel-gateway",
        "timer-event",
        "boundary-timer",
        "collapsed-subprocess",
      ]),
    );
    expect(scene?.groups.map(({ notation }) => notation)).toEqual(
      expect.arrayContaining(["pool", "lane"]),
    );
    expect(scene?.groups.find(({ id }) => id === "operations")).toMatchObject({
      label: "Operations",
      notation: "lane",
      parentId: "company",
    });
    expect(scene?.relationships.some(({ id }) => id === "timeoutLink")).toBe(
      false,
    );
    expect(scene?.relationships.map(({ notation }) => notation)).toContain(
      "message-flow",
    );
    const timeout = scene?.nodes.find(({ id }) => id === "timeout");
    const review = scene?.nodes.find(({ id }) => id === "review");
    expect(timeout?.x).toBe(
      review!.x + review!.width * 0.8 - timeout!.width / 2,
    );
    expect(timeout?.y).toBe(review!.y + review!.height - timeout!.height / 2);
    expect(renderMermaidSvg(scene!)).toContain("Operations");
  });

  it("keeps an unresolved boundary fallback visible and reports its reference", async () => {
    const snapshot = await new MermaidDocument().open(`---
manatee:
  version: 1
  elements:
    nodes:
      timeout:
        notation:
          type: boundary-timer
          host: review
          attachment: missing
---
flowchart LR
review[Review] actual@--> timeout([Timeout])
timeout --> escalate[Escalate]
`);
    expect(snapshot.valid).toBe(true);
    expect(snapshot.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "manatee.notation.boundary-timer-reference",
          severity: "warning",
        }),
      ]),
    );
    expect(
      snapshot.scene?.relationships.some(({ id }) => id === "actual"),
    ).toBe(true);
  });

  it.each(["TB", "TD", "BT", "LR", "RL"])(
    "normalizes the %s flowchart direction",
    async (direction) => {
      const snapshot = await new MermaidDocument().open(
        `flowchart ${direction}\nA-->B`,
      );
      expect(snapshot.valid).toBe(true);
      expect(snapshot.model?.direction).toBe(
        direction === "TD" ? "TB" : direction,
      );
    },
  );

  it("normalizes native lanes and cross-lane relationships", async () => {
    const snapshot = await new MermaidDocument().open(
      await fixture("swimlane-baseline.mmd"),
    );
    expect(snapshot).toMatchObject({
      valid: true,
      model: { family: "swimlane", direction: "LR" },
    });
    expect(snapshot.model?.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "sales", kind: "lane" }),
        expect.objectContaining({ id: "delivery", kind: "lane" }),
      ]),
    );
    expect(
      snapshot.model?.nodes.find(({ id }) => id === "lead")?.parentId,
    ).toBe("sales");
    expect(
      snapshot.model?.relationships.find(({ id }) => id === "cross"),
    ).toMatchObject({ source: "qualify", target: "plan" });
  });

  it("normalizes C4 context entities, variants, boundaries, and relations", async () => {
    const snapshot = await new MermaidDocument().open(
      await fixture("c4-context-baseline.mmd"),
    );
    expect(snapshot).toMatchObject({
      valid: true,
      model: { family: "c4-context" },
    });
    expect(snapshot.model?.nodes.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining([
        "person",
        "external_person",
        "system",
        "system_db",
        "system_queue",
        "external_system",
      ]),
    );
    expect(snapshot.model?.groups).toEqual([
      expect.objectContaining({ id: "company", kind: "boundary" }),
    ]);
    expect(snapshot.model?.relationships[0]).toMatchObject({
      label: "Uses",
      technology: "HTTPS",
      description: "Places an order",
      directionHint: "LR",
    });
  });

  it("normalizes C4 container and storage variants", async () => {
    const snapshot = await new MermaidDocument().open(
      await fixture("c4-container-baseline.mmd"),
    );
    expect(snapshot).toMatchObject({
      valid: true,
      model: { family: "c4-container" },
    });
    expect(snapshot.model?.nodes.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining([
        "container",
        "container_db",
        "container_queue",
        "external_container",
      ]),
    );
    expect(snapshot.model?.nodes.find(({ id }) => id === "db")).toMatchObject({
      parentId: "platform",
      technology: "PostgreSQL",
      description: "Stores data",
    });
  });

  it("isolates repeated and concurrent parses from Mermaid global state", async () => {
    const sources = await Promise.all([
      fixture("flowchart-baseline.mmd"),
      fixture("swimlane-baseline.mmd"),
      fixture("c4-context-baseline.mmd"),
      fixture("c4-container-baseline.mmd"),
    ]);
    const snapshots = await Promise.all(
      sources.map((source) => new MermaidDocument().open(source)),
    );
    expect(snapshots.map(({ model }) => model?.family)).toEqual([
      "flowchart",
      "swimlane",
      "c4-context",
      "c4-container",
    ]);
  });
});

describe("Mermaid presentation commands", () => {
  it("moves an element without rerunning automatic layout", async () => {
    class CountingLayout extends MermaidLayout {
      calls = 0;

      override async layout(request: Parameters<MermaidLayout["layout"]>[0]) {
        this.calls += 1;
        return await super.layout(request);
      }
    }

    const layout = new CountingLayout(false);
    const document = new MermaidDocument(layout);
    const opened = await document.open("flowchart LR\nA --> B");
    const before = opened.scene?.nodes.find(({ id }) => id === "A");

    const moved = await document.execute({
      type: "move",
      elementId: "A",
      dx: 10,
      dy: 5,
    });

    expect(layout.calls).toBe(1);
    expect(
      moved.snapshot.scene?.nodes.find(({ id }) => id === "A"),
    ).toMatchObject({
      x: (before?.x ?? 0) + 10,
      y: (before?.y ?? 0) + 5,
      manual: true,
    });
    document.dispose();
  });

  it("edits an explicit boundary timer atomically and preserves its fallback", async () => {
    const document = new MermaidDocument();
    await document.open(`flowchart LR
task[Review] attach@--> timeout([Review timeout])
timeout --> escalate[Escalate]
`);
    await expect(
      document.execute({
        type: "set-notation",
        elementId: "timeout",
        notation: "boundary-timer",
      }),
    ).rejects.toBeInstanceOf(CommandUnavailableError);

    const changed = await document.execute({
      type: "set-notation",
      elementId: "timeout",
      notation: "boundary-timer",
      boundaryTimer: {
        hostId: "task",
        attachmentRelationshipId: "attach",
      },
    });
    expect(changed.snapshot.source).toContain("host: task");
    expect(changed.snapshot.source).toContain("attachment: attach");
    expect(
      changed.snapshot.scene?.relationships.some(({ id }) => id === "attach"),
    ).toBe(false);

    const undone = await document.execute({ type: "undo" });
    expect(undone.snapshot.source).not.toContain("boundary-timer");
    expect(
      undone.snapshot.scene?.relationships.some(({ id }) => id === "attach"),
    ).toBe(true);
    const redone = await document.execute({ type: "redo" });
    expect(redone.snapshot.source).toContain("boundary-timer");
    expect(redone.snapshot.commands.undo).toBe(true);

    const moved = await document.execute({
      type: "move",
      elementId: "timeout",
      dx: -20,
      dy: 0,
    });
    expect(moved.snapshot.metadata).toMatchObject({
      elements: {
        nodes: {
          timeout: {
            notation: {
              type: "boundary-timer",
              host: "task",
              attachment: "attach",
              anchor: { side: "bottom" },
            },
          },
        },
      },
    });

    const cleared = await document.execute({
      type: "set-notation",
      elementId: "timeout",
      notation: undefined,
    });
    expect(
      cleared.snapshot.scene?.relationships.some(({ id }) => id === "attach"),
    ).toBe(true);
    document.dispose();
  });

  it("resolves lane and endpoint-matched relationship identities", async () => {
    const lane = new MermaidDocument();
    await lane.open(await fixture("swimlane-baseline.mmd"));
    const styledLane = await lane.execute({
      type: "set-appearance",
      elementId: "sales",
      appearance: { fill: "#ffffff", stroke: "#2563eb" },
    });
    expect(styledLane.snapshot.metadata).toMatchObject({
      elements: {
        lanes: {
          sales: {
            style: { fill: "#ffffff", outline: { color: "#2563eb" } },
          },
        },
      },
    });
    expect(styledLane.snapshot.commands.undo).toBe(true);
    lane.dispose();

    const relationship = new MermaidDocument();
    const source = `---
manatee:
  version: 1
  elements:
    relationships:
      byEndpoints:
        - match: { source: A, target: B, kind: arrow_point }
          style: { color: "#111827" }
        - match: { source: Missing, target: Gone, kind: arrow_point }
          style: { color: "#dc2626" }
---
flowchart LR
A --> B
`;
    const opened = await relationship.open(source);
    const id = opened.model?.relationships[0]?.id;
    expect(id).toBeDefined();
    const styled = await relationship.execute({
      type: "set-appearance",
      elementId: id!,
      appearance: { stroke: "#2563eb" },
    });
    const styledElements = styled.snapshot.metadata?.elements as
      { relationships?: { byEndpoints?: unknown[] } } | undefined;
    const entries = styledElements?.relationships?.byEndpoints ?? [];
    expect(entries[0]).toMatchObject({ style: { color: "#2563eb" } });
    const cleaned = await relationship.execute({ type: "cleanup-unmatched" });
    const cleanedElements = cleaned.snapshot.metadata?.elements as
      { relationships?: { byEndpoints?: unknown[] } } | undefined;
    const cleanedEntries = cleanedElements?.relationships?.byEndpoints ?? [];
    expect(cleanedEntries).toHaveLength(1);
    expect(cleanedEntries[0]).toMatchObject({
      match: { source: "A", target: "B", kind: "arrow_point" },
    });
    relationship.dispose();
  });

  it("persists dock locks, clears a reconnected endpoint, and resets routing", async () => {
    const document = new MermaidDocument();
    const opened = await document.open(`flowchart LR
A e1@--> B
C[Third]
`);
    const edge = opened.model!.relationships[0]!;
    await document.execute({
      type: "set-dock",
      elementId: edge.id,
      endpoint: "source",
      dock: "top",
    });
    const locked = await document.execute({
      type: "set-dock",
      elementId: edge.id,
      endpoint: "target",
      dock: "left",
    });
    await document.execute({
      type: "set-route",
      elementId: edge.id,
      waypoints: [
        { x: 120, y: 30 },
        { x: 240, y: 30 },
      ],
    });
    expect(locked.snapshot.metadata).toMatchObject({
      elements: {
        relationships: {
          byId: { e1: { docks: { source: "top", target: "left" } } },
        },
      },
    });
    const reconnected = await document.execute({
      type: "edit-structure",
      edit: {
        action: "relationship",
        ...edge,
        authoredId: "e1",
        target: "C",
      },
    });
    expect(reconnected.snapshot.source).toContain("A e1@--> C");
    expect(reconnected.snapshot.metadata).toMatchObject({
      elements: {
        relationships: {
          byId: {
            e1: {
              docks: { source: "top" },
              route: {
                waypoints: [
                  { x: 120, y: 30 },
                  { x: 240, y: 30 },
                ],
              },
            },
          },
        },
      },
    });
    expect(
      (
        (reconnected.snapshot.metadata!.elements as Record<string, unknown>)
          .relationships as {
          byId: { e1: { docks: Record<string, unknown> } };
        }
      ).byId.e1.docks.target,
    ).toBeUndefined();
    const undone = await document.execute({ type: "undo" });
    expect(undone.snapshot.source).toContain("A e1@--> B");
    expect(undone.snapshot.metadata).toMatchObject({
      elements: {
        relationships: {
          byId: { e1: { docks: { source: "top", target: "left" } } },
        },
      },
    });
    const redone = await document.execute({ type: "redo" });
    expect(redone.snapshot.source).toContain("A e1@--> C");
    const reset = await document.execute({ type: "reset-layout" });
    expect(JSON.stringify(reset.snapshot.metadata)).not.toContain('"docks"');
    expect(JSON.stringify(reset.snapshot.metadata)).not.toContain('"route"');
    expect(reset.snapshot.commands.undo).toBe(true);
    document.dispose();
  });

  it("persists and independently resets an exact manual connection route", async () => {
    const document = new MermaidDocument();
    const opened = await document.open(`flowchart LR
A e1@--> B
`);
    const edge = opened.model!.relationships[0]!;
    await document.execute({
      type: "set-dock",
      elementId: edge.id,
      endpoint: "source",
      dock: "top",
    });
    const routed = await document.execute({
      type: "set-route",
      elementId: edge.id,
      waypoints: [
        { x: 80, y: -20 },
        { x: 240, y: -20 },
      ],
    });
    expect(routed.snapshot.metadata).toMatchObject({
      elements: {
        relationships: {
          byId: {
            e1: {
              docks: { source: "top" },
              route: {
                waypoints: [
                  { x: 80, y: -20 },
                  { x: 240, y: -20 },
                ],
              },
            },
          },
        },
      },
    });
    expect(routed.snapshot.scene!.relationships[0]).toMatchObject({
      manualRoute: true,
      manualWaypoints: [
        { x: 80, y: -20 },
        { x: 240, y: -20 },
      ],
    });
    const reset = await document.execute({
      type: "reset-route",
      elementId: edge.id,
    });
    expect(reset.snapshot.metadata).toMatchObject({
      elements: {
        relationships: { byId: { e1: { docks: { source: "top" } } } },
      },
    });
    expect(JSON.stringify(reset.snapshot.metadata)).not.toContain('"route"');
    expect(reset.snapshot.scene!.relationships[0]!.manualRoute).toBe(false);
    const undone = await document.execute({ type: "undo" });
    expect(undone.snapshot.scene!.relationships[0]!.manualRoute).toBe(true);
    document.dispose();
  });

  it("translates a manual route with both endpoints and preserves it for one", async () => {
    const document = new MermaidDocument();
    await document.open(`---
manatee:
  version: 1
  elements:
    groups:
      team:
        position: { x: 40, y: 40 }
    nodes:
      A:
        position: { x: 20, y: 30 }
      B:
        position: { x: 220, y: 30 }
    relationships:
      byId:
        e1:
          route:
            waypoints:
              - { x: 150, y: 90 }
              - { x: 250, y: 90 }
---
flowchart LR
subgraph team[Team]
  A[First] e1@--> B[Second]
end
`);
    const movedGroup = await document.execute({
      type: "move",
      elementId: "team",
      dx: 30,
      dy: 20,
    });
    expect(
      movedGroup.snapshot.scene!.relationships[0]!.manualWaypoints,
    ).toEqual([
      { x: 180, y: 110 },
      { x: 280, y: 110 },
    ]);
    const movedOne = await document.execute({
      type: "move",
      elementId: "A",
      dx: 10,
      dy: 5,
    });
    expect(movedOne.snapshot.scene!.relationships[0]!.manualWaypoints).toEqual([
      { x: 180, y: 110 },
      { x: 280, y: 110 },
    ]);
    document.dispose();
  });

  it("converts nested canvas movement to a container-local manual position", async () => {
    const document = new MermaidDocument();
    await document.open(`---
manatee:
  version: 1
  elements:
    groups:
      container:
        position: { x: 100, y: 80 }
        notation: { type: pool }
    nodes:
      child:
        position: { x: 12, y: 20 }
---
flowchart LR
subgraph container[Container]
child[Child]
end
`);
    const moved = await document.execute({
      type: "move",
      elementId: "child",
      dx: 10,
      dy: 5,
    });
    expect(moved.snapshot.metadata).toMatchObject({
      elements: { nodes: { child: { position: { x: 22, y: 25 } } } },
    });
    document.dispose();
  });

  it("appends styling rules and rejects unavailable commands without history", async () => {
    const document = new MermaidDocument();
    await document.open(`---
manatee:
  version: 1
  rules:
    - match: { id: A }
      style: { fill: "#ffffff" }
---
flowchart LR
A --> B
`);
    const created = await document.execute({
      type: "create-styling-rule",
      attribute: "status",
      value: "failed",
      appearance: { stroke: "#dc2626" },
    });
    expect(created.snapshot.metadata?.rules).toHaveLength(2);

    const readOnlySource = `---
manatee:
  version: 2
---
flowchart LR
A --> B
`;
    const readOnly = await document.open(readOnlySource);
    expect(readOnly.commands.presentation["set-spacing"]).toMatchObject({
      state: "disabled",
    });
    await expect(
      document.execute({ type: "set-spacing", spacing: "node", value: 64 }),
    ).rejects.toBeInstanceOf(CommandUnavailableError);
    expect(document.snapshot().source).toBe(readOnlySource);
    expect(document.snapshot().commands.undo).toBe(false);
    document.dispose();
  });

  it("creates a positioned connected node as one undoable source transaction", async () => {
    const original = "flowchart LR\n  start[Start]\n";
    const document = new MermaidDocument();
    await document.open(original);

    const created = await document.execute({
      type: "create-canvas-node",
      edit: {
        action: "create-node",
        node: {
          id: "review_request",
          label: "Review request",
          kind: "rectangle",
          classes: [],
        },
        relationship: {
          id: "connection_review_request",
          source: "start",
          label: "",
          kind: "arrow_point",
        },
      },
      position: { x: 240, y: 80 },
      metadataEdits: [
        {
          type: "set",
          path: ["elements", "nodes", "review_request", "notation"],
          value: { type: "task" },
        },
        {
          type: "set",
          path: [
            "elements",
            "relationships",
            "byId",
            "connection_review_request",
            "notation",
          ],
          value: { type: "sequence-flow" },
        },
      ],
    });

    expect(created.snapshot.selectedElementId).toBe("review_request");
    expect(created.snapshot.source).toContain(
      "start connection_review_request@--> review_request",
    );
    expect(created.snapshot.metadata).toMatchObject({
      elements: {
        nodes: {
          review_request: {
            position: { x: 240, y: 80 },
            notation: { type: "task" },
          },
        },
        relationships: {
          byId: {
            connection_review_request: {
              notation: { type: "sequence-flow" },
            },
          },
        },
      },
    });

    const undone = await document.execute({ type: "undo" });
    expect(undone.snapshot.source).toBe(original);
    expect(undone.snapshot.model?.nodes.map(({ id }) => id)).toEqual(["start"]);
    expect(undone.snapshot.commands.redo).toBe(true);
    document.dispose();
  });
});

describe("Mermaid compatibility diagnostics", () => {
  it.each([
    ["mermaid.unsupported.extended-shape", "flowchart LR\nA@{ shape: cloud }"],
    ["mermaid.unsupported.icon", 'flowchart LR\nA@{ icon: "fa:user" }'],
    [
      "mermaid.unsupported.image",
      'flowchart LR\nA@{ img: "https://example.com/a.png" }',
    ],
    [
      "mermaid.unsupported.animation",
      "flowchart LR\nA e1@--> B\ne1@{ animate: true }",
    ],
    [
      "mermaid.unsupported.collapsed",
      "flowchart LR\nsubgraph s[S]\nA\nend\ns@{ view: collapsed }",
    ],
    [
      "mermaid.unsupported.click",
      'flowchart LR\nA-->B\nclick A "https://example.com"',
    ],
    ["mermaid.unsupported.html", "flowchart LR\nA[<table><tr></tr></table>]"],
    [
      "mermaid.unsupported.c4-component",
      'C4Container\nComponent(c, "Component")',
    ],
    [
      "mermaid.unsupported.icon",
      'C4Context\nPerson(a, "A", "Description", $sprite="icon")',
    ],
    [
      "mermaid.unsupported.c4-tags",
      'C4Context\nPerson(a, "A", "Description", $tags="critical")',
    ],
    [
      "mermaid.unsupported.click",
      'C4Context\nPerson(a, "A", "Description", $link="https://example.com")',
    ],
  ])("reports %s and preserves the source", async (code, source) => {
    const snapshot = await new MermaidDocument().open(source);
    expect(snapshot.source).toBe(source);
    expect(snapshot.valid).toBe(false);
    expect(snapshot.commands).toMatchObject({
      visualEditing: false,
      imageExport: false,
    });
    expect(snapshot.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      code,
    );
  });

  it("retains the last valid preview for invalid or unsupported source", async () => {
    const document = new MermaidDocument();
    const valid = await document.open("flowchart LR\nA-->B");
    const invalid = await document.replaceSource("flowchart LR\nA-->");
    expect(invalid).toMatchObject({
      valid: false,
      previewOutdated: true,
      model: valid.model,
      scene: valid.scene,
      commands: { visualEditing: false, imageExport: false },
    });
    expect(
      invalid.diagnostics.find(({ code }) => code === "mermaid.parse")?.range,
    ).toBeDefined();

    const unsupported = await document.replaceSource(
      "flowchart LR\nA@{ shape: cloud }",
    );
    expect(unsupported).toMatchObject({ valid: false, previewOutdated: true });
    expect(unsupported.source).toContain("shape: cloud");
  });

  it("clears a selection removed by a successful source render", async () => {
    const document = new MermaidDocument();
    await document.open("flowchart TD\nstart[Start]\n");
    await document.execute({ type: "select", elementId: "start" });

    const replaced = await document.replaceSource(
      "flowchart TD\nA[First]\nB[Second]\n",
    );

    expect(replaced.selectedElementId).toBeUndefined();
    expect(replaced.selectedElementLabel).toBeUndefined();
  });

  it("adds a connection ID and presentation edit in one undo step", async () => {
    const document = new MermaidDocument();
    const opened = await document.open("flowchart TD\nA-->B\nA-->B\n");
    const relationship = opened.model!.relationships[0]!;
    expect(relationship.identity.kind).toBe("ambiguous");

    const changed = await document.execute({
      type: "identify-relationship",
      elementId: relationship.id,
      authoredId: "edge_1",
      edits: [
        {
          type: "set",
          path: [
            "elements",
            "relationships",
            "byId",
            "edge_1",
            "style",
            "color",
          ],
          value: "#123456",
        },
      ],
    });

    expect(changed.snapshot.source).toContain("edge_1@-->");
    expect(changed.snapshot.scene!.relationships[0]!.style.color).toBe(
      "#123456",
    );
    const undone = await document.execute({ type: "undo" });
    expect(undone.snapshot.source).toBe("flowchart TD\nA-->B\nA-->B\n");
  });

  it("explains a missing node delimiter and points to the authored line", async () => {
    const source = "flowchart TD\nA[Broken";
    const snapshot = await new MermaidDocument().open(source);
    const diagnostic = snapshot.diagnostics.find(
      ({ code }) => code === "mermaid.parse",
    );

    expect(diagnostic?.message).toBe("Missing closing “]” in node A.");
    expect(source.slice(diagnostic!.range!.start, diagnostic!.range!.end)).toBe(
      "[Broken",
    );
    expect(diagnostic?.details).toBeTruthy();
  });

  it("diagnoses ambiguous generated relationship identities", async () => {
    const snapshot = await new MermaidDocument().open(
      "flowchart LR\nA-->B\nA-->B",
    );
    expect(snapshot.valid).toBe(true);
    expect(
      snapshot.model?.relationships.map(({ identity }) => identity.kind),
    ).toEqual(["ambiguous", "ambiguous"]);
    expect(
      snapshot.diagnostics.filter(
        ({ code }) => code === "mermaid.relationship.ambiguous",
      ),
    ).toHaveLength(2);
  });

  it("warns when an external edge conflicts with a local subgraph direction", async () => {
    const snapshot = await new MermaidDocument().open(
      "flowchart LR\nsubgraph s[S]\ndirection TB\nA-->B\nend\nA-->C",
    );
    expect(snapshot.valid).toBe(true);
    expect(snapshot.diagnostics.map(({ code }) => code)).toContain(
      "mermaid.layout.local-direction-conflict",
    );
  });

  it("rejects invisible layout links rather than silently dropping them", async () => {
    const source = "flowchart LR\nA~~~B";
    const snapshot = await new MermaidDocument().open(source);
    expect(snapshot).toMatchObject({ valid: false, source });
    expect(snapshot.diagnostics.map(({ code }) => code)).toContain(
      "mermaid.unsupported.invisible-link",
    );
  });

  it("preserves but diagnoses renderer settings and unsupported CSS", async () => {
    const source = `---
config:
  flowchart:
    curve: basis
---
flowchart LR
A-->B
style A fill:#ffffff,rx:8px
`;
    const snapshot = await new MermaidDocument().open(source);
    expect(snapshot.valid).toBe(true);
    expect(snapshot.source).toBe(source);
    expect(snapshot.diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "mermaid.presentation.unhonoured",
        "mermaid.presentation.unhonoured-style",
      ]),
    );
  });

  it("keeps unsupported metadata versions renderable but read-only", async () => {
    const source = "---\nmanatee:\n  version: 2\n---\nflowchart LR\nA-->B\n";
    const snapshot = await new MermaidDocument().open(source);
    expect(snapshot).toMatchObject({
      valid: true,
      source,
      commands: { visualEditing: false, imageExport: true },
    });
    expect(snapshot.diagnostics.map(({ code }) => code)).toContain(
      "manatee.version.unsupported",
    );
  });

  it("rejects other Mermaid families explicitly", async () => {
    const source = "sequenceDiagram\nAlice->>Bob: Hello";
    const snapshot = await new MermaidDocument().open(source);
    expect(snapshot).toMatchObject({ valid: false, source });
    expect(snapshot.diagnostics.map(({ code }) => code)).toContain(
      "mermaid.unsupported.family",
    );
  });
});
