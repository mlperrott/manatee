import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { CommandUnavailableError } from "../../core/document/DocumentEngine";
import { MermaidDocumentAdapter } from "./MermaidDocumentAdapter";
import { mermaidFamilyAdapters } from "./familyAdapters";

async function fixture(name: string): Promise<string> {
  return readFile(resolve("src/adapters/mermaid/fixtures", name), "utf8");
}

describe("MermaidDocumentAdapter baseline", () => {
  it("pins one contract adapter for every supported family", async () => {
    const packageManifest = JSON.parse(
      await readFile(resolve("node_modules/mermaid/package.json"), "utf8"),
    ) as { version?: string };
    expect(packageManifest.version).toBe("11.17.2");
    expect(Object.keys(mermaidFamilyAdapters)).toEqual([
      "flowchart",
      "swimlane",
      "c4-context",
      "c4-container",
    ]);
  });

  it("normalizes classic flowchart syntax, nesting, identities, and styles", async () => {
    const source = await fixture("flowchart-baseline.mmd");
    const snapshot = await new MermaidDocumentAdapter().open(source);
    expect(snapshot).toMatchObject({
      source,
      valid: true,
      dirty: false,
      semanticModel: { family: "flowchart", direction: "RL" },
      presentationModel: { metadata: { version: 1, mystery: "preserved" } },
    });
    const model = snapshot.semanticModel;
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

  it.each(["TB", "TD", "BT", "LR", "RL"])(
    "normalizes the %s flowchart direction",
    async (direction) => {
      const snapshot = await new MermaidDocumentAdapter().open(
        `flowchart ${direction}\nA-->B`,
      );
      expect(snapshot.valid).toBe(true);
      expect(snapshot.semanticModel?.direction).toBe(
        direction === "TD" ? "TB" : direction,
      );
    },
  );

  it("normalizes native lanes and cross-lane relationships", async () => {
    const snapshot = await new MermaidDocumentAdapter().open(
      await fixture("swimlane-baseline.mmd"),
    );
    expect(snapshot).toMatchObject({
      valid: true,
      semanticModel: { family: "swimlane", direction: "LR" },
    });
    expect(snapshot.semanticModel?.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "sales", kind: "lane" }),
        expect.objectContaining({ id: "delivery", kind: "lane" }),
      ]),
    );
    expect(
      snapshot.semanticModel?.nodes.find(({ id }) => id === "lead")?.parentId,
    ).toBe("sales");
    expect(
      snapshot.semanticModel?.relationships.find(({ id }) => id === "cross"),
    ).toMatchObject({ source: "qualify", target: "plan" });
  });

  it("normalizes C4 context entities, variants, boundaries, and relations", async () => {
    const snapshot = await new MermaidDocumentAdapter().open(
      await fixture("c4-context-baseline.mmd"),
    );
    expect(snapshot).toMatchObject({
      valid: true,
      semanticModel: { family: "c4-context" },
    });
    expect(snapshot.semanticModel?.nodes.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining([
        "person",
        "external_person",
        "system",
        "system_db",
        "system_queue",
        "external_system",
      ]),
    );
    expect(snapshot.semanticModel?.groups).toEqual([
      expect.objectContaining({ id: "company", kind: "boundary" }),
    ]);
    expect(snapshot.semanticModel?.relationships[0]).toMatchObject({
      label: "Uses",
      technology: "HTTPS",
      description: "Places an order",
      directionHint: "LR",
    });
  });

  it("normalizes C4 container and storage variants", async () => {
    const snapshot = await new MermaidDocumentAdapter().open(
      await fixture("c4-container-baseline.mmd"),
    );
    expect(snapshot).toMatchObject({
      valid: true,
      semanticModel: { family: "c4-container" },
    });
    expect(snapshot.semanticModel?.nodes.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining([
        "container",
        "container_db",
        "container_queue",
        "external_container",
      ]),
    );
    expect(
      snapshot.semanticModel?.nodes.find(({ id }) => id === "db"),
    ).toMatchObject({
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
      sources.map((source) => new MermaidDocumentAdapter().open(source)),
    );
    expect(snapshots.map(({ semanticModel }) => semanticModel?.family)).toEqual(
      ["flowchart", "swimlane", "c4-context", "c4-container"],
    );
  });
});

