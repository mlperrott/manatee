import type { DocumentDiagnostic } from "../../core/document/types";
import type {
  DiagramDirection,
  MermaidClassDefinition,
  MermaidGroup,
  MermaidNode,
  MermaidRelationship,
  MermaidSemanticModel,
  MermaidStyle,
  RelationshipIdentity,
} from "./model";
import type {
  RawC4Boundary,
  RawC4Relationship,
  RawC4Shape,
  RawFlowClass,
  RawFlowDatabase,
  RawFlowEdge,
  RawFlowGroup,
} from "./runtimeContract";

const supportedStyleProperties = new Set([
  "fill",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "color",
  "font-size",
  "font-weight",
  "font-style",
]);

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nestedText(value: { readonly text?: unknown } | undefined): string {
  return text(value?.text);
}

function direction(value: unknown): DiagramDirection | undefined {
  if (value === "TD") return "TB";
  return value === "TB" || value === "BT" || value === "LR" || value === "RL"
    ? value
    : undefined;
}

function style(
  declarations: unknown,
  diagnostics: DocumentDiagnostic[],
  owner: string,
): MermaidStyle {
  const normalized: Record<string, string> = {};
  for (const declaration of strings(declarations).flatMap((item) =>
    item.split(","),
  )) {
    const separator = declaration.indexOf(":");
    if (separator < 0) continue;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim();
    if (!property || !value) continue;
    if (supportedStyleProperties.has(property)) normalized[property] = value;
    else {
      diagnostics.push({
        code: "mermaid.presentation.unhonoured-style",
        message: `The ${property} style on ${owner} is preserved but is not applied by Manatee.`,
        severity: "warning",
        path: `presentation.${owner}.${property}`,
      });
    }
  }
  return { declarations: Object.freeze(normalized) };
}

function unsupportedRuntimeFeature(
  diagnostics: DocumentDiagnostic[],
  condition: boolean,
  code: string,
  message: string,
  path: string,
): void {
  if (condition) diagnostics.push({ code, message, severity: "error", path });
}

function classDefinitions(
  classes: Map<string, RawFlowClass>,
  diagnostics: DocumentDiagnostic[],
): Readonly<Record<string, MermaidClassDefinition>> {
  const result: Record<string, MermaidClassDefinition> = {};
  for (const [mapId, raw] of classes) {
    const id = text(raw.id) || mapId;
    result[id] = {
      id,
      style: style(raw.styles, diagnostics, `class.${id}`),
      textStyle: style(raw.textStyles, diagnostics, `class.${id}.text`),
    };
  }
  return Object.freeze(result);
}

function groupParents(groups: readonly RawFlowGroup[]): Map<string, string> {
  const groupIds = new Set(groups.map(({ id }) => text(id)).filter(Boolean));
  const parents = new Map<string, string>();
  for (const group of groups) {
    const id = text(group.id);
    for (const child of strings(group.nodes)) {
      if (!parents.has(child) && (groupIds.has(child) || child !== id)) {
        parents.set(child, id);
      }
    }
  }
  return parents;
}

function relationshipIdentity(
  edge: RawFlowEdge,
  kind: string,
  counts: ReadonlyMap<string, number>,
): RelationshipIdentity {
  const source = text(edge.start);
  const target = text(edge.end);
  if (edge.isUserDefinedId === true && text(edge.id)) {
    return { kind: "authored", id: text(edge.id) };
  }
  const key = `${source}\u0000${target}\u0000${kind}`;
  return (counts.get(key) ?? 0) === 1
    ? { kind: "matcher", source, target, relationshipKind: kind }
    : { kind: "ambiguous", source, target, relationshipKind: kind };
}

function edgeKind(edge: RawFlowEdge): string {
  return text(edge.type) || "arrow_point";
}

function edgeStyle(
  edge: RawFlowEdge,
  diagnostics: DocumentDiagnostic[],
  owner: string,
): MermaidStyle {
  const authored = style(edge.style, diagnostics, owner);
  const declarations = { ...authored.declarations };
  if (edge.stroke === "dotted") declarations["stroke-dasharray"] = "3 3";
  if (edge.stroke === "thick") declarations["stroke-width"] = "3px";
  if (edge.stroke === "invisible") {
    diagnostics.push({
      code: "mermaid.unsupported.invisible-link",
      message: "Invisible flowchart links are not supported in this release.",
      severity: "error",
      path: owner,
    });
  }
  return { declarations: Object.freeze(declarations) };
}

