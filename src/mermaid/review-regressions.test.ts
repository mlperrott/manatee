import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { MermaidDocument } from "./MermaidDocument";
import { renderMermaidSvg } from "./render/svg";

const timerSource = `flowchart LR
  task[Review] attach@--> timer([Timeout])
  timer back@--> task
`;

async function withTimer() {
  const document = new MermaidDocument();
  await document.open(timerSource);
  await document.execute({
    type: "set-notation",
    elementId: "timer",
    notation: "boundary-timer",
    boundaryTimer: { hostId: "task", attachmentRelationshipId: "attach" },
  });
  return document;
}

function svgDocument(svg: string) {
  return new DOMParser().parseFromString(svg, "image/svg+xml");
}

describe("review regressions", () => {
  it("does not carry the old file's preview into a newly opened invalid file", async () => {
    const document = new MermaidDocument();
    await document.open("flowchart LR\nold[Old file]");
    const next = await document.open("flowchart LR\nnew[");
    expect(next.valid).toBe(false);
    expect(next.scene).toBeUndefined();
    expect(next.model).toBeUndefined();
    expect(next.commands.undo).toBe(false);
    document.dispose();
  });

  it("rejects a timer host cycle atomically and preserves undo history", async () => {
    const document = await withTimer();
    const before = document.snapshot();
    await expect(
      document.execute({
        type: "set-notation",
        elementId: "task",
        notation: "boundary-timer",
        boundaryTimer: { hostId: "timer", attachmentRelationshipId: "back" },
      }),
    ).rejects.toThrow();
    expect(document.snapshot()).toBe(before);
    expect(
      document.snapshot().scene?.relationships.map(({ id }) => id),
    ).toEqual(["back"]);
    const undone = await document.execute({ type: "undo" });
    expect(undone.snapshot.source).toBe(timerSource);
    document.dispose();
  });

  it("preserves fallback connections and blocks visual editing for imported cyclic notation", async () => {
    const document = new MermaidDocument();
    const source = `---\nmanatee:\n  version: 1\n  elements:\n    nodes:\n      task: { notation: { type: boundary-timer, host: timer, attachment: back } }\n      timer: { notation: { type: boundary-timer, host: task, attachment: attach } }\n---\n${timerSource}`;
    const opened = await document.open(source);
    expect(opened.source).toBe(source);
    expect(opened.commands.visualEditing).toBe(false);
    expect(opened.commands.imageExport).toBe(false);
    expect(opened.scene?.relationships).toHaveLength(2);
    expect(
      opened.diagnostics.some(
        ({ code }) => code === "manatee.notation.boundary-timer-cycle",
      ),
    ).toBe(true);
    document.dispose();
  });

  it("resets timer anchors, preserves notation, and supports undo and per-element automatic position", async () => {
    const document = await withTimer();
    await document.execute({
      type: "move",
      elementId: "timer",
      dx: -30,
      dy: 0,
    });
    const moved = document.snapshot();
    expect(moved.commands.presentation["reset-layout"].state).toBe("available");
    const reset = await document.execute({ type: "reset-layout" });
    expect(reset.snapshot.source).toContain("type: boundary-timer");
    expect(reset.snapshot.source).not.toContain("anchor:");
    expect(reset.snapshot.commands.presentation["reset-layout"].state).toBe(
      "disabled",
    );
    await document.execute({ type: "undo" });
    expect(document.snapshot().source).toBe(moved.source);
    await document.execute({
      type: "use-automatic-position",
      elementId: "timer",
    });
    expect(document.snapshot().source).not.toContain("anchor:");
    document.dispose();
  });

  it("paints pools before their nested lanes", async () => {
    const document = new MermaidDocument();
    const opened = await document.open(
      await readFile("src/mermaid/fixtures/process-notation.mmd", "utf8"),
    );
    const svg = svgDocument(renderMermaidSvg(opened.scene!));
    const groups = [...svg.querySelectorAll("g.group")].map((el) =>
      el.getAttribute("data-element-id"),
    );
    expect(groups.indexOf("company")).toBeLessThan(
      groups.indexOf("operations"),
    );
    document.dispose();
  });

  it("keeps notation markers authoritative while preserving styling and ordinary Mermaid fallback", async () => {
    const document = new MermaidDocument();
    await document.open(`---
manatee:
  version: 1
  elements:
    nodes:
      timer:
        notation: { type: boundary-timer, host: task, attachment: attach }
        style: { fill: '#ffeeaa', outline: { color: '#123456', style: dashed } }
    relationships:
      byId:
        flow: { notation: { type: sequence-flow } }
---
flowchart LR
  task[Review] attach@--> timer([Timeout])
  timer flow@-.-> finish[End]
`);
    const svg = svgDocument(renderMermaidSvg(document.snapshot().scene!));
    expect(
      svg
        .querySelector('[data-element-id="timer"] circle')
        ?.getAttribute("stroke-dasharray"),
    ).toBeNull();
    expect(
      svg
        .querySelector('[data-element-id="timer"] circle')
        ?.getAttribute("stroke"),
    ).toBe("#123456");
    expect(
      svg
        .querySelector('[data-element-id="flow"] > path')
        ?.getAttribute("stroke-dasharray"),
    ).toBeNull();
    const cleared = await document.execute({
      type: "set-notation",
      elementId: "flow",
      notation: undefined,
    });
    expect(
      svgDocument(renderMermaidSvg(cleared.snapshot.scene!))
        .querySelector('[data-element-id="flow"] > path')
        ?.getAttribute("stroke-dasharray"),
    ).not.toBeNull();
    document.dispose();
  });

  it("reopens moved nested pools and nodes at their displayed position", async () => {
    const document = new MermaidDocument();
    await document.open(`---
manatee:
  version: 1
  elements:
    groups:
      pool: { notation: { type: pool }, position: { x: 100, y: 80 } }
      lane: { notation: { type: lane }, position: { x: 12, y: 20 } }
    nodes:
      child: { position: { x: 16, y: 18 } }
---
flowchart LR
  subgraph pool[Pool]
    subgraph lane[Lane]
      child[Child]
    end
  end
`);
    for (const elementId of ["child", "lane", "pool"]) {
      await document.execute({ type: "move", elementId, dx: 20, dy: 15 });
      const moved = document.snapshot();
      const before = [...moved.scene!.groups, ...moved.scene!.nodes].map(
        ({ id, x, y }) => ({ id, x, y }),
      );
      const reopened = await document.open(moved.source);
      expect(
        [...reopened.scene!.groups, ...reopened.scene!.nodes].map(
          ({ id, x, y }) => ({ id, x, y }),
        ),
      ).toEqual(before);
    }
    document.dispose();
  });
});
