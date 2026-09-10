import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { UnsafeSourcePatchError } from "../../core/source/patches";
import {
  addBpmnExportAttribution,
  BpmnDocumentAdapter,
  type BpmnLayoutService,
} from ".";
import { BpmnAutoLayout } from "./layout/BpmnAutoLayout";

async function fixture(name: string): Promise<string> {
  return readFile(resolve("src/adapters/bpmn/fixtures", name), "utf8");
}

function fingerprint(
  elements: readonly {
    readonly id: string;
    readonly type: string;
    readonly name: string;
    readonly parentId: string | undefined;
    readonly sourceId: string | undefined;
    readonly targetId: string | undefined;
  }[],
): unknown {
  return elements
    .map(({ id, type, name, parentId, sourceId, targetId }) => ({
      id,
      type,
      name,
      parentId,
      sourceId,
      targetId,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

describe("BpmnDocumentAdapter", () => {
  it("pins the parser, modeler, and prerelease layout versions", async () => {
    const versions = await Promise.all(
      ["bpmn-js", "bpmn-moddle", "bpmn-auto-layout"].map(async (name) => {
        const manifest = JSON.parse(
          await readFile(resolve("node_modules", name, "package.json"), "utf8"),
        ) as { version?: string };
        return manifest.version;
      }),
    );
    expect(versions).toEqual(["18.28.0", "10.2.0", "2.0.0-alpha.2"]);
  });

  it("opens the representative process and reports recovery and preserved extensions", async () => {
    const adapter = new BpmnDocumentAdapter(new BpmnAutoLayout(false));
    const snapshot = await adapter.open(
      await fixture("process-missing-di.bpmn"),
    );
    expect(snapshot).toMatchObject({
      kind: "bpmn",
      valid: true,
      presentationModel: { requiresLayout: true },
      commands: { visualEditing: true, imageExport: false },
    });
    expect(snapshot.semanticModel?.elements.map(({ type }) => type)).toEqual(
      expect.arrayContaining([
        "bpmn:Lane",
        "bpmn:StartEvent",
        "bpmn:UserTask",
        "bpmn:ExclusiveGateway",
        "bpmn:SubProcess",
        "bpmn:ServiceTask",
        "bpmn:DataObjectReference",
        "bpmn:TextAnnotation",
        "bpmn:Association",
        "bpmn:Group",
      ]),
    );
    expect(snapshot.diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "bpmn.vendor-extension.preserved",
        "bpmn.execution.preserved",
      ]),
    );
    adapter.dispose();
  });

  it.each([
    ["process-missing-di.bpmn", "bpmn:SubProcess"],
    ["collaboration-missing-di.bpmn", "bpmn:MessageFlow"],
  ])(
    "recovers deterministic DI for %s without semantic loss",
    async (name, type) => {
      const adapter = new BpmnDocumentAdapter(new BpmnAutoLayout(false));
      const source = await fixture(name);
      const opened = await adapter.open(source);
      const before = fingerprint(opened.semanticModel?.elements ?? []);
      const recovered = await adapter.recoverMissingDi();
      expect(recovered.valid).toBe(true);
      expect(recovered.presentationModel?.requiresLayout).toBe(false);
      expect(recovered.commands.imageExport).toBe(true);
      expect(recovered.source).toContain("<bpmndi:BPMNDiagram");
      if (name === "process-missing-di.bpmn") {
        expect(recovered.source).toContain(
          "semantic comment must survive visual edits",
        );
      }
      expect(fingerprint(recovered.semanticModel?.elements ?? [])).toEqual(
        before,
      );
      expect(
        recovered.semanticModel?.elements.map((element) => element.type),
      ).toContain(type);
      const firstSource = recovered.source;
      const reset = await adapter.resetLayout();
      expect(reset.snapshot.source).toBe(firstSource);
      adapter.dispose();
    },
  );

  it("moves, resizes, routes, styles, and undo/redoes through narrow source patches", async () => {
    const adapter = new BpmnDocumentAdapter(new BpmnAutoLayout(false));
    await adapter.open(await fixture("process-missing-di.bpmn"));
    await adapter.recoverMissingDi();
    const before = adapter.snapshot();
    const processXml = /<bpmn:process[\s\S]*<\/bpmn:process>/u.exec(
      before.source,
    )?.[0];
    const moved = await adapter.moveOrResize("Task_Review", {
      x: 320,
      y: 180,
      width: 140,
      height: 90,
    });
    expect(moved.patches).toHaveLength(4);
    expect(
      moved.snapshot.presentationModel?.shapes.Task_Review?.bounds,
    ).toEqual({
      x: 320,
      y: 180,
      width: 140,
      height: 90,
    });
    expect(
      /<bpmn:process[\s\S]*<\/bpmn:process>/u.exec(moved.snapshot.source)?.[0],
    ).toBe(processXml);

    const routed = await adapter.route("Association_1", [
      { x: 390, y: 225 },
      { x: 480, y: 225 },
      { x: 480, y: 340 },
    ]);
    expect(
      routed.snapshot.presentationModel?.edges.Association_1?.waypoints,
    ).toHaveLength(3);
    const styled = await adapter.style("Task_Review", {
      fill: "#fee2e2",
      stroke: "#dc2626",
    });
    expect(styled.snapshot.presentationModel?.styles.Task_Review).toEqual({
      fill: "#fee2e2",
      stroke: "#dc2626",
    });
    expect(styled.snapshot.source).toContain(
      '<manatee:element ref="Task_Review" fill="#fee2e2" stroke="#dc2626" />',
    );
    expect(styled.snapshot.source).toContain(
      '<vendor:setting key="preserve">untouched</vendor:setting>',
    );
    expect(
      /<bpmn:process[\s\S]*<\/bpmn:process>/u.exec(styled.snapshot.source)?.[0],
    ).toBe(processXml);
    const styledSource = styled.snapshot.source;
    expect((await adapter.execute({ type: "undo" })).snapshot.source).not.toBe(
      styledSource,
    );
    expect((await adapter.execute({ type: "redo" })).snapshot.source).toBe(
      styledSource,
    );
    const reopenedAdapter = new BpmnDocumentAdapter(new BpmnAutoLayout(false));
    const withRule = styledSource.replace(
      "<manatee:element",
      '<manatee:rule type="bpmn:ServiceTask" fill="#dbeafe" stroke="#2563eb" />\n      <manatee:element',
    );
    const reopened = await reopenedAdapter.open(withRule);
    expect(reopened.presentationModel?.styles.Task_Review).toEqual({
      fill: "#fee2e2",
      stroke: "#dc2626",
    });
    expect(reopened.presentationModel?.styles.Task_Service).toEqual({
      fill: "#dbeafe",
      stroke: "#2563eb",
    });
    reopenedAdapter.dispose();
    adapter.dispose();
  });

  it("recovers partial DI as one undoable transaction", async () => {
    const adapter = new BpmnDocumentAdapter(new BpmnAutoLayout(false));
    await adapter.open(await fixture("collaboration-missing-di.bpmn"));
    const complete = await adapter.recoverMissingDi();
    const partial = complete.source.replace(
      /\s*<bpmndi:BPMNShape[^>]+bpmnElement="Task_Receive"[\s\S]*?<\/bpmndi:BPMNShape>/u,
      "",
    );
    const opened = await adapter.open(partial);
    expect(opened.presentationModel?.requiresLayout).toBe(true);
    const recovered = await adapter.resetLayout();
    expect(recovered.snapshot.presentationModel?.requiresLayout).toBe(false);
    expect(recovered.snapshot.commands.undo).toBe(true);
    expect((await adapter.execute({ type: "undo" })).snapshot.source).toBe(
      partial,
    );
    adapter.dispose();
  });

  it("rejects unsafe style values and unknown extension versions", async () => {
    const adapter = new BpmnDocumentAdapter(new BpmnAutoLayout(false));
    await adapter.open(await fixture("process-missing-di.bpmn"));
    await adapter.recoverMissingDi();
    await expect(
      adapter.style("Task_Review", { fill: "url(https://example.com/x)" }),
    ).rejects.toBeInstanceOf(UnsafeSourcePatchError);
    const styled = await adapter.style("Task_Review", { fill: "#ffffff" });
    const unknown = styled.snapshot.source.replace(
      'version="1"',
      'version="2"',
    );
    const reopened = await adapter.open(unknown);
    expect(reopened.valid).toBe(true);
    expect(reopened.commands.visualEditing).toBe(false);
    expect(reopened.diagnostics.map(({ code }) => code)).toContain(
      "bpmn.metadata.unknown-version",
    );
    const withUnknown = styled.snapshot.source.replace(
      /<manatee:presentation([^>]*)version="1"\s*>/u,
      '<manatee:presentation$1version="1" mystery="keep"><!-- keep style comment -->',
    );
    await adapter.open(withUnknown);
    const updated = await adapter.style("Task_Review", { stroke: "#111827" });
    expect(updated.snapshot.source).toContain('mystery="keep"');
    expect(updated.snapshot.source).toContain("<!-- keep style comment -->");
    adapter.dispose();
  });

  it("leaves authored geometry untouched when automatic layout fails", async () => {
    const direct = new BpmnDocumentAdapter(new BpmnAutoLayout(false));
    await direct.open(await fixture("collaboration-missing-di.bpmn"));
    const withDi = await direct.recoverMissingDi();
    direct.dispose();
    const rejectingLayout: BpmnLayoutService = {
      async layout() {
        throw new Error("unsupported fixture");
      },
      dispose() {},
    };
    const adapter = new BpmnDocumentAdapter(rejectingLayout);
    await adapter.open(withDi.source);
    const authored = adapter.snapshot().source;
    await expect(adapter.resetLayout()).rejects.toThrow("unsupported fixture");
    expect(adapter.snapshot().source).toBe(authored);
    adapter.dispose();
  });

  it("retains the last valid preview after malformed source", async () => {
    const adapter = new BpmnDocumentAdapter(new BpmnAutoLayout(false));
    const source = await fixture("collaboration-missing-di.bpmn");
    const valid = await adapter.open(source);
    const invalid = await adapter.replaceSource(source.slice(0, -25));
    expect(invalid).toMatchObject({
      valid: false,
      previewOutdated: true,
      semanticModel: valid.semanticModel,
      view: valid.view,
      commands: { visualEditing: false, imageExport: false },
    });
    adapter.dispose();
  });
});

describe("BPMN SVG attribution", () => {
  it("adds visible bpmn.io attribution once", () => {
    const svg = '<svg viewBox="0 0 800 600"><path /></svg>';
    const attributed = addBpmnExportAttribution(svg);
    expect(attributed).toContain('data-bpmn-io-attribution="true"');
    expect(attributed).toContain('href="https://bpmn.io"');
    expect(attributed).toContain("Created with bpmn.io");
    expect(addBpmnExportAttribution(attributed)).toBe(attributed);
  });
});