function warnForLocalDirectionConflicts(
  groups: readonly MermaidGroup[],
  nodes: readonly MermaidNode[],
  relationships: readonly MermaidRelationship[],
  diagnostics: DocumentDiagnostic[],
): void {
  const groupParent = new Map(groups.map(({ id, parentId }) => [id, parentId]));
  const belongsTo = (node: MermaidNode, groupId: string): boolean => {
    let parentId = node.parentId;
    while (parentId) {
      if (parentId === groupId) return true;
      parentId = groupParent.get(parentId);
    }
    return false;
  };
  for (const group of groups) {
    if (!group.direction) continue;
    const memberIds = new Set(
      nodes.filter((node) => belongsTo(node, group.id)).map(({ id }) => id),
    );
    const crossesBoundary = relationships.some(
      ({ source, target }) => memberIds.has(source) !== memberIds.has(target),
    );
    if (crossesBoundary) {
      diagnostics.push({
        code: "mermaid.layout.local-direction-conflict",
        message: `Subgraph ${group.id} has external relationships, so its local ${group.direction} direction may not be enforceable.`,
        severity: "warning",
        path: `semantic.groups.${group.id}.direction`,
      });
    }
  }
}

export function normalizeFlowDatabase(
  family: "flowchart" | "swimlane",
  database: RawFlowDatabase,
  initialDiagnostics: readonly DocumentDiagnostic[],
): MermaidSemanticModel {
  const diagnostics = [...initialDiagnostics];
  const rawGroups = database.getSubGraphs();
  const groupIds = new Set(
    rawGroups.map(({ id }) => text(id)).filter((id) => id.length > 0),
  );
  const parents = groupParents(rawGroups);
  const nodes: MermaidNode[] = [...database.getVertices()]
    .filter(([mapId, raw]) => !groupIds.has(text(raw.id) || mapId))
    .map(([mapId, raw]) => {
      const id = text(raw.id) || mapId;
      unsupportedRuntimeFeature(
        diagnostics,
        typeof raw.icon === "string" || typeof raw.img === "string",
        "mermaid.unsupported.image",
        `Node ${id} uses an icon or image, which is not supported in this release.`,
        `semantic.nodes.${id}`,
      );
      unsupportedRuntimeFeature(
        diagnostics,
        typeof raw.link === "string" || raw.haveCallback === true,
        "mermaid.unsupported.click",
        `Node ${id} has a link or callback, which is not supported in this release.`,
        `semantic.nodes.${id}`,
      );
      return {
        id,
        label: text(raw.text) || id,
        kind: text(raw.type) || "rectangle",
        parentId: parents.get(id),
        classes: Object.freeze(strings(raw.classes)),
        style: style(raw.styles, diagnostics, `node.${id}`),
        technology: undefined,
        description: undefined,
      };
    });
  const groups: MermaidGroup[] = rawGroups.map((raw) => {
    const id = text(raw.id);
    return {
      id,
      label: text(raw.title) || id,
      kind: family === "swimlane" ? "lane" : "subgraph",
      parentId: parents.get(id),
      direction: direction(raw.dir),
      classes: Object.freeze(strings(raw.classes)),
      style: { declarations: Object.freeze({}) },
    };
  });
  const rawEdges = database.getEdges();
  const counts = new Map<string, number>();
  for (const edge of rawEdges) {
    const key = `${text(edge.start)}\u0000${text(edge.end)}\u0000${edgeKind(edge)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const relationships: MermaidRelationship[] = rawEdges.map((edge, index) => {
    const kind = edgeKind(edge);
    const identity = relationshipIdentity(edge, kind, counts);
    unsupportedRuntimeFeature(
      diagnostics,
      edge.animate === true || typeof edge.animation === "string",
      "mermaid.unsupported.animation",
      `Relationship ${text(edge.id) || index} is animated, which is not supported in this release.`,
      `semantic.relationships.${index}`,
    );
    if (identity.kind === "ambiguous") {
      diagnostics.push({
        code: "mermaid.relationship.ambiguous",
        message: `Parallel ${kind} relationships from ${identity.source} to ${identity.target} need explicit edge IDs before they can have individual presentation overrides.`,
        severity: "warning",
        path: `semantic.relationships.${index}`,
      });
    }
    return {
      id: text(edge.id) || `relationship-${index}`,
      identity,
      source: text(edge.start),
      target: text(edge.end),
      kind,
      label: text(edge.text),
      technology: undefined,
      description: undefined,
      directionHint: undefined,
      classes: Object.freeze(strings(edge.classes)),
      style: edgeStyle(edge, diagnostics, `relationship.${index}`),
    };
  });
  warnForLocalDirectionConflicts(groups, nodes, relationships, diagnostics);
  return Object.freeze({
    family,
    direction: direction(database.getDirection()),
    nodes: Object.freeze(nodes),
    groups: Object.freeze(groups),
    relationships: Object.freeze(relationships),
    classDefinitions: classDefinitions(database.getClasses(), diagnostics),
    diagnostics: Object.freeze(diagnostics),
  });
}

function c4Style(
  raw: RawC4Shape | RawC4Boundary | RawC4Relationship,
): MermaidStyle {
  const declarations: Record<string, string> = {};
  for (const [field, property] of [
    ["bgColor", "fill"],
    ["borderColor", "stroke"],
    ["fontColor", "color"],
    ["lineColor", "stroke"],
    ["textColor", "color"],
  ] as const) {
    const value = (raw as Readonly<Record<string, unknown>>)[field];
    if (typeof value === "string") declarations[property] = value;
  }
  return { declarations: Object.freeze(declarations) };
}

function c4Direction(type: string): DiagramDirection | undefined {
  const suffix = /_(L|R|U|D)(?:_|$)/u.exec(type.toUpperCase())?.[1];
  if (suffix === "L") return "RL";
  if (suffix === "R") return "LR";
  if (suffix === "U") return "BT";
  if (suffix === "D") return "TB";
  return;
}

export function normalizeC4Database(
  family: "c4-context" | "c4-container",
  shapes: readonly RawC4Shape[],
  boundaries: readonly RawC4Boundary[],
  relations: readonly RawC4Relationship[],
  initialDiagnostics: readonly DocumentDiagnostic[],
): MermaidSemanticModel {
  const diagnostics = [...initialDiagnostics];
  const diagnoseC4Extensions = (
    raw: RawC4Shape | RawC4Boundary | RawC4Relationship,
    path: string,
  ) => {
    unsupportedRuntimeFeature(
      diagnostics,
      typeof raw.sprite === "string" && raw.sprite.length > 0,
      "mermaid.unsupported.icon",
      "C4 sprites are not supported in this release.",
      path,
    );
    unsupportedRuntimeFeature(
      diagnostics,
      typeof raw.link === "string" && raw.link.length > 0,
      "mermaid.unsupported.click",
      "C4 links are not supported in this release.",
      path,
    );
    unsupportedRuntimeFeature(
      diagnostics,
      typeof raw.tags === "string" && raw.tags.length > 0,
      "mermaid.unsupported.c4-tags",
      "C4 tags are not supported in this release.",
      path,
    );
  };
  const nodes: MermaidNode[] = shapes.map((raw) => {
    const id = text(raw.alias);
    diagnoseC4Extensions(raw, `semantic.nodes.${id}`);
    const parent = text(raw.parentBoundary);
    return {
      id,
      label: nestedText(raw.label) || id,
      kind: nestedText(raw.typeC4Shape) || "system",
      parentId: parent && parent !== "global" ? parent : undefined,
      classes: Object.freeze([]),
      style: c4Style(raw),
      technology: nestedText(raw.techn) || undefined,
      description: nestedText(raw.descr) || undefined,
    };
  });
  const groups: MermaidGroup[] = boundaries
    .filter(({ alias }) => text(alias) !== "global")
    .map((raw) => {
      const id = text(raw.alias);
      diagnoseC4Extensions(raw, `semantic.groups.${id}`);
      const parent = text(raw.parentBoundary);
      return {
        id,
        label: nestedText(raw.label) || id,
        kind: "boundary",
        parentId: parent && parent !== "global" ? parent : undefined,
        direction: undefined,
        classes: Object.freeze([]),
        style: c4Style(raw),
      };
    });
  const countByMatcher = new Map<string, number>();
  for (const raw of relations) {
    const kind = text(raw.type).replace(/_(?:l|r|u|d)$/u, "");
    const key = `${text(raw.from)}\u0000${text(raw.to)}\u0000${kind}`;
    countByMatcher.set(key, (countByMatcher.get(key) ?? 0) + 1);
  }
  const relationships: MermaidRelationship[] = relations.map((raw, index) => {
    diagnoseC4Extensions(raw, `semantic.relationships.${index}`);
    const source = text(raw.from);
    const target = text(raw.to);
    const rawKind = text(raw.type) || "rel";
    const kind = rawKind.replace(/_(?:l|r|u|d)$/u, "");
    const matcher = `${source}\u0000${target}\u0000${kind}`;
    const identity: RelationshipIdentity =
      countByMatcher.get(matcher) === 1
        ? { kind: "matcher", source, target, relationshipKind: kind }
        : { kind: "ambiguous", source, target, relationshipKind: kind };
    if (identity.kind === "ambiguous") {
      diagnostics.push({
        code: "mermaid.relationship.ambiguous",
        message: `Parallel ${kind} relationships from ${source} to ${target} cannot have individual presentation overrides.`,
        severity: "warning",
        path: `semantic.relationships.${index}`,
      });
    }
    return {
      id: `relationship-${index}`,
      identity,
      source,
      target,
      kind,
      label: nestedText(raw.label),
      technology: nestedText(raw.techn) || undefined,
      description: nestedText(raw.descr) || undefined,
      directionHint: c4Direction(rawKind),
      classes: Object.freeze([]),
      style: c4Style(raw),
    };
  });
  return Object.freeze({
    family,
    direction: undefined,
    nodes: Object.freeze(nodes),
    groups: Object.freeze(groups),
    relationships: Object.freeze(relationships),
    classDefinitions: Object.freeze({}),
    diagnostics: Object.freeze(diagnostics),
  });
}
