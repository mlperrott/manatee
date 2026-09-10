import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkNode } from "elkjs/lib/elk-api";

import type { DocumentDiagnostic } from "../../../core/document/types";
import type {
  MermaidGroup,
  MermaidNode,
  MermaidRelationship,
  MermaidSemanticModel,
} from "../model";
import { nodeSize } from "./measure";
import {
  computedGroupStyle,
  computedNodeStyle,
  computedRelationshipStyle,
  metadataRecord,
} from "./styles";
import type {
  Bounds,
  LayoutGroup,
  LayoutNode,
  LayoutOptions,
  LayoutRelationship,
  LayoutSpacing,
  MermaidScene,
  Point,
} from "./types";

export interface MermaidLayoutRequest {
  readonly model: MermaidSemanticModel;
  readonly metadata: Readonly<Record<string, unknown>> | undefined;
  readonly options?: LayoutOptions;
}

interface MutableBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

let elk: InstanceType<typeof ELK> | undefined;

function elkEngine(): InstanceType<typeof ELK> {
  elk ??=
    typeof Worker === "undefined"
      ? new ELK()
      : new ELK({
          workerUrl: new URL(
            "../../../../node_modules/elkjs/lib/elk-worker.min.js",
            import.meta.url,
          ).href,
          workerFactory: (url) => new globalThis.Worker(url!),
        });
  return elk;
}

function numberSetting(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function spacing(
  metadata: Readonly<Record<string, unknown>> | undefined,
): LayoutSpacing {
  const values = metadataRecord(
    metadataRecord(metadataRecord(metadata).layout).spacing,
  );
  return {
    node: numberSetting(values.node, 48),
    layer: numberSetting(values.layer, 72),
    groupPadding: numberSetting(values.groupPadding, 24),
    lane: numberSetting(values.lane, 32),
  };
}

function layoutDirection(model: MermaidSemanticModel): string {
  if (model.direction) return model.direction;
  const hints = model.relationships
    .map(({ directionHint }) => directionHint)
    .filter((value): value is NonNullable<typeof value> => value !== undefined);
  if (hints.length === 0) return "RIGHT";
  const counts = new Map<string, number>();
  for (const hint of hints) counts.set(hint, (counts.get(hint) ?? 0) + 1);
  return (
    [...counts].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "RIGHT"
  );
}

function elkDirection(direction: string): string {
  if (direction === "BT") return "UP";
  if (direction === "RL") return "LEFT";
  if (direction === "TB" || direction === "TD") return "DOWN";
  return "RIGHT";
}

function buildElkGraph(
  model: MermaidSemanticModel,
  layoutSpacing: LayoutSpacing,
): ElkNode {
  const nodeByParent = new Map<string | undefined, MermaidNode[]>();
  const groupByParent = new Map<string | undefined, MermaidGroup[]>();
  for (const node of model.nodes) {
    const list = nodeByParent.get(node.parentId) ?? [];
    list.push(node);
    nodeByParent.set(node.parentId, list);
  }
  for (const group of model.groups) {
    const list = groupByParent.get(group.parentId) ?? [];
    list.push(group);
    groupByParent.set(group.parentId, list);
  }
  const childrenFor = (parentId: string | undefined): ElkNode[] => [
    ...(groupByParent.get(parentId) ?? []).map((group) => ({
      id: group.id,
      children: childrenFor(group.id),
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": elkDirection(
          group.direction ?? model.direction ?? "LR",
        ),
        "elk.padding": `[top=${layoutSpacing.groupPadding + 28},left=${layoutSpacing.groupPadding},bottom=${layoutSpacing.groupPadding},right=${layoutSpacing.groupPadding}]`,
        "elk.spacing.nodeNode": String(layoutSpacing.node),
        "elk.layered.spacing.nodeNodeBetweenLayers": String(
          layoutSpacing.layer,
        ),
      },
    })),
    ...(nodeByParent.get(parentId) ?? []).map((node) => ({
      id: node.id,
      ...nodeSize(node.label, node.kind),
    })),
  ];
  return {
    id: "manatee-root",
    children: childrenFor(undefined),
    edges: model.relationships.map((relationship, index) => ({
      id: `${relationship.id}-${index}`,
      sources: [relationship.source],
      targets: [relationship.target],
    })),
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": elkDirection(layoutDirection(model)),
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": String(layoutSpacing.node),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(layoutSpacing.layer),
      "elk.spacing.componentComponent": String(layoutSpacing.lane),
      "elk.padding": "[top=24,left=24,bottom=24,right=24]",
    },
  };
}

