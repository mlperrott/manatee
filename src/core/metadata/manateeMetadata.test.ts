import { describe, expect, it } from "vitest";

import {
  findUnmatchedMetadata,
  patchManateeMetadata,
  readManateeMetadata,
} from "./manateeMetadata";

const source = `---
title: Outside # keep exactly
manatee:
  version: 1 # version comment
  mystery: keep # unknown comment
  layout:
    spacing:
      node: wrong
      layer: 72
other:
  nested: yes # untouched
---
flowchart LR
  A --> B
`;

describe("Manatee metadata", () => {
  it("returns byte-identical source when there are no edits", () => {
    expect(patchManateeMetadata(source, [])).toMatchObject({
      source,
      patches: [],
    });
  });

  it("ignores invalid known values while retaining unknown values", () => {
    const read = readManateeMetadata(source);
    expect(read.state).toBe("invalid");
    expect(read.visualEditing).toBe(true);
    expect(read.diagnostics.map(({ path }) => path)).toContain(
      "manatee.layout.spacing.node",
    );
    expect(read.metadata).toMatchObject({
      version: 1,
      mystery: "keep",
      layout: { spacing: { layer: 72 } },
    });
    const projectedLayout = read.metadata?.layout as
      { spacing: Record<string, unknown> } | undefined;
    expect(projectedLayout?.spacing).not.toHaveProperty("node");
  });

  it("rewrites only the manatee mapping and retains its comments and unknowns", () => {
    const result = patchManateeMetadata(source, [
      { type: "set", path: ["layout", "spacing", "node"], value: 64 },
    ]);
    expect(result.state).toBe("valid");
    expect(result.source).toContain("mystery: keep # unknown comment");
    expect(result.source).toContain("node: 64");
    expect(result.source.slice(0, result.patches[0]?.range.start)).toBe(
      source.slice(0, result.patches[0]?.range.start),
    );
    expect(
      result.source.slice(
        -(source.length - (result.patches[0]?.range.end ?? 0)),
      ),
    ).toBe(source.slice(result.patches[0]?.range.end));
    expect(result.source).toContain(
      "other:\n  nested: yes # untouched\n---\nflowchart LR",
    );
  });

  it("inserts metadata without changing existing front matter or semantic source", () => {
    const original = `---\r\ntitle: Diagram # keep\r\n---\r\nflowchart LR\r\nA-->B\r\n`;
    const result = patchManateeMetadata(original, [
      { type: "set", path: ["layout", "spacing", "node"], value: 40 },
    ]);
    expect(result.source).toContain("title: Diagram # keep\r\n");
    expect(result.source).toContain("node: 40\r\n");
    expect(result.source.endsWith("---\r\nflowchart LR\r\nA-->B\r\n")).toBe(
      true,
    );
  });

  it("keeps a byte-order mark at the beginning when creating front matter", () => {
    const original = "\uFEFFflowchart LR\nA-->B\n";
    const result = patchManateeMetadata(original, [
      { type: "set", path: ["layout", "spacing", "layer"], value: 72 },
    ]);
    expect(result.source.startsWith("\uFEFF---\n")).toBe(true);
    expect(result.source.endsWith(original.slice(1))).toBe(true);
  });

  it("does not rewrite malformed or unsupported metadata", () => {
    for (const original of [
      "---\nmanatee: [\n---\nflowchart LR\nA-->B\n",
      "---\nmanatee:\n  version: 2\n---\nflowchart LR\nA-->B\n",
    ]) {
      const result = patchManateeMetadata(original, [
        { type: "set", path: ["layout", "spacing", "node"], value: 40 },
      ]);
      expect(result.source).toBe(original);
      expect(result.patches).toEqual([]);
      expect(result.visualEditing).toBe(false);
    }
  });

  it("offers unmatched settings as an explicit cleanup edit set", () => {
    const metadata = {
      version: 1,
      elements: {
        nodes: { Present: {}, Missing: {} },
        relationships: {
          byId: { Flow_1: {}, Gone: {} },
          byEndpoints: [
            { match: { source: "A", target: "B", kind: "arrow" } },
            { match: { source: "X", target: "Y", kind: "arrow" } },
          ],
        },
      },
    };
    const unmatched = findUnmatchedMetadata(metadata, {
      nodes: new Set(["Present"]),
      groups: new Set(),
      lanes: new Set(),
      relationships: new Set(["Flow_1"]),
      relationshipMatchers: new Set(["A\0B\0arrow"]),
    });
    expect(unmatched.edits.map(({ path }) => path)).toEqual([
      ["elements", "nodes", "Missing"],
      ["elements", "relationships", "byId", "Gone"],
      ["elements", "relationships", "byEndpoints", 1],
    ]);
    expect(unmatched.diagnostics).toHaveLength(3);
  });
});
