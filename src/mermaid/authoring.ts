import { findFrontMatter } from "../core/metadata/frontMatter";
import {
  patchManateeMetadata,
  readManateeMetadata,
} from "../core/metadata/manateeMetadata";
import type { MetadataEdit } from "../core/metadata/types";
import type {
  DiagramDirection,
  MermaidGroup,
  MermaidNode,
  MermaidRelationship,
  MermaidSemanticModel,
} from "./model";

export type StructureEdit =
  | {
      readonly action: "node";
      readonly id: string;
      readonly label: string;
      readonly kind: string;
      readonly parentId?: string | undefined;
      readonly technology?: string | undefined;
      readonly description?: string | undefined;
      readonly classes?: readonly string[];
    }
  | {
      readonly action: "group";
      readonly id: string;
      readonly label: string;
      readonly parentId?: string | undefined;
      readonly direction?: DiagramDirection;
    }
  | {
      readonly action: "relationship";
      readonly authoredId?: string;
      readonly id: string;
      readonly source: string;
      readonly target: string;
      readonly label: string;
      readonly kind: string;
      readonly technology?: string | undefined;
      readonly description?: string | undefined;
      readonly directionHint?: DiagramDirection | undefined;
    }
  | { readonly action: "delete"; readonly id: string }
  | { readonly action: "direction"; readonly direction: DiagramDirection };

export const flowShapes: Readonly<Record<string, readonly [string, string]>> = {
  rectangle: ["[", "]"],
  square: ["[", "]"],
  round: ["(", ")"],
  stadium: ["([", "])"],
  diamond: ["{", "}"],
  hexagon: ["{{", "}}"],
  circle: ["((", "))"],
  doublecircle: ["(((", ")))"],
  subroutine: ["[[", "]]"],
  cylinder: ["[(", ")]"],
  ellipse: ["(-", "-)"],
  lean_right: ["[/", "/]"],
  lean_left: ["[\\", "\\]"],
  trapezoid: ["[/", "\\]"],
  inv_trapezoid: ["[\\", "/]"],
  rect: ["[", "]"],
  odd: [">", "]"],
};
export const c4Shapes: Readonly<Record<string, string>> = {
  person: "Person",
  external_person: "Person_Ext",
  system: "System",
  external_system: "System_Ext",
  system_db: "SystemDb",
  external_system_db: "SystemDb_Ext",
  system_queue: "SystemQueue",
  external_system_queue: "SystemQueue_Ext",
  container: "Container",
  external_container: "Container_Ext",
  container_db: "ContainerDb",
  external_container_db: "ContainerDb_Ext",
  container_queue: "ContainerQueue",
  external_container_queue: "ContainerQueue_Ext",
};
const arrows: Record<string, string> = {
  arrow_point: "-->",
  arrow_open: "---",
  arrow_circle: "--o",
  arrow_cross: "--x",
  double_arrow_point: "<-->",
  double_arrow_circle: "o--o",
  double_arrow_cross: "x--x",
};
const quote = (value: string) =>
  `"${value.replaceAll('"', "#quot;").replaceAll("\n", "<br/>")}"`;
const identifier = (id: string) => {
  if (!/^[A-Za-z_][\w-]*$/u.test(id) || /^(end|subgraph|direction)$/iu.test(id))
    throw new Error(
      "Use an identifier starting with a letter or underscore, followed by letters, numbers, underscores or hyphens.",
    );
  return id;
};
const c4Function = (kind: string) => {
  const value = c4Shapes[kind];
  if (!value)
    throw new Error(`Visual source editing cannot preserve C4 type ${kind}.`);
  return value;
};