function collectElkBounds(
  graph: ElkNode,
  result: Map<string, MutableBounds>,
): void {
  for (const child of graph.children ?? []) {
    result.set(child.id, {
      x: child.x ?? 0,
      y: child.y ?? 0,
      width: child.width ?? 120,
      height: child.height ?? 64,
    });
    collectElkBounds(child, result);
  }
}

function positionEntry(
  metadata: Readonly<Record<string, unknown>> | undefined,
  category: "nodes" | "groups" | "lanes",
  id: string,
): Point | undefined {
  const entry = metadataRecord(
    metadataRecord(metadataRecord(metadataRecord(metadata).elements)[category])[
      id
    ],
  );
  const position = metadataRecord(entry.position);
  return typeof position.x === "number" && typeof position.y === "number"
    ? { x: position.x, y: position.y }
    : undefined;
}

function parentChanged(
  id: string,
  parentId: string | undefined,
  previousModel: MermaidSemanticModel | undefined,
  category: "node" | "group",
): boolean {
  if (!previousModel) return false;
  const previous =
    category === "node"
      ? previousModel.nodes.find((candidate) => candidate.id === id)
      : previousModel.groups.find((candidate) => candidate.id === id);
  return previous !== undefined && previous.parentId !== parentId;
}

function overlaps(left: Bounds, right: Bounds, gap: number): boolean {
  return !(
    left.x + left.width + gap <= right.x ||
    right.x + right.width + gap <= left.x ||
    left.y + left.height + gap <= right.y ||
    right.y + right.height + gap <= left.y
  );
}

function resolveAutomaticCollisions(
  nodes: LayoutNode[],
  diagnostics: DocumentDiagnostic[],
  nodeSpacing: number,
): LayoutNode[] {
  const result: LayoutNode[] = [];
  for (const original of [...nodes].sort(
    (a, b) => Number(b.manual) - Number(a.manual),
  )) {
    let node = original;
    if (!node.manual) {
      let attempts = 0;
      while (
        result.some(
          (other) =>
            other.parentId === node.parentId && overlaps(node, other, 8),
        ) &&
        attempts < 100
      ) {
        node = { ...node, x: node.x + node.width + nodeSpacing };
        attempts += 1;
      }
    }
    if (
      result.some(
        (other) => other.parentId === node.parentId && overlaps(node, other, 0),
      )
    ) {
      diagnostics.push({
        code: "layout.overlap.unresolved",
        message: `Manual position for ${node.id} overlaps another element.`,
        severity: "warning",
        path: `presentation.elements.nodes.${node.id}.position`,
      });
    }
    result.push(node);
  }
  return result;
}

function expandGroups(
  initialGroups: readonly LayoutGroup[],
  nodes: readonly LayoutNode[],
): LayoutGroup[] {
  const groups = new Map(initialGroups.map((group) => [group.id, group]));
  const depth = (group: LayoutGroup): number => {
    let value = 0;
    let parentId = group.parentId;
    while (parentId) {
      value += 1;
      parentId = groups.get(parentId)?.parentId;
    }
    return value;
  };
  for (const group of [...initialGroups].sort((a, b) => depth(b) - depth(a))) {
    const children: readonly Bounds[] = [
      ...nodes.filter(({ parentId }) => parentId === group.id),
      ...[...groups.values()].filter(({ parentId }) => parentId === group.id),
    ];
    const right = Math.max(
      group.x + group.width,
      ...children.map((child) => child.x + child.width + group.padding),
    );
    const bottom = Math.max(
      group.y + group.height,
      ...children.map((child) => child.y + child.height + group.padding),
    );
    groups.set(group.id, {
      ...group,
      width: right - group.x,
      height: bottom - group.y,
    });
  }
  return initialGroups.map((group) => groups.get(group.id) ?? group);
}