describe("Mermaid presentation commands", () => {
  it("resolves lane and endpoint-matched relationship identities inside the adapter", async () => {
    const lane = new MermaidDocumentAdapter();
    await lane.open(await fixture("swimlane-baseline.mmd"));
    const styledLane = await lane.execute({
      type: "set-appearance",
      elementId: "sales",
      appearance: { fill: "#ffffff", stroke: "#2563eb" },
    });
    expect(styledLane.snapshot.presentationModel?.metadata).toMatchObject({
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

    const relationship = new MermaidDocumentAdapter();
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
    const id = opened.semanticModel?.relationships[0]?.id;
    expect(id).toBeDefined();
    const styled = await relationship.execute({
      type: "set-appearance",
      elementId: id!,
      appearance: { stroke: "#2563eb" },
    });
    const styledElements = styled.snapshot.presentationModel?.metadata
      ?.elements as { relationships?: { byEndpoints?: unknown[] } } | undefined;
    const entries = styledElements?.relationships?.byEndpoints ?? [];
    expect(entries[0]).toMatchObject({ style: { color: "#2563eb" } });
    const cleaned = await relationship.execute({ type: "cleanup-unmatched" });
    const cleanedElements = cleaned.snapshot.presentationModel?.metadata
      ?.elements as { relationships?: { byEndpoints?: unknown[] } } | undefined;
    const cleanedEntries = cleanedElements?.relationships?.byEndpoints ?? [];
    expect(cleanedEntries).toHaveLength(1);
    expect(cleanedEntries[0]).toMatchObject({
      match: { source: "A", target: "B", kind: "arrow_point" },
    });
    relationship.dispose();
  });

  it("converts nested canvas movement to a container-local manual position", async () => {
    const adapter = new MermaidDocumentAdapter();
    await adapter.open(`---
manatee:
  version: 1
  elements:
    groups:
      container:
        position: { x: 100, y: 80 }
    nodes:
      child:
        position: { x: 12, y: 20 }
---
flowchart LR
subgraph container[Container]
child[Child]
end
`);
    const moved = await adapter.execute({
      type: "move",
      elementId: "child",
      dx: 10,
      dy: 5,
    });
    expect(moved.snapshot.presentationModel?.metadata).toMatchObject({
      elements: { nodes: { child: { position: { x: 22, y: 25 } } } },
    });
    adapter.dispose();
  });

  it("appends styling rules and rejects unavailable commands without history", async () => {
    const adapter = new MermaidDocumentAdapter();
    await adapter.open(`---
manatee:
  version: 1
  rules:
    - match: { id: A }
      style: { fill: "#ffffff" }
---
flowchart LR
A --> B
`);
    const created = await adapter.execute({
      type: "create-styling-rule",
      attribute: "status",
      value: "failed",
      appearance: { stroke: "#dc2626" },
    });
    expect(created.snapshot.presentationModel?.metadata?.rules).toHaveLength(2);

    const readOnlySource = `---
manatee:
  version: 2
---
flowchart LR
A --> B
`;
    const readOnly = await adapter.open(readOnlySource);
    expect(readOnly.commands.presentation["set-spacing"]).toMatchObject({
      state: "disabled",
    });
    await expect(
      adapter.execute({ type: "set-spacing", spacing: "node", value: 64 }),
    ).rejects.toBeInstanceOf(CommandUnavailableError);
    expect(adapter.snapshot().source).toBe(readOnlySource);
    expect(adapter.snapshot().commands.undo).toBe(false);
    adapter.dispose();
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
    const snapshot = await new MermaidDocumentAdapter().open(source);
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
    const adapter = new MermaidDocumentAdapter();
    const valid = await adapter.open("flowchart LR\nA-->B");
    const invalid = await adapter.replaceSource("flowchart LR\nA-->");
    expect(invalid).toMatchObject({
      valid: false,
      previewOutdated: true,
      semanticModel: valid.semanticModel,
      view: valid.view,
      commands: { visualEditing: false, imageExport: false },
    });
    expect(
      invalid.diagnostics.find(({ code }) => code === "mermaid.parse")?.range,
    ).toBeDefined();

    const unsupported = await adapter.replaceSource(
      "flowchart LR\nA@{ shape: cloud }",
    );
    expect(unsupported).toMatchObject({ valid: false, previewOutdated: true });
    expect(unsupported.source).toContain("shape: cloud");
  });

  it("diagnoses ambiguous generated relationship identities", async () => {
    const snapshot = await new MermaidDocumentAdapter().open(
      "flowchart LR\nA-->B\nA-->B",
    );
    expect(snapshot.valid).toBe(true);
    expect(
      snapshot.semanticModel?.relationships.map(
        ({ identity }) => identity.kind,
      ),
    ).toEqual(["ambiguous", "ambiguous"]);
    expect(
      snapshot.diagnostics.filter(
        ({ code }) => code === "mermaid.relationship.ambiguous",
      ),
    ).toHaveLength(2);
  });

  it("warns when an external edge conflicts with a local subgraph direction", async () => {
    const snapshot = await new MermaidDocumentAdapter().open(
      "flowchart LR\nsubgraph s[S]\ndirection TB\nA-->B\nend\nA-->C",
    );
    expect(snapshot.valid).toBe(true);
    expect(snapshot.diagnostics.map(({ code }) => code)).toContain(
      "mermaid.layout.local-direction-conflict",
    );
  });

  it("rejects invisible layout links rather than silently dropping them", async () => {
    const source = "flowchart LR\nA~~~B";
    const snapshot = await new MermaidDocumentAdapter().open(source);
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
    const snapshot = await new MermaidDocumentAdapter().open(source);
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
    const snapshot = await new MermaidDocumentAdapter().open(source);
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
    const snapshot = await new MermaidDocumentAdapter().open(source);
    expect(snapshot).toMatchObject({ valid: false, source });
    expect(snapshot.diagnostics.map(({ code }) => code)).toContain(
      "mermaid.unsupported.family",
    );
  });
});

describe("Mermaid adapter matching", () => {
  it("matches supported content and portable Mermaid filenames", () => {
    const adapter = new MermaidDocumentAdapter();
    expect(adapter.matches("flowchart LR\nA-->B")).toBe(true);
    expect(adapter.matches("", { filename: "diagram.mmd" })).toBe(true);
    expect(
      adapter.matches("", { filename: "diagram.bpmn", kind: "bpmn" }),
    ).toBe(false);
  });
});
