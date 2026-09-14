import { route } from "./routing";
import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkNode } from "elkjs/lib/elk-api";

import type { DocumentDiagnostic } from "../../core/document/types";
import type {
  MermaidGroup,
  MermaidNode,
  MermaidRelationship,
  MermaidSemanticModel,
} from "../model";
import {
  contentOrigin,
  processContainerHeader,
  CONTAINER_TOP_HEADER,
} from "./geometry";
import {
  processNodeVisualBounds,
  nodeLabelBounds,
  groupLabelBounds,
  unionBounds,
  placeRelationshipLabels,
} from "./labels";
import { nodeSize } from "./measure";
import {
  computedGroupStyle,
  computedNodeStyle,
  computedRelationshipStyle,
  metadataRecord,
} from "./styles";
import {
  boundaryTimerNotation,
  attachedBoundaryTimer,
  groupNotation,
  nodeNotation,
  relationshipNotation,
} from "../notation";
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
            "../../../node_modules/elkjs/lib/elk-worker.min.js",
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

function layoutNode(
  model: MermaidSemanticModel,
  node: MermaidNode,
  metadata: Readonly<Record<string, unknown>> | undefined,
): LayoutNode {
  const notation = nodeNotation(metadata, node.id);
  return {
    id: node.id,
    label: node.label,
    kind: node.kind,
    notation,
    parentId: node.parentId,
    manual: false,
    x: 0,
    y: 0,
    ...nodeSize(node.label, node.kind, notation),
    style: computedNodeStyle(model, node, metadata),
  };
}

function reservedNodeBounds(
  model: MermaidSemanticModel,
  node: MermaidNode,
  metadata: Readonly<Record<string, unknown>> | undefined,
): Bounds {
  const host = layoutNode(model, node, metadata);
  const timers = model.nodes.flatMap((timer) => {
    const notation = attachedBoundaryTimer(model, metadata, timer.id);
    return notation?.host === node.id
      ? [
          processNodeVisualBounds(
            attachToHost(
              layoutNode(model, timer, metadata),
              host,
              notation.anchor.side,
              notation.anchor.offset,
            ),
          ),
        ]
      : [];
  });
  return unionBounds([processNodeVisualBounds(host), ...timers]);
}