function absoluteBounds(
  local: ReadonlyMap<string, MutableBounds>,
  parentById: ReadonlyMap<string, string | undefined>,
  id: string,
  cache: Map<string, MutableBounds>,
): MutableBounds {
  const cached = cache.get(id);
  if (cached) return cached;
  const own = local.get(id) ?? { x: 0, y: 0, width: 120, height: 64 };
  const parentId = parentById.get(id);
  const parent = parentId
    ? absoluteBounds(local, parentById, parentId, cache)
    : undefined;
  const absolute = {
    ...own,
    x: own.x + (parent?.x ?? 0),
    y: own.y + (parent?.y ?? 0),
  };
  cache.set(id, absolute);
  return absolute;
}

function route(source: Bounds, target: Bounds): Point[] {
  const sourceCenter = {
    x: source.x + source.width / 2,
    y: source.y + source.height / 2,
  };
  const targetCenter = {
    x: target.x + target.width / 2,
    y: target.y + target.height / 2,
  };
  if (
    Math.abs(targetCenter.x - sourceCenter.x) >=
    Math.abs(targetCenter.y - sourceCenter.y)
  ) {
    const forward = targetCenter.x >= sourceCenter.x;
    const start = {
      x: forward ? source.x + source.width : source.x,
      y: sourceCenter.y,
    };
    const end = {
      x: forward ? target.x : target.x + target.width,
      y: targetCenter.y,
    };
    const middleX = (start.x + end.x) / 2;
    return [start, { x: middleX, y: start.y }, { x: middleX, y: end.y }, end];
  }
  const forward = targetCenter.y >= sourceCenter.y;
  const start = {
    x: sourceCenter.x,
    y: forward ? source.y + source.height : source.y,
  };
  const end = {
    x: targetCenter.x,
    y: forward ? target.y : target.y + target.height,
  };
  const middleY = (start.y + end.y) / 2;
  return [start, { x: start.x, y: middleY }, { x: end.x, y: middleY }, end];
}

function relationshipMetadata(
  relationship: MermaidRelationship,
  metadata: Readonly<Record<string, unknown>> | undefined,
): unknown {
  const relationships = metadataRecord(
    metadataRecord(metadataRecord(metadata).elements).relationships,
  );
  if (relationship.identity.kind === "authored") {
    return metadataRecord(relationships.byId)[relationship.identity.id];
  }
  if (
    relationship.identity.kind === "matcher" &&
    Array.isArray(relationships.byEndpoints)
  ) {
    return relationships.byEndpoints.find((candidate) => {
      const match = metadataRecord(metadataRecord(candidate).match);
      return (
        match.source === relationship.source &&
        match.target === relationship.target &&
        match.kind === relationship.kind
      );
    });
  }
  return;
}