function authoredStatements(source: string): string[] {
  const result: string[] = [];
  let start = 0;
  let quoted = false;
  let depth = 0;
  let comment = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (!quoted && source.slice(index, index + 2) === "%%") comment = true;
    if (!comment && char === '"') quoted = !quoted;
    if (!comment && !quoted) {
      if (char === "[" || char === "(") depth += 1;
      if (char === "]" || char === ")") depth = Math.max(0, depth - 1);
    }
    if (
      (!comment && !quoted && depth === 0 && char === ";") ||
      (char === "\n" && ((!quoted && depth === 0) || comment))
    ) {
      result.push(source.slice(start, index));
      start = index + 1;
      comment = false;
    }
  }
  result.push(source.slice(start));
  return result;
}

/** Regenerate structural statements; retain the front matter and authored comments/directives. */
export function editStructure(
  source: string,
  model: MermaidSemanticModel,
  edit: StructureEdit,
): string {
  let nodes = [...model.nodes];
  let groups = [...model.groups];
  let relationships = [...model.relationships];
  let direction = model.direction;
  const flow = model.family === "flowchart" || model.family === "swimlane";
  const all = [...nodes, ...groups, ...relationships];
  const metadataEdits: MetadataEdit[] = [];
  if (edit.action === "direction") direction = edit.direction;
  else if (edit.action === "delete") {
    const group = groups.find((item) => item.id === edit.id);
    nodes = nodes
      .filter((item) => item.id !== edit.id)
      .map((item) =>
        item.parentId === edit.id
          ? { ...item, parentId: group?.parentId }
          : item,
      );
    groups = groups
      .filter((item) => item.id !== edit.id)
      .map((item) =>
        item.parentId === edit.id
          ? { ...item, parentId: group?.parentId }
          : item,
      );
    relationships = relationships.filter(
      (item) =>
        item.id !== edit.id &&
        item.source !== edit.id &&
        item.target !== edit.id,
    );
    for (const category of ["nodes", "groups", "lanes"])
      metadataEdits.push({
        type: "remove",
        path: ["elements", category, edit.id],
      });
  } else {
    const existing = all.find((item) => item.id === edit.id);
    if (!existing) identifier(edit.id);
    if (edit.action === "node") {
      if (existing && !nodes.some((item) => item.id === edit.id))
        throw new Error("That identifier belongs to another element.");
      const old = nodes.find((item) => item.id === edit.id);
      const node: MermaidNode = {
        ...old,
        id: edit.id,
        label: edit.label,
        kind: edit.kind,
        parentId: edit.parentId,
        technology: edit.technology,
        description: edit.description,
        classes: edit.classes ?? old?.classes ?? [],
        style: old?.style ?? { declarations: {} },
      };
      nodes = old
        ? nodes.map((item) => (item.id === edit.id ? node : item))
        : [...nodes, node];
    } else if (edit.action === "group") {
      if (existing && !groups.some((item) => item.id === edit.id))
        throw new Error("That identifier belongs to another element.");
      const old = groups.find((item) => item.id === edit.id);
      const group: MermaidGroup = {
        ...old,
        id: edit.id,
        label: edit.label,
        kind: flow
          ? model.family === "swimlane"
            ? "lane"
            : "subgraph"
          : "boundary",
        parentId: edit.parentId,
        direction: edit.direction,
        classes: old?.classes ?? [],
        style: old?.style ?? { declarations: {} },
      };
      groups = old
        ? groups.map((item) => (item.id === edit.id ? group : item))
        : [...groups, group];
    } else {
      if (existing && !relationships.some((item) => item.id === edit.id))
        throw new Error("That identifier belongs to another element.");
      if (
        ![...nodes, ...groups].some((item) => item.id === edit.source) ||
        ![...nodes, ...groups].some((item) => item.id === edit.target)
      )
        throw new Error("Choose existing connection endpoints.");
      const old = relationships.find((item) => item.id === edit.id);
      if (edit.authoredId) {
        identifier(edit.authoredId);
        if (
          all.some((item) => item.id === edit.authoredId && item.id !== edit.id)
        )
          throw new Error("That connection ID is already in use.");
      }
      const edge: MermaidRelationship = {
        ...old,
        id: edit.id,
        source: edit.source,
        target: edit.target,
        label: edit.label,
        kind: edit.kind,
        technology: edit.technology,
        description: edit.description,
        directionHint: edit.directionHint,
        identity:
          old?.identity.kind === "authored"
            ? old.identity
            : flow && (edit.authoredId || !old)
              ? { kind: "authored", id: edit.authoredId ?? edit.id }
              : {
                  kind: "matcher",
                  source: edit.source,
                  target: edit.target,
                  relationshipKind: edit.kind,
                },
        classes: old?.classes ?? [],
        style: old?.style ?? { declarations: {} },
      };
      relationships = old
        ? relationships.map((item) => (item.id === edit.id ? edge : item))
        : [...relationships, edge];
    }
  }
  for (const item of [...nodes, ...groups]) {
    const visited = new Set([item.id]);
    let parent = item.parentId;
    while (parent) {
      if (visited.has(parent))
        throw new Error(
          "A group cannot contain itself or one of its ancestors.",
        );
      visited.add(parent);
      const group = groups.find((candidate) => candidate.id === parent);
      if (!group) throw new Error("Choose an existing parent group.");
      parent = group.parentId;
    }
  }
  for (const item of [...nodes, ...groups]) {
    const previous = [...model.nodes, ...model.groups].find(
      (old) => old.id === item.id,
    );
    if (previous && previous.parentId !== item.parentId) {
      const category = nodes.some((node) => node.id === item.id)
        ? "nodes"
        : model.family === "swimlane"
          ? "lanes"
          : "groups";
      metadataEdits.push({
        type: "remove",
        path: ["elements", category, item.id, "position"],
      });
    }
  }
  // Keep matcher-based presentation attached when a connection's endpoints change.
  const metadata = readManateeMetadata(source).sourceMetadata;
  const elements = metadata?.elements as Record<string, unknown> | undefined;
  const edgeSettings = elements?.relationships as
    | {
        byEndpoints?: {
          match: { source: string; target: string; kind: string };
        }[];
      }
    | undefined;
  for (const old of model.relationships) {
    const next = relationships.find((item) => item.id === old.id);
    if (old.identity.kind === "authored") {
      if (!next)
        metadataEdits.push({
          type: "remove",
          path: ["elements", "relationships", "byId", old.identity.id],
        });
    } else {
      edgeSettings?.byEndpoints?.forEach((entry, index) => {
        if (
          entry.match.source !== old.source ||
          entry.match.target !== old.target ||
          entry.match.kind !== old.kind
        )
          return;
        if (
          next?.identity.kind === "authored" &&
          old.identity.kind === "matcher"
        ) {
          const { match: _match, ...settings } = entry;
          metadataEdits.push(
            {
              type: "set",
              path: ["elements", "relationships", "byId", next.identity.id],
              value: settings as import("../core/metadata/types").MetadataValue,
            },
            {
              type: "remove",
              path: ["elements", "relationships", "byEndpoints", index],
            },
          );
          return;
        }
        metadataEdits.push(
          next
            ? {
                type: "set",
                path: [
                  "elements",
                  "relationships",
                  "byEndpoints",
                  index,
                  "match",
                ],
                value: {
                  source: next.source,
                  target: next.target,
                  kind: next.kind,
                },
              }
            : {
                type: "remove",
                path: ["elements", "relationships", "byEndpoints", index],
              },
        );
      });
    }
  }
  const settings = elements?.nodes as
    | Record<
        string,
        { notation?: { type: string; host?: string; attachment?: string } }
      >
    | undefined;
  for (const [id, entry] of Object.entries(settings ?? {})) {
    const notation = entry.notation;
    if (
      notation?.type === "boundary-timer" &&
      (!nodes.some((item) => item.id === notation.host) ||
        !relationships.some(
          (item) =>
            item.identity.kind === "authored" &&
            item.identity.id === notation.attachment &&
            item.source === notation.host &&
            item.target === id,
        ))
    )
      metadataEdits.push({
        type: "remove",
        path: ["elements", "nodes", id, "notation"],
      });
  }
  // Removing a nonexistent path should not create empty front matter.
  const actualEdits = metadataEdits.filter((edit) => {
    let value: unknown = metadata;
    for (const part of edit.path)
      value =
        value && typeof value === "object"
          ? (value as Record<string, unknown>)[part]
          : undefined;
    return edit.type === "set" || value !== undefined;
  });
  const patched = actualEdits.length
    ? patchManateeMetadata(source, actualEdits).source
    : source;
  const front = findFrontMatter(patched);
  const start = front.kind === "present" ? front.block.closing.end : 0;
  const semantic = patched.slice(start);
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const lines: string[] = [
    flow
      ? `${model.family === "swimlane" ? "swimlane-beta" : "flowchart"} ${direction ?? "TD"}`
      : model.family === "c4-context"
        ? "C4Context"
        : "C4Container",
  ];
  // Retain comments and renderer configuration verbatim, including multiline init directives.
  const directives =
    semantic.match(
      /%%\{[\s\S]*?\}%%|%%[^\r\n]*|^\s*(?:accTitle\s*:.*|accDescr\s*:\s*.*|accDescr\s*\{[\s\S]*?\})/gm,
    ) ?? [];
  lines.push(...directives);
  const emit = (parentId: string | undefined, indent: string) => {
    for (const group of groups.filter((item) => item.parentId === parentId)) {
      const originalBoundary =
        new RegExp(
          `(\\w+_Boundary|Boundary)\\s*\\(\\s*${group.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*,`,
          "i",
        ).exec(semantic)?.[1] ?? "System_Boundary";
      lines.push(
        flow
          ? `${indent}subgraph ${group.id}[${quote(group.label)}]`
          : `${indent}${originalBoundary}(${group.id}, ${quote(group.label)}) {`,
      );
      if (flow && group.direction)
        lines.push(`${indent}  direction ${group.direction}`);
      emit(group.id, `${indent}  `);
      lines.push(`${indent}${flow ? "end" : "}"}`);
    }
    for (const node of nodes.filter((item) => item.parentId === parentId)) {
      if (flow) {
        const shape = flowShapes[node.kind];
        if (!shape)
          throw new Error(
            `Visual source editing cannot yet preserve shape ${node.kind}. Change it in Source first.`,
          );
        lines.push(
          `${indent}${node.id}${shape[0]}${quote(node.label)}${shape[1]}`,
        );
      } else {
        const fn = c4Function(node.kind);
        lines.push(
          `${indent}${fn}(${node.id}, ${quote(node.label)}, ${/^Container/i.test(fn) ? `${quote(node.technology ?? "")}, ` : ""}${quote(node.description ?? "")})`,
        );
      }
    }
  };
  emit(undefined, "  ");
  for (const edge of relationships) {
    if (flow) {
      const arrow = arrows[edge.kind];
      if (!arrow)
        throw new Error(
          `Visual source editing cannot preserve connector ${edge.kind}.`,
        );
      lines.push(
        `  ${edge.source} ${edge.identity.kind === "authored" ? `${edge.identity.id}@` : ""}${arrow}${edge.label ? `|${quote(edge.label)}|` : ""} ${edge.target}`,
      );
    } else {
      const fn =
        edge.kind === "birel"
          ? "BiRel"
          : edge.kind === "rel_b"
            ? "Rel_Back"
            : "Rel";
      const suffix =
        edge.directionHint && edge.kind === "rel"
          ? `_${{ LR: "R", RL: "L", TB: "D", TD: "D", BT: "U" }[edge.directionHint]}`
          : "";
      lines.push(
        `  ${fn}${suffix}(${edge.source}, ${edge.target}, ${quote(edge.label)}, ${quote(edge.technology ?? "")}, ${quote(edge.description ?? "")})`,
      );
    }
  }
  if (flow) {
    const styledProperties = new Map<number, Set<string>>();
    // Authored styles can include properties Manatee intentionally does not interpret.
    // Retain them verbatim, remapping numeric edge indexes after deletion.
    for (const line of authoredStatements(semantic)) {
      const trimmed = line.trim();
      if (/^(classDef|style)\s/u.test(trimmed)) {
        if (trimmed.startsWith("style ")) {
          const targets = trimmed
            .split(/\s+/u)[1]!
            .split(",")
            .filter((id) =>
              [...nodes, ...groups, ...relationships].some(
                (item) => item.id === id,
              ),
            );
          if (targets.length)
            lines.push(
              line
                .replace(/^(\s*style\s+)\S+/u, `$1${targets.join(",")}`)
                .replace(/\s*%%[^\n]*$/u, ""),
            );
        } else lines.push(line.replace(/\s*%%[^\n]*$/u, ""));
      }
      const link = /^linkStyle\s+(\S+)\s+(.+)$/u.exec(trimmed);
      if (link) {
        const indexes =
          link[1] === "default"
            ? "default"
            : link[1]!
                .split(",")
                .map(Number)
                .map((index) =>
                  relationships.findIndex(
                    (item) => item.id === model.relationships[index]?.id,
                  ),
                )
                .filter((index) => index >= 0)
                .join(",");
        if (indexes) {
          lines.push(`  linkStyle ${indexes} ${link[2]}`);
          const affected =
            indexes === "default"
              ? relationships.map((_, index) => index)
              : indexes.split(",").map(Number);
          for (const index of affected) {
            const properties = styledProperties.get(index) ?? new Set<string>();
            for (const declaration of link[2]!.split(","))
              properties.add(declaration.split(":")[0]!.trim());
            styledProperties.set(index, properties);
          }
        }
      }
    }
    for (const [index, edge] of relationships.entries()) {
      const declarations = Object.entries(edge.style.declarations)
        .filter(
          ([key]) => key !== "fill" && !styledProperties.get(index)?.has(key),
        )
        .map(([key, value]) => `${key}:${value}`)
        .join(",");
      if (declarations) lines.push(`  linkStyle ${index} ${declarations}`);
    }
    for (const item of [...nodes, ...groups, ...relationships])
      if (item.classes.length)
        lines.push(
          `  class ${"identity" in item && item.identity.kind === "authored" ? item.identity.id : item.id} ${item.classes.join(",")}`,
        );
  } else {
    for (let line of authoredStatements(semantic)) {
      if (!/^\s*(Update\w+|Add\w+)\s*\(/u.test(line)) continue;
      const elementStyle = /^(\s*UpdateElementStyle\s*\(\s*)([^,\s]+)/u.exec(
        line,
      );
      if (
        elementStyle &&
        ![...nodes, ...groups].some((item) => item.id === elementStyle[2])
      )
        continue;
      const relationshipStyle =
        /^(\s*UpdateRelStyle\s*\(\s*)([^,\s]+)\s*,\s*([^,\s]+)/u.exec(line);
      if (relationshipStyle) {
        let from = relationshipStyle[2]!;
        let to = relationshipStyle[3]!;
        const old =
          edit.action === "relationship"
            ? model.relationships.find((item) => item.id === edit.id)
            : undefined;
        if (
          edit.action === "relationship" &&
          old?.source === from &&
          old.target === to
        ) {
          from = edit.source;
          to = edit.target;
          line = line.replace(
            relationshipStyle[0],
            `${relationshipStyle[1]}${from}, ${to}`,
          );
        }
        if (
          !relationships.some(
            (item) => item.source === from && item.target === to,
          )
        )
          continue;
      }
      lines.push(line);
    }
  }

  return patched.slice(0, start) + lines.join(newline) + newline;
}
