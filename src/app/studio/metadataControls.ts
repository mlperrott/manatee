import type { MermaidDocumentSnapshot } from "../../mermaid";
import type {
  MetadataEdit,
  MetadataPathPart,
  MetadataValue,
} from "../../core/metadata/types";
export const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export function at(root: unknown, path: readonly MetadataPathPart[]): unknown {
  let value = root;
  for (const part of path)
    value =
      record(value)[part] ??
      (Array.isArray(value) ? value[Number(part)] : undefined);
  return value;
}
export function elementPath(
  snapshot: MermaidDocumentSnapshot,
  id: string,
):
  | { path: MetadataPathPart[]; initial: MetadataEdit[]; edge: boolean }
  | undefined {
  const model = snapshot.model;
  if (model?.nodes.some((node) => node.id === id))
    return { path: ["elements", "nodes", id], initial: [], edge: false };
  const group = model?.groups.find((item) => item.id === id);
  if (group)
    return {
      path: ["elements", group.kind === "lane" ? "lanes" : "groups", id],
      initial: [],
      edge: false,
    };
  const edge = model?.relationships.find((item) => item.id === id);
  if (!edge || edge.identity.kind === "ambiguous") return;
  if (edge.identity.kind === "authored")
    return {
      path: ["elements", "relationships", "byId", edge.identity.id],
      initial: [],
      edge: true,
    };
  const entries = at(snapshot.metadata, [
    "elements",
    "relationships",
    "byEndpoints",
  ]);
  const list = Array.isArray(entries) ? entries : [];
  const found = list.findIndex((entry: unknown) => {
    const match = record(record(entry).match);
    return (
      match.source === edge.source &&
      match.target === edge.target &&
      match.kind === edge.kind
    );
  });
  const path: MetadataPathPart[] = [
    "elements",
    "relationships",
    "byEndpoints",
    found < 0 ? list.length : found,
  ];
  return {
    path,
    edge: true,
    initial:
      found < 0
        ? [
            {
              type: "set",
              path: [...path, "match"],
              value: {
                source: edge.source,
                target: edge.target,
                kind: edge.kind,
              },
            },
          ]
        : [],
  };
}
export function scalar(text: string, type: string): string | number | boolean {
  if (type === "boolean") {
    if (text !== "true" && text !== "false")
      throw new Error("Enter true or false for a boolean value.");
    return text === "true";
  }
  if (type === "number") {
    if (!text.trim() || !Number.isFinite(Number(text)))
      throw new Error("Enter a finite number.");
    return Number(text);
  }
  return text;
}
export function editValue(
  path: readonly MetadataPathPart[],
  value: MetadataValue | undefined,
): MetadataEdit {
  return value === undefined
    ? { type: "remove", path }
    : { type: "set", path, value };
}