export async function computeMermaidScene(
  request: MermaidLayoutRequest,
): Promise<MermaidScene> {
  const { model, metadata } = request;
  const options = request.options ?? {};
  const layoutSpacing = spacing(metadata);
  const laidOut = await elkEngine().layout(buildElkGraph(model, layoutSpacing));
  const local = new Map<string, MutableBounds>();
  collectElkBounds(laidOut, local);
  const parentById = new Map<string, string | undefined>();
  for (const group of model.groups) parentById.set(group.id, group.parentId);
  for (const node of model.nodes) parentById.set(node.id, node.parentId);

  const manualNodeIds = new Set<string>();
  for (const node of model.nodes) {
    const position = options.reset
      ? undefined
      : positionEntry(metadata, "nodes", node.id);
    if (
      position &&
      !parentChanged(node.id, node.parentId, options.previousModel, "node")
    ) {
      const bounds = local.get(node.id);
      if (bounds) {
        bounds.x =
          position.x + (node.parentId ? layoutSpacing.groupPadding : 0);
        bounds.y =
          position.y + (node.parentId ? layoutSpacing.groupPadding + 28 : 0);
        manualNodeIds.add(node.id);
      }
    }
  }
  for (const group of model.groups) {
    const category = group.kind === "lane" ? "lanes" : "groups";
    const position = options.reset
      ? undefined
      : positionEntry(metadata, category, group.id);
    if (
      position &&
      !parentChanged(group.id, group.parentId, options.previousModel, "group")
    ) {
      const bounds = local.get(group.id);
      if (bounds) {
        bounds.x =
          position.x + (group.parentId ? layoutSpacing.groupPadding : 0);
        bounds.y =
          position.y + (group.parentId ? layoutSpacing.groupPadding + 28 : 0);
      }
    }
  }

  const absolute = new Map<string, MutableBounds>();
  const diagnostics = [...model.diagnostics];
  const nodes = resolveAutomaticCollisions(
    model.nodes.map((node) => ({
      id: node.id,
      label: node.label,
      kind: node.kind,
      parentId: node.parentId,
      manual: manualNodeIds.has(node.id),
      ...absoluteBounds(local, parentById, node.id, absolute),
      style: computedNodeStyle(model, node, metadata),
    })),
    diagnostics,
    layoutSpacing.node,
  );
  const groups = expandGroups(
    model.groups.map((group) => ({
      id: group.id,
      label: group.label,
      kind: group.kind,
      parentId: group.parentId,
      padding: layoutSpacing.groupPadding,
      ...absoluteBounds(local, parentById, group.id, absolute),
      style: computedGroupStyle(group.kind, group.id, metadata),
    })),
    nodes,
  );
  const elementById = new Map<string, Bounds>([
    ...nodes.map((node) => [node.id, node] as const),
    ...groups.map((group) => [group.id, group] as const),
  ]);
  const relationships: LayoutRelationship[] = model.relationships.flatMap(
    (relationship) => {
      const source = elementById.get(relationship.source);
      const target = elementById.get(relationship.target);
      if (!source || !target) return [];
      return [
        {
          id: relationship.id,
          source: relationship.source,
          target: relationship.target,
          kind: relationship.kind,
          label: relationship.label,
          points: Object.freeze(route(source, target)),
          style: computedRelationshipStyle(
            relationshipMetadata(relationship, metadata),
            relationship.style,
          ),
        },
      ];
    },
  );
  const allBounds = [...nodes, ...groups];
  const width = Math.ceil(
    Math.max(320, ...allBounds.map((item) => item.x + item.width + 24)),
  );
  const height = Math.ceil(
    Math.max(200, ...allBounds.map((item) => item.y + item.height + 24)),
  );
  return Object.freeze({
    width,
    height,
    nodes: Object.freeze(nodes),
    groups: Object.freeze(groups),
    relationships: Object.freeze(relationships),
    diagnostics: Object.freeze(diagnostics),
    sourceModel: model,
  });
}

export function rerouteMermaidScene(scene: MermaidScene): MermaidScene {
  const elementById = new Map<string, Bounds>([
    ...scene.nodes.map((node) => [node.id, node] as const),
    ...scene.groups.map((group) => [group.id, group] as const),
  ]);
  return Object.freeze({
    ...scene,
    relationships: Object.freeze(
      scene.relationships.map((relationship) => {
        const source = elementById.get(relationship.source);
        const target = elementById.get(relationship.target);
        return source && target
          ? { ...relationship, points: Object.freeze(route(source, target)) }
          : relationship;
      }),
    ),
  });
}