function buildElkGraph(
  model: MermaidSemanticModel,
  layoutSpacing: LayoutSpacing,
  metadata: Readonly<Record<string, unknown>> | undefined,
): ElkNode {
  const attachedTimerIds = new Set(
    model.nodes.flatMap((node) =>
      attachedBoundaryTimer(model, metadata, node.id) ? [node.id] : [],
    ),
  );
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
    ...(groupByParent.get(parentId) ?? []).map((group) => {
      const header = processContainerHeader(
        groupNotation(
          metadata,
          group.kind === "lane" ? "lanes" : "groups",
          group.id,
        ),
      );
      return {
        id: group.id,
        children: childrenFor(group.id),
        layoutOptions: {
          "elk.algorithm": "layered",
          "elk.direction": elkDirection(
            group.direction ?? model.direction ?? "LR",
          ),
          "elk.padding": `[top=${layoutSpacing.groupPadding + CONTAINER_TOP_HEADER},left=${layoutSpacing.groupPadding + header},bottom=${layoutSpacing.groupPadding},right=${layoutSpacing.groupPadding}]`,
          "elk.spacing.nodeNode": String(layoutSpacing.node),
          "elk.layered.spacing.nodeNodeBetweenLayers": String(
            layoutSpacing.layer,
          ),
        },
      };
    }),
    ...(nodeByParent.get(parentId) ?? [])
      .filter((node) => !attachedTimerIds.has(node.id))
      .map((node) => {
        const reserved = reservedNodeBounds(model, node, metadata);
        return { id: node.id, width: reserved.width, height: reserved.height };
      }),
  ];
  return {
    id: "manatee-root",
    children: childrenFor(undefined),
    edges: model.relationships
      .filter(
        ({ source, target }) =>
          !attachedTimerIds.has(source) && !attachedTimerIds.has(target),
      )
      .map((relationship, index) => ({
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
  attachedTimerIds: ReadonlySet<string>,
): LayoutNode[] {
  const result: LayoutNode[] = [];
  for (const original of [...nodes].sort(
    (a, b) => Number(b.manual) - Number(a.manual),
  )) {
    let node = original;
    if (attachedTimerIds.has(node.id)) {
      result.push(node);
      continue;
    }
    if (!node.manual) {
      let attempts = 0;
      while (
        result.some(
          (other) =>
            other.parentId === node.parentId &&
            !attachedTimerIds.has(other.id) &&
            overlaps(
              processNodeVisualBounds(node),
              processNodeVisualBounds(other),
              8,
            ),
        ) &&
        attempts < 100
      ) {
        node = { ...node, x: node.x + node.width + nodeSpacing };
        attempts += 1;
      }
    }
    if (
      result.some(
        (other) =>
          other.parentId === node.parentId &&
          !attachedTimerIds.has(other.id) &&
          overlaps(
            processNodeVisualBounds(node),
            processNodeVisualBounds(other),
            0,
          ),
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
      ...nodes
        .filter(({ parentId }) => parentId === group.id)
        .map(processNodeVisualBounds),
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

function attachToHost(
  timer: LayoutNode,
  host: LayoutNode,
  side: "top" | "right" | "bottom" | "left",
  offset: number,
): LayoutNode {
  if (side === "top" || side === "bottom") {
    return {
      ...timer,
      x: host.x + host.width * offset - timer.width / 2,
      y:
        side === "top"
          ? host.y - timer.height / 2
          : host.y + host.height - timer.height / 2,
    };
  }
  return {
    ...timer,
    x:
      side === "left"
        ? host.x - timer.width / 2
        : host.x + host.width - timer.width / 2,
    y: host.y + host.height * offset - timer.height / 2,
  };
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
  const laidOut = await elkEngine().layout(
    buildElkGraph(model, layoutSpacing, metadata),
  );
  const local = new Map<string, MutableBounds>();
  collectElkBounds(laidOut, local);
  for (const node of model.nodes) {
    const bounds = local.get(node.id);
    if (!bounds) continue;
    const reserved = reservedNodeBounds(model, node, metadata);
    const actual = layoutNode(model, node, metadata);
    local.set(node.id, {
      x: bounds.x - reserved.x,
      y: bounds.y - reserved.y,
      width: actual.width,
      height: actual.height,
    });
  }
  for (const node of model.nodes) {
    if (!attachedBoundaryTimer(model, metadata, node.id)) continue;
    local.set(node.id, {
      x: 0,
      y: 0,
      ...nodeSize(node.label, node.kind, "boundary-timer"),
    });
  }
  const parentById = new Map<string, string | undefined>();
  for (const group of model.groups) parentById.set(group.id, group.parentId);
  for (const node of model.nodes) parentById.set(node.id, node.parentId);

  const manualNodeIds = new Set<string>();
  for (const node of model.nodes) {
    if (attachedBoundaryTimer(model, metadata, node.id)) continue;
    const position = options.reset
      ? undefined
      : positionEntry(metadata, "nodes", node.id);
    if (
      position &&
      !parentChanged(node.id, node.parentId, options.previousModel, "node")
    ) {
      const bounds = local.get(node.id);
      if (bounds) {
        const parent = node.parentId
          ? model.groups.find(({ id }) => id === node.parentId)
          : undefined;
        const origin = contentOrigin(
          parent
            ? {
                x: 0,
                y: 0,
                padding: layoutSpacing.groupPadding,
                notation: groupNotation(
                  metadata,
                  parent.kind === "lane" ? "lanes" : "groups",
                  parent.id,
                ),
              }
            : undefined,
          true,
        );
        bounds.x = position.x + origin.x;
        bounds.y = position.y + origin.y;
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
        const origin = contentOrigin(
          group.parentId
            ? {
                x: 0,
                y: 0,
                padding: layoutSpacing.groupPadding,
                notation: undefined,
              }
            : undefined,
          false,
        );
        bounds.x = position.x + origin.x;
        bounds.y = position.y + origin.y;
      }
    }
  }

  const absolute = new Map<string, MutableBounds>();
  const diagnostics = [...model.diagnostics];
  const laidOutNodes = resolveAutomaticCollisions(
    model.nodes.map((node) => ({
      id: node.id,
      label: node.label,
      kind: node.kind,
      notation: nodeNotation(metadata, node.id),
      parentId: node.parentId,
      manual: manualNodeIds.has(node.id),
      ...absoluteBounds(local, parentById, node.id, absolute),
      style: computedNodeStyle(model, node, metadata),
    })),
    diagnostics,
    layoutSpacing.node,
    new Set(
      model.nodes
        .filter((node) => attachedBoundaryTimer(model, metadata, node.id))
        .map((node) => node.id),
    ),
  );
  const boundaryAttachments = new Map<string, string>();
  for (const node of laidOutNodes) {
    if (node.notation !== "boundary-timer") continue;
    const notation = attachedBoundaryTimer(model, metadata, node.id);
    const attachment = notation
      ? model.relationships.find(
          ({ identity }) =>
            identity.kind === "authored" && identity.id === notation.attachment,
        )
      : undefined;
    const host = notation
      ? laidOutNodes.find(({ id }) => id === notation.host)
      : undefined;
    if (
      attachment &&
      host &&
      attachment.source === host.id &&
      attachment.target === node.id
    ) {
      boundaryAttachments.set(node.id, attachment.id);
    }
  }
  const nodes = laidOutNodes.map((node) => {
    const attachmentId = boundaryAttachments.get(node.id);
    const attachment = attachmentId
      ? model.relationships.find(({ id }) => id === attachmentId)
      : undefined;
    const host = attachment
      ? laidOutNodes.find(({ id }) => id === attachment.source)
      : undefined;
    const notation = boundaryTimerNotation(metadata, node.id);
    return host && notation
      ? attachToHost(node, host, notation.anchor.side, notation.anchor.offset)
      : node;
  });
  const groups = expandGroups(
    model.groups.map((group) => ({
      id: group.id,
      label: group.label,
      kind: group.kind,
      notation: groupNotation(
        metadata,
        group.kind === "lane" ? "lanes" : "groups",
        group.id,
      ),
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
  const obstacles = nodes.some((node) => node.notation)
    ? [...nodes, ...nodes.map(nodeLabelBounds), ...groups.map(groupLabelBounds)]
    : [];
  const relationships: LayoutRelationship[] = model.relationships.flatMap(
    (relationship) => {
      if (boundaryAttachments.get(relationship.target) === relationship.id) {
        return [];
      }
      const source = elementById.get(relationship.source);
      const target = elementById.get(relationship.target);
      if (!source || !target) return [];
      return [
        {
          id: relationship.id,
          source: relationship.source,
          target: relationship.target,
          kind: relationship.kind,
          notation: relationshipNotation(metadata, relationship),
          label: relationship.label,
          points: Object.freeze(route(source, target, obstacles)),
          style: computedRelationshipStyle(
            relationshipMetadata(relationship, metadata),
            relationship.style,
          ),
        },
      ];
    },
  );
  const labeledRelationships = placeRelationshipLabels(
    relationships,
    nodes,
    groups,
  );
  const allBounds = [
    ...nodes.map(processNodeVisualBounds),
    ...groups,
    ...labeledRelationships.flatMap((edge) =>
      edge.labelBounds ? [edge.labelBounds] : [],
    ),
  ];
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
    relationships: Object.freeze(labeledRelationships),
    diagnostics: Object.freeze(diagnostics),
    sourceModel: model,
  });
}

export function rerouteMermaidScene(scene: MermaidScene): MermaidScene {
  const elementById = new Map<string, Bounds>([
    ...scene.nodes.map((node) => [node.id, node] as const),
    ...scene.groups.map((group) => [group.id, group] as const),
  ]);
  const obstacles = scene.nodes.some((node) => node.notation)
    ? [
        ...scene.nodes,
        ...scene.nodes.map(nodeLabelBounds),
        ...scene.groups.map(groupLabelBounds),
      ]
    : [];
  const relationships = placeRelationshipLabels(
    scene.relationships.map((relationship) => {
      const source = elementById.get(relationship.source);
      const target = elementById.get(relationship.target);
      return source && target
        ? {
            ...relationship,
            points: Object.freeze(route(source, target, obstacles)),
          }
        : relationship;
    }),
    scene.nodes,
    scene.groups,
  );
  return Object.freeze({
    ...scene,
    width: Math.ceil(
      Math.max(
        scene.width,
        ...relationships.flatMap((edge) =>
          edge.labelBounds
            ? [edge.labelBounds.x + edge.labelBounds.width + 24]
            : [],
        ),
      ),
    ),
    height: Math.ceil(
      Math.max(
        scene.height,
        ...relationships.flatMap((edge) =>
          edge.labelBounds
            ? [edge.labelBounds.y + edge.labelBounds.height + 24]
            : [],
        ),
      ),
    ),
    relationships: Object.freeze(relationships),
  });
}

export function moveMermaidScene(
  scene: MermaidScene,
  elementId: string,
  dx: number,
  dy: number,
  boundaryTimerHosts: ReadonlyMap<string, string> = new Map(),
): MermaidScene {
  const movedGroups = new Set<string>();
  if (scene.groups.some(({ id }) => id === elementId)) {
    movedGroups.add(elementId);
    let changed = true;
    while (changed) {
      changed = false;
      for (const group of scene.groups) {
        if (
          group.parentId &&
          movedGroups.has(group.parentId) &&
          !movedGroups.has(group.id)
        ) {
          movedGroups.add(group.id);
          changed = true;
        }
      }
    }
  }

  const movedNodes = new Set(
    scene.nodes
      .filter(
        (node) =>
          node.id === elementId ||
          (node.parentId !== undefined && movedGroups.has(node.parentId)),
      )
      .map(({ id }) => id),
  );
  for (const [timerId, hostId] of boundaryTimerHosts) {
    if (movedNodes.has(hostId)) movedNodes.add(timerId);
  }

  const nodes = scene.nodes.map((node) =>
    movedNodes.has(node.id)
      ? Object.freeze({
          ...node,
          x: node.x + dx,
          y: node.y + dy,
          manual: node.id === elementId ? true : node.manual,
        })
      : node,
  );
  const groups = expandGroups(
    scene.groups.map((group) =>
      movedGroups.has(group.id)
        ? Object.freeze({
            ...group,
            x: group.x + dx,
            y: group.y + dy,
          })
        : group,
    ),
    nodes,
  );
  const allBounds = [...nodes.map(processNodeVisualBounds), ...groups];
  return rerouteMermaidScene(
    Object.freeze({
      ...scene,
      width: Math.ceil(
        Math.max(320, ...allBounds.map((item) => item.x + item.width + 24)),
      ),
      height: Math.ceil(
        Math.max(200, ...allBounds.map((item) => item.y + item.height + 24)),
      ),
      nodes: Object.freeze(nodes),
      groups: Object.freeze(groups),
    }),
  );
}
