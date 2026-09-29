import { createEffect, createSignal, onSettled, Show } from "solid-js";
import type {
  Bounds,
  LayoutRelationship,
  MermaidScene,
  Point,
} from "../mermaid/layout/types";
import type {
  ConnectionDock,
  ConnectionEndpoint,
  Arrangement,
} from "../core/document/commands";
import { normalizeRoutePoints, route } from "../mermaid/layout/routing";
import {
  expandedMovements,
  selectionMovements,
} from "../mermaid/layout/selection";

export interface MermaidSurfaceProps {
  readonly svg: string;
  readonly scene: MermaidScene | undefined;
  readonly viewport: Bounds;
  readonly width: number;
  readonly height: number;
  readonly zoom: number;
  readonly fitView: boolean;
  readonly onZoom: (zoom: number) => void;
  readonly disabled: boolean;
  readonly selectedElementId: string | undefined;
  readonly selectedElementIds: readonly string[];
  readonly boundaryTimerHosts: ReadonlyMap<string, string>;
  readonly onSelectElements: (
    ids: readonly string[],
    primary: string | undefined,
  ) => void;
  readonly onMoveElements: (
    ids: readonly string[],
    dx: number,
    dy: number,
  ) => void;
  readonly onArrange: (arrangement: Arrangement) => void;
  readonly onSelect: (elementId: string | undefined) => void;
  readonly onNudge: (elementId: string, dx: number, dy: number) => void;
  readonly sourceEditing: boolean;
  readonly actionBarVisible: boolean;
  readonly onSetDock: (
    relationshipId: string,
    endpoint: ConnectionEndpoint,
    dock: ConnectionDock,
  ) => void;
  readonly onReconnect: (
    relationshipId: string,
    endpoint: ConnectionEndpoint,
    nodeId: string,
  ) => void;
  readonly onSetRoute: (
    relationshipId: string,
    waypoints: readonly Point[],
  ) => void;
  readonly onResetRoute: (relationshipId: string) => void;
  readonly placementMode: boolean;
  readonly onArmPlacement: () => void;
  readonly onCancelInteraction: () => void;
  readonly onPlaceNode: (point: Point) => void;
  readonly onQuickAdd: (
    sourceId: string,
    direction: CanvasDirection,
    point?: Point,
  ) => void;
  readonly onConnectNodes: (sourceId: string, targetId: string) => void;
  readonly onRequestSourceEditing: () => void;
  readonly onEditLabel: (elementId: string) => void;
  readonly onDuplicate: (nodeId: string) => void;
  readonly onDelete: (elementId: string) => void;
  readonly onChangeKind: (elementId: string, kind: string) => void;
  readonly onOpenInspector: () => void;
  readonly nodeKinds: readonly {
    readonly value: string;
    readonly label: string;
  }[];
  readonly connectionKinds: readonly {
    readonly value: string;
    readonly label: string;
  }[];
  readonly draft:
    | {
        readonly point: Point;
        readonly label: string;
        readonly sourceId?: string;
      }
    | undefined;
  readonly onChangeDraftLabel: (value: string) => void;
  readonly onCommitDraft: () => void;
  readonly onCancelDraft: () => void;
}

export type CanvasDirection = "top" | "right" | "bottom" | "left";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const dockSides = ["top", "right", "bottom", "left"] as const;

function pointInBounds(point: Point, bounds: Bounds): boolean {
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  );
}

function connectionTarget(
  scene: MermaidScene | undefined,
  sourceId: string,
  point: Point,
) {
  return scene?.nodes.find(
    (node) => node.id !== sourceId && pointInBounds(point, node),
  );
}

function renderConnectionDraft(
  container: HTMLDivElement | undefined,
  scene: MermaidScene | undefined,
  sourceId: string,
  direction: CanvasDirection,
  point: Point,
  targetId: string | undefined,
) {
  const source = scene?.nodes.find((node) => node.id === sourceId);
  const overlay = interactionOverlay(container);
  if (!scene || !source || !overlay) return;
  const start = dockPoint(source, direction);
  const line = svgElement("path");
  line.setAttribute("class", "connection-create-preview");
  line.setAttribute("d", `M ${start.x} ${start.y} L ${point.x} ${point.y}`);
  overlay.append(line);
  for (const node of scene.nodes) {
    if (node.id === sourceId) continue;
    const rect = svgElement("rect");
    rect.setAttribute("class", "connection-create-target");
    if (node.id === targetId) rect.classList.add("is-active");
    rect.dataset.nodeId = node.id;
    rect.setAttribute("x", String(node.x));
    rect.setAttribute("y", String(node.y));
    rect.setAttribute("width", String(node.width));
    rect.setAttribute("height", String(node.height));
    rect.setAttribute("rx", "8");
    overlay.append(rect);
  }
}

function svgElement<K extends keyof SVGElementTagNameMap>(
  name: K,
): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NAMESPACE, name);
}

function svgRoot(
  container: HTMLDivElement | undefined,
): SVGSVGElement | undefined {
  return (
    container?.querySelector<SVGSVGElement>("svg[data-manatee-renderer]") ??
    undefined
  );
}

function clearInteractionOverlay(container: HTMLDivElement | undefined) {
  svgRoot(container)?.querySelector("[data-interaction-overlay]")?.remove();
}

function interactionOverlay(
  container: HTMLDivElement | undefined,
): SVGGElement | undefined {
  const root = svgRoot(container);
  if (!root) return;
  clearInteractionOverlay(container);
  const group = svgElement("g");
  group.dataset.interactionOverlay = "true";
  group.setAttribute("pointer-events", "none");
  root.append(group);
  return group;
}

function diagramPoint(
  container: HTMLDivElement | undefined,
  clientX: number,
  clientY: number,
): Point | undefined {
  const root = svgRoot(container);
  if (!root) return;
  const matrix = root.getScreenCTM();
  if (matrix) {
    const point = root.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const transformed = point.matrixTransform(matrix.inverse());
    return { x: transformed.x, y: transformed.y };
  }
  const rect = root.getBoundingClientRect();
  const viewBox = root.viewBox.baseVal;
  if (rect.width <= 0 || rect.height <= 0) return;
  return {
    x: viewBox.x + ((clientX - rect.left) / rect.width) * viewBox.width,
    y: viewBox.y + ((clientY - rect.top) / rect.height) * viewBox.height,
  };
}

function dockPoint(bounds: Bounds, side: ConnectionDock): Point {
  if (side === "top") return { x: bounds.x + bounds.width / 2, y: bounds.y };
  if (side === "right")
    return { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2 };
  if (side === "bottom")
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height };
  return { x: bounds.x, y: bounds.y + bounds.height / 2 };
}

function elementId(target: EventTarget | null): string | undefined {
  return target instanceof Element
    ? target.closest<SVGElement>("[data-element-id]")?.dataset.elementId
    : undefined;
}

function elementGroup(target: EventTarget | null): SVGElement | undefined {
  return target instanceof Element
    ? (target.closest<SVGElement>("[data-element-id]") ?? undefined)
    : undefined;
}

function movable(group: SVGElement | undefined): boolean {
  return Boolean(
    group?.classList.contains("node") || group?.classList.contains("group"),
  );
}

function navigationItems(scene: MermaidScene | undefined) {
  if (!scene) return [];
  const groups = scene.sourceModel.groups.map((item) => ({
    id: item.id,
    label: item.label,
    type: item.kind === "lane" ? "lane" : "group",
  }));
  const nodes = scene.sourceModel.nodes.map((item) => ({
    id: item.id,
    label: item.label,
    type: "node",
  }));
  const relationships = scene.sourceModel.relationships.map((item) => ({
    id: item.id,
    label: item.label || `${item.source} to ${item.target}`,
    type: "connection",
  }));
  return [...groups, ...nodes, ...relationships];
}

interface RelationshipPreview {
  readonly relationship: LayoutRelationship;
  readonly paths: readonly SVGPathElement[];
  readonly originalPaths: readonly (string | null)[];
  readonly label: SVGTextElement | undefined;
  readonly originalLabelTransform: string | null;
  readonly startCircle: SVGCircleElement | undefined;
  readonly originalCircleX: string | null;
  readonly originalCircleY: string | null;
  readonly handles: readonly SVGCircleElement[];
  readonly originalHandleX: readonly (string | null)[];
  readonly originalHandleY: readonly (string | null)[];
  readonly sourceMoves: boolean;
  readonly targetMoves: boolean;
}

function path(points: readonly Point[]): string {
  return points
    .map(({ x, y }, index) => `${index === 0 ? "M" : "L"} ${x} ${y}`)
    .join(" ");
}

function midpoint(points: readonly Point[]): Point {
  const index = Math.max(0, Math.floor((points.length - 1) / 2));
  const left = points[index] ?? { x: 0, y: 0 };
  const right = points[index + 1] ?? left;
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
}

function previewPoints(
  points: readonly Point[],
  sourceMoves: boolean,
  targetMoves: boolean,
  dx: number,
  dy: number,
): Point[] {
  if (sourceMoves && targetMoves)
    return points.map(({ x, y }) => ({ x: x + dx, y: y + dy }));
  const preview = points.map(({ x, y }) => ({ x, y }));
  if (preview.length < 2) return preview;
  if (preview.length === 2) {
    const start = preview[0]!;
    const end = preview[1]!;
    if (sourceMoves) {
      start.x += dx;
      start.y += dy;
    }
    if (targetMoves) {
      end.x += dx;
      end.y += dy;
    }
    const horizontal =
      Math.abs(points[1]!.x - points[0]!.x) >=
      Math.abs(points[1]!.y - points[0]!.y);
    return [
      start,
      horizontal ? { x: end.x, y: start.y } : { x: start.x, y: end.y },
      end,
    ];
  }
  if (sourceMoves) {
    preview[0]!.x += dx;
    preview[0]!.y += dy;
    if (points[0]!.y === points[1]!.y) preview[1]!.y += dy;
    else if (points[0]!.x === points[1]!.x) preview[1]!.x += dx;
  }
  if (targetMoves) {
    const last = preview.length - 1;
    preview[last]!.x += dx;
    preview[last]!.y += dy;
    if (points[last]!.y === points[last - 1]!.y) preview[last - 1]!.y += dy;
    else if (points[last]!.x === points[last - 1]!.x)
      preview[last - 1]!.x += dx;
  }
  return preview;
}

function relationshipPreviews(
  scene: MermaidScene | undefined,
  container: HTMLDivElement | undefined,
  ids: ReadonlySet<string>,
): RelationshipPreview[] {
  if (!scene || !container || ids.size === 0) return [];
  const groups = new Map(
    [...container.querySelectorAll<SVGGElement>("g.relationship")].map(
      (group) => [group.dataset.elementId, group],
    ),
  );
  const endpointGroups = new Map(
    [...container.querySelectorAll<SVGGElement>("g.connection-endpoints")].map(
      (group) => [group.dataset.elementId, group],
    ),
  );
  return scene.relationships.flatMap((relationship) => {
    const sourceMoves = ids.has(relationship.source);
    const targetMoves = ids.has(relationship.target);
    const group = groups.get(relationship.id);
    if ((!sourceMoves && !targetMoves) || !group) return [];
    const children = [...group.children];
    const paths = children.filter(
      (child): child is SVGPathElement => child instanceof SVGPathElement,
    );
    const label = children.find(
      (child): child is SVGTextElement =>
        child instanceof SVGTextElement &&
        child.classList.contains("relationship-label"),
    );
    const startCircle = children.find(
      (child): child is SVGCircleElement =>
        child instanceof SVGCircleElement &&
        child.classList.contains("message-flow-start"),
    );
    const handles = [
      ...(endpointGroups.get(relationship.id)?.children ?? []),
    ].filter(
      (child): child is SVGCircleElement =>
        child instanceof SVGCircleElement &&
        child.classList.contains("connection-endpoint-handle"),
    );
    return [
      {
        relationship,
        paths,
        originalPaths: paths.map((item) => item.getAttribute("d")),
        label,
        originalLabelTransform: label?.getAttribute("transform") ?? null,
        startCircle,
        originalCircleX: startCircle?.getAttribute("cx") ?? null,
        originalCircleY: startCircle?.getAttribute("cy") ?? null,
        handles,
        originalHandleX: handles.map((item) => item.getAttribute("cx")),
        originalHandleY: handles.map((item) => item.getAttribute("cy")),
        sourceMoves,
        targetMoves,
      },
    ];
  });
}

function restoreAttribute(
  element: Element,
  name: string,
  original: string | null,
) {
  if (original === null) element.removeAttribute(name);
  else element.setAttribute(name, original);
}

function updateRelationshipPreview(
  preview: RelationshipPreview,
  dx: number,
  dy: number,
) {
  const points = previewPoints(
    preview.relationship.points,
    preview.sourceMoves,
    preview.targetMoves,
    dx,
    dy,
  );
  const d = path(points);
  for (const item of preview.paths) item.setAttribute("d", d);
  if (preview.label) {
    const before = midpoint(preview.relationship.points);
    const after = midpoint(points);
    preview.label.setAttribute(
      "transform",
      `translate(${after.x - before.x} ${after.y - before.y})`,
    );
  }
  if (preview.sourceMoves && preview.startCircle && points[0]) {
    preview.startCircle.setAttribute("cx", String(points[0].x));
    preview.startCircle.setAttribute("cy", String(points[0].y));
  }
  for (const handle of preview.handles) {
    const endpoint = handle.dataset.endpoint;
    const point = endpoint === "source" ? points[0] : points.at(-1);
    if (point) {
      handle.setAttribute("cx", String(point.x));
      handle.setAttribute("cy", String(point.y));
    }
  }
}

interface SnapAxisState {
  readonly value: number;
  readonly targetId: string;
}

function movedElementIds(
  scene: MermaidScene | undefined,
  id: string,
): Set<string> {
  const result = new Set([id]);
  if (!scene?.groups.some((group) => group.id === id)) return result;
  let changed = true;
  while (changed) {
    changed = false;
    for (const group of scene.groups) {
      if (
        group.parentId &&
        result.has(group.parentId) &&
        !result.has(group.id)
      ) {
        result.add(group.id);
        changed = true;
      }
    }
  }
  for (const node of scene.nodes)
    if (node.parentId && result.has(node.parentId)) result.add(node.id);
  return result;
}

function connectedNodes(scene: MermaidScene, id: string) {
  const ids = new Set(
    scene.relationships.flatMap((relationship) =>
      relationship.source === id
        ? [relationship.target]
        : relationship.target === id
          ? [relationship.source]
          : [],
    ),
  );
  return scene.nodes.filter((node) => ids.has(node.id));
}

function snapAxis(
  rawDelta: number,
  center: number,
  candidates: readonly { readonly id: string; readonly value: number }[],
  previous: SnapAxisState | undefined,
  zoom: number,
): { readonly delta: number; readonly snap?: SnapAxisState } {
  const desired = center + rawDelta;
  if (previous && Math.abs(desired - previous.value) * zoom <= 12)
    return { delta: previous.value - center, snap: previous };
  const nearest = candidates
    .map((candidate) => ({
      ...candidate,
      distance: Math.abs(candidate.value - desired) * zoom,
    }))
    .filter(({ distance }) => distance <= 8)
    .sort((left, right) => left.distance - right.distance)[0];
  return nearest
    ? {
        delta: nearest.value - center,
        snap: { value: nearest.value, targetId: nearest.id },
      }
    : { delta: rawDelta };
}

function snappedNodeDelta(
  scene: MermaidScene | undefined,
  id: string,
  rawDx: number,
  rawDy: number,
  zoom: number,
  previousX: SnapAxisState | undefined,
  previousY: SnapAxisState | undefined,
  bypass: boolean,
) {
  const node = scene?.nodes.find((candidate) => candidate.id === id);
  if (!scene || !node || bypass)
    return { dx: rawDx, dy: rawDy, snapX: undefined, snapY: undefined };
  const candidates = connectedNodes(scene, id);
  const x = snapAxis(
    rawDx,
    node.x + node.width / 2,
    candidates.map((candidate) => ({
      id: candidate.id,
      value: candidate.x + candidate.width / 2,
    })),
    previousX,
    zoom,
  );
  const y = snapAxis(
    rawDy,
    node.y + node.height / 2,
    candidates.map((candidate) => ({
      id: candidate.id,
      value: candidate.y + candidate.height / 2,
    })),
    previousY,
    zoom,
  );
  return { dx: x.delta, dy: y.delta, snapX: x.snap, snapY: y.snap };
}

function renderAlignmentGuides(
  container: HTMLDivElement | undefined,
  scene: MermaidScene | undefined,
  snapX: SnapAxisState | undefined,
  snapY: SnapAxisState | undefined,
) {
  if (!scene || (!snapX && !snapY)) {
    clearInteractionOverlay(container);
    return;
  }
  const overlay = interactionOverlay(container);
  if (!overlay) return;
  if (snapX) {
    const line = svgElement("line");
    line.classList.add("alignment-guide");
    line.dataset.axis = "x";
    line.setAttribute("x1", String(snapX.value));
    line.setAttribute("x2", String(snapX.value));
    line.setAttribute("y1", "0");
    line.setAttribute("y2", String(scene.height));
    overlay.append(line);
  }
  if (snapY) {
    const line = svgElement("line");
    line.classList.add("alignment-guide");
    line.dataset.axis = "y";
    line.setAttribute("x1", "0");
    line.setAttribute("x2", String(scene.width));
    line.setAttribute("y1", String(snapY.value));
    line.setAttribute("y2", String(snapY.value));
    overlay.append(line);
  }
}

type EndpointTarget =
  | { readonly kind: "dock"; readonly dock: ConnectionDock }
  | { readonly kind: "reconnect"; readonly nodeId: string };

function reconnectAllowed(
  scene: MermaidScene,
  relationship: LayoutRelationship,
  endpoint: ConnectionEndpoint,
  nodeId: string,
  sourceEditing: boolean,
): boolean {
  if (!sourceEditing) return false;
  const opposite =
    endpoint === "source" ? relationship.target : relationship.source;
  const node = scene.nodes.find((candidate) => candidate.id === nodeId);
  if (!node || node.id === opposite || node.notation === "boundary-timer")
    return false;
  const modelRelationship = scene.sourceModel.relationships.find(
    (candidate) => candidate.id === relationship.id,
  );
  if (!modelRelationship) return false;
  if (modelRelationship.identity.kind === "authored") return true;
  const source = endpoint === "source" ? nodeId : relationship.source;
  const target = endpoint === "target" ? nodeId : relationship.target;
  return !scene.sourceModel.relationships.some(
    (candidate) =>
      candidate.id !== relationship.id &&
      candidate.source === source &&
      candidate.target === target &&
      candidate.kind === relationship.kind,
  );
}

function endpointTarget(
  scene: MermaidScene,
  relationship: LayoutRelationship,
  endpoint: ConnectionEndpoint,
  point: Point,
  zoom: number,
  sourceEditing: boolean,
): EndpointTarget | undefined {
  const currentId =
    endpoint === "source" ? relationship.source : relationship.target;
  const current = scene.nodes.find((node) => node.id === currentId);
  if (current && relationship.dockEditable) {
    const nearest = dockSides
      .map((dock) => ({
        dock,
        distance: Math.hypot(
          point.x - dockPoint(current, dock).x,
          point.y - dockPoint(current, dock).y,
        ),
      }))
      .sort((left, right) => left.distance - right.distance)[0];
    if (nearest && nearest.distance * zoom <= 20)
      return { kind: "dock", dock: nearest.dock };
  }
  const padding = 8 / zoom;
  const candidate = [...scene.nodes]
    .filter((node) => node.id !== currentId)
    .reverse()
    .find(
      (node) =>
        point.x >= node.x - padding &&
        point.x <= node.x + node.width + padding &&
        point.y >= node.y - padding &&
        point.y <= node.y + node.height + padding,
    );
  return candidate &&
    reconnectAllowed(scene, relationship, endpoint, candidate.id, sourceEditing)
    ? { kind: "reconnect", nodeId: candidate.id }
    : undefined;
}

function renderEndpointTargets(
  container: HTMLDivElement | undefined,
  scene: MermaidScene,
  relationship: LayoutRelationship,
  endpoint: ConnectionEndpoint,
  sourceEditing: boolean,
  hovered: EndpointTarget | undefined,
) {
  const overlay = interactionOverlay(container);
  if (!overlay) return;
  const currentId =
    endpoint === "source" ? relationship.source : relationship.target;
  const current = scene.nodes.find((node) => node.id === currentId);
  if (current && relationship.dockEditable) {
    for (const dock of dockSides) {
      const point = dockPoint(current, dock);
      const circle = svgElement("circle");
      circle.classList.add("dock-target");
      circle.dataset.dock = dock;
      if (hovered?.kind === "dock" && hovered.dock === dock)
        circle.classList.add("is-active");
      circle.setAttribute("cx", String(point.x));
      circle.setAttribute("cy", String(point.y));
      circle.setAttribute("r", "7");
      overlay.append(circle);
    }
  }
  for (const node of scene.nodes) {
    if (node.id === currentId) continue;
    const allowed = reconnectAllowed(
      scene,
      relationship,
      endpoint,
      node.id,
      sourceEditing,
    );
    const rect = svgElement("rect");
    rect.classList.add("reconnect-target");
    rect.classList.add(allowed ? "is-available" : "is-disabled");
    if (hovered?.kind === "reconnect" && hovered.nodeId === node.id)
      rect.classList.add("is-active");
    rect.dataset.nodeId = node.id;
    rect.setAttribute("x", String(node.x - 4));
    rect.setAttribute("y", String(node.y - 4));
    rect.setAttribute("width", String(node.width + 8));
    rect.setAttribute("height", String(node.height + 8));
    rect.setAttribute("rx", "7");
    overlay.append(rect);
    const text = svgElement("text");
    text.classList.add("reconnect-target-label");
    if (!allowed) text.classList.add("is-disabled");
    text.setAttribute("x", String(node.x + node.width / 2));
    text.setAttribute("y", String(Math.max(12, node.y - 9)));
    text.setAttribute("text-anchor", "middle");
    text.textContent = allowed ? "Reconnect" : "Unavailable";
    overlay.append(text);
  }
}

function previewEndpointRoute(
  preview: RelationshipPreview,
  scene: MermaidScene,
  target: EndpointTarget | undefined,
  endpoint: ConnectionEndpoint,
) {
  const relationship = preview.relationship;
  const sourceId =
    endpoint === "source" && target?.kind === "reconnect"
      ? target.nodeId
      : relationship.source;
  const targetId =
    endpoint === "target" && target?.kind === "reconnect"
      ? target.nodeId
      : relationship.target;
  const source = scene.nodes.find((node) => node.id === sourceId);
  const destination = scene.nodes.find((node) => node.id === targetId);
  if (!source || !destination) return;
  const sourceDock =
    endpoint === "source"
      ? target?.kind === "dock"
        ? target.dock
        : target?.kind === "reconnect"
          ? undefined
          : relationship.sourceDock
      : relationship.sourceDock;
  const targetDock =
    endpoint === "target"
      ? target?.kind === "dock"
        ? target.dock
        : target?.kind === "reconnect"
          ? undefined
          : relationship.targetDock
      : relationship.targetDock;
  const points = route(source, destination, scene.nodes, {
    sourceDock,
    targetDock,
  });
  const d = path(points);
  for (const item of preview.paths) item.setAttribute("d", d);
  if (preview.label) {
    const before = midpoint(relationship.points);
    const after = midpoint(points);
    preview.label.setAttribute(
      "transform",
      `translate(${after.x - before.x} ${after.y - before.y})`,
    );
  }
  if (preview.startCircle && points[0]) {
    preview.startCircle.setAttribute("cx", String(points[0].x));
    preview.startCircle.setAttribute("cy", String(points[0].y));
  }
  for (const handle of preview.handles) {
    const point =
      handle.dataset.endpoint === "source" ? points[0] : points.at(-1);
    if (point) {
      handle.setAttribute("cx", String(point.x));
      handle.setAttribute("cy", String(point.y));
    }
  }
}

function previewLooseEndpoint(
  preview: RelationshipPreview,
  endpoint: ConnectionEndpoint,
  point: Point,
) {
  const points = preview.relationship.points.map((item) => ({ ...item }));
  if (points.length < 2) return;
  if (endpoint === "source") {
    points[0] = point;
    if (points[1]!.x === preview.relationship.points[0]!.x)
      points[1]!.x = point.x;
    else points[1]!.y = point.y;
  } else {
    const last = points.length - 1;
    points[last] = point;
    if (points[last - 1]!.x === preview.relationship.points[last]!.x)
      points[last - 1]!.x = point.x;
    else points[last - 1]!.y = point.y;
  }
  const d = path(points);
  for (const item of preview.paths) item.setAttribute("d", d);
  if (preview.label) {
    const before = midpoint(preview.relationship.points);
    const after = midpoint(points);
    preview.label.setAttribute(
      "transform",
      `translate(${after.x - before.x} ${after.y - before.y})`,
    );
  }
  for (const handle of preview.handles) {
    if (handle.dataset.endpoint === endpoint) {
      handle.setAttribute("cx", String(point.x));
      handle.setAttribute("cy", String(point.y));
    }
  }
}

function moveRouteSegment(
  points: readonly Point[],
  segmentIndex: number,
  dx: number,
  dy: number,
): Point[] {
  const a = points[segmentIndex];
  const b = points[segmentIndex + 1];
  if (!a || !b) return [...points];
  const horizontal = a.y === b.y;
  const amount = horizontal ? dy : dx;
  if (amount === 0) return [...points];
  const lastSegment = points.length - 2;
  const shiftedA = horizontal
    ? { x: a.x, y: a.y + amount }
    : { x: a.x + amount, y: a.y };
  const shiftedB = horizontal
    ? { x: b.x, y: b.y + amount }
    : { x: b.x + amount, y: b.y };
  const prefix: Point[] = [];
  if (segmentIndex === 0) {
    const length = horizontal ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y);
    const stub = Math.min(12, Math.max(4, length / 3));
    const direction = horizontal
      ? Math.sign(b.x - a.x) || 1
      : Math.sign(b.y - a.y) || 1;
    const stubPoint = horizontal
      ? { x: a.x + direction * stub, y: a.y }
      : { x: a.x, y: a.y + direction * stub };
    prefix.push(a, stubPoint, {
      x: horizontal ? stubPoint.x : shiftedA.x,
      y: horizontal ? shiftedA.y : stubPoint.y,
    });
  } else prefix.push(...points.slice(0, segmentIndex), shiftedA);

  const suffix: Point[] = [];
  if (segmentIndex === lastSegment) {
    const length = horizontal ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y);
    const stub = Math.min(12, Math.max(4, length / 3));
    const direction = horizontal
      ? Math.sign(b.x - a.x) || 1
      : Math.sign(b.y - a.y) || 1;
    const stubPoint = horizontal
      ? { x: b.x - direction * stub, y: b.y }
      : { x: b.x, y: b.y - direction * stub };
    suffix.push(
      {
        x: horizontal ? stubPoint.x : shiftedB.x,
        y: horizontal ? shiftedB.y : stubPoint.y,
      },
      stubPoint,
      b,
    );
  } else suffix.push(shiftedB, ...points.slice(segmentIndex + 2));
  return normalizeRoutePoints([...prefix, ...suffix]);
}

function moveRouteWaypoint(
  points: readonly Point[],
  pointIndex: number,
  dx: number,
  dy: number,
): Point[] {
  const previous = points[pointIndex - 1];
  const point = points[pointIndex];
  const next = points[pointIndex + 1];
  if (!previous || !point || !next) return [...points];
  const incomingHorizontal = previous.y === point.y;
  let adjusted = moveRouteSegment(
    points,
    pointIndex - 1,
    incomingHorizontal ? 0 : dx,
    incomingHorizontal ? dy : 0,
  );
  const intermediate = {
    x: point.x + (incomingHorizontal ? 0 : dx),
    y: point.y + (incomingHorizontal ? dy : 0),
  };
  const adjustedIndex = adjusted.findIndex(
    (candidate, index) =>
      index > 0 &&
      index < adjusted.length - 1 &&
      candidate.x === intermediate.x &&
      candidate.y === intermediate.y,
  );
  if (adjustedIndex < 0) return adjusted;
  const outgoingHorizontal = point.y === next.y;
  adjusted = moveRouteSegment(
    adjusted,
    adjustedIndex,
    outgoingHorizontal ? 0 : dx,
    outgoingHorizontal ? dy : 0,
  );
  return adjusted;
}

function updateRoutePreview(
  preview: RelationshipPreview,
  points: readonly Point[],
) {
  const d = path(points);
  for (const item of preview.paths) item.setAttribute("d", d);
  if (preview.label) {
    const before = midpoint(preview.relationship.points);
    const after = midpoint(points);
    preview.label.setAttribute(
      "transform",
      `translate(${after.x - before.x} ${after.y - before.y})`,
    );
  }
}

type SurfaceDrag =
  | {
      readonly kind: "marquee";
      readonly pointerId: number;
      readonly x: number;
      readonly y: number;
      readonly touch: boolean;
      readonly start: Point;
      readonly additive: boolean;
      moved: boolean;
      end: Point;
    }
  | {
      readonly kind: "element";
      readonly id: string | undefined;
      readonly ids: readonly string[];
      readonly toggle: boolean;
      readonly x: number;
      readonly y: number;
      readonly pointerId: number;
      readonly touch: boolean;
      readonly groups: readonly SVGElement[];
      readonly relationships: readonly RelationshipPreview[];
      moved: boolean;
      dx: number;
      dy: number;
      snapX: SnapAxisState | undefined;
      snapY: SnapAxisState | undefined;
    }
  | {
      readonly kind: "endpoint";
      readonly relationshipId: string;
      readonly endpoint: ConnectionEndpoint;
      readonly pointerId: number;
      readonly x: number;
      readonly y: number;
      readonly touch: boolean;
      readonly preview: RelationshipPreview;
      moved: boolean;
      target: EndpointTarget | undefined;
    }
  | {
      readonly kind: "connection-create";
      readonly sourceId: string;
      readonly direction: CanvasDirection;
      readonly pointerId: number;
      readonly x: number;
      readonly y: number;
      readonly touch: boolean;
      moved: boolean;
      point: Point | undefined;
      targetId: string | undefined;
    }
  | {
      readonly kind: "route";
      readonly relationshipId: string;
      readonly handle: "segment" | "waypoint";
      readonly index: number;
      readonly pointerId: number;
      readonly x: number;
      readonly y: number;
      readonly touch: boolean;
      readonly preview: RelationshipPreview;
      readonly originalPoints: readonly Point[];
      moved: boolean;
      points: readonly Point[];
    };

export function MermaidSurface(props: MermaidSurfaceProps) {
  // Assigned by Solid's bare-ref transform from ref={container}.
  // oxlint-disable-next-line no-unassigned-vars
  let container: HTMLDivElement | undefined;
  // Assigned by Solid's bare-ref transform.
  // oxlint-disable-next-line no-unassigned-vars
  let selectionTools: HTMLDivElement | undefined;
  // Assigned by Solid's bare-ref transform from the staged draft form.
  // oxlint-disable-next-line no-unassigned-vars
  let draftForm: HTMLFormElement | undefined;
  // oxlint-disable-next-line no-unassigned-vars
  let draftInput: HTMLInputElement | undefined;
  let focusedDraftKey = "";
  const [size, setSize] = createSignal({ width: 0, height: 0, toolsHeight: 0 });
  const [announcement, setAnnouncement] = createSignal("");
  const [multipleMode, setMultipleMode] = createSignal(false);
  const [selectionModifier, setSelectionModifier] = createSignal(false);
  const [arrangement, setArrangement] = createSignal<Arrangement>("left");
  const [interactionActive, setInteractionActive] = createSignal(false);
  const [actionBarReady, setActionBarReady] = createSignal(false);
  const [selectedWaypoint, setSelectedWaypoint] = createSignal<
    { readonly relationshipId: string; readonly pointIndex: number } | undefined
  >();
  let drag: SurfaceDrag | undefined;
  let restoreArrangement: (() => void) | undefined;

  const clearArrangement = () => {
    restoreArrangement?.();
    restoreArrangement = undefined;
  };
  const arrangementError = () => {
    if (!props.scene) return "No diagram available.";
    try {
      selectionMovements(
        props.scene,
        props.selectedElementIds,
        arrangement(),
        props.boundaryTimerHosts,
      );
      return "";
    } catch (error) {
      return (error as Error).message;
    }
  };
  const previewArrangement = () => {
    clearArrangement();
    if (!props.scene || arrangementError()) return;
    const movements = selectionMovements(
      props.scene,
      props.selectedElementIds,
      arrangement(),
      props.boundaryTimerHosts,
    );
    const deltas = expandedMovements(
      props.scene,
      movements,
      props.boundaryTimerHosts,
    );
    const saved = [
      ...(container?.querySelectorAll<SVGElement>(
        ".node[data-element-id],.group[data-element-id],.relationship[data-element-id]",
      ) ?? []),
    ].map((element) => ({
      element,
      markup: element.innerHTML,
      transform: element.getAttribute("transform"),
    }));
    restoreArrangement = () => {
      for (const { element, markup, transform } of saved) {
        element.innerHTML = markup;
        restoreAttribute(element, "transform", transform);
      }
    };
    for (const { element } of saved) {
      const delta = deltas.get(element.dataset.elementId ?? "");
      if (delta)
        element.setAttribute("transform", `translate(${delta.dx} ${delta.dy})`);
    }
    for (const preview of relationshipPreviews(
      props.scene,
      container,
      new Set(deltas.keys()),
    )) {
      const source = deltas.get(preview.relationship.source) ?? {
        dx: 0,
        dy: 0,
      };
      const target = deltas.get(preview.relationship.target) ?? {
        dx: 0,
        dy: 0,
      };
      const points =
        source.dx === target.dx && source.dy === target.dy
          ? previewPoints(
              preview.relationship.points,
              true,
              true,
              source.dx,
              source.dy,
            )
          : previewPoints(
              previewPoints(
                preview.relationship.points,
                true,
                false,
                source.dx,
                source.dy,
              ),
              false,
              true,
              target.dx,
              target.dy,
            );
      updateRoutePreview(preview, points);
    }
  };

  createEffect(
    () => props.svg,
    () => clearArrangement(),
  );

  const selectElements = (ids: readonly string[], primary = ids.at(-1)) => {
    clearArrangement();
    props.onSelectElements(ids, primary);
    setAnnouncement(`${ids.length} elements selected.`);
  };
  const toggleElement = (id: string) => {
    const ids = props.selectedElementIds.filter(
      (candidate) =>
        props.scene?.nodes.some((item) => item.id === candidate) ||
        props.scene?.groups.some((item) => item.id === candidate),
    );
    selectElements(
      ids.includes(id)
        ? ids.filter((candidate) => candidate !== id)
        : [...ids, id],
    );
  };

  const selectAndAnnounce = (id: string | undefined) => {
    clearArrangement();
    props.onSelect(id);
    if (!id) {
      setAnnouncement("Selection cleared.");
      return;
    }
    const items = navigationItems(props.scene);
    const index = items.findIndex((item) => item.id === id);
    const item = items[index];
    if (item)
      setAnnouncement(
        `${item.type} ${item.label}, ${index + 1} of ${items.length}, selected.`,
      );
  };

  const clearDrag = () => {
    const previews =
      drag?.kind === "endpoint"
        ? [drag.preview]
        : drag?.kind === "route"
          ? [drag.preview]
          : drag?.kind === "element"
            ? drag.relationships
            : [];
    if (drag?.kind === "element")
      for (const group of drag.groups) group.removeAttribute("transform");
    for (const preview of previews) {
      preview.paths.forEach((item, index) =>
        restoreAttribute(item, "d", preview.originalPaths[index] ?? null),
      );
      if (preview.label)
        restoreAttribute(
          preview.label,
          "transform",
          preview.originalLabelTransform,
        );
      if (preview.startCircle) {
        restoreAttribute(preview.startCircle, "cx", preview.originalCircleX);
        restoreAttribute(preview.startCircle, "cy", preview.originalCircleY);
      }
      preview.handles.forEach((handle, index) => {
        restoreAttribute(handle, "cx", preview.originalHandleX[index] ?? null);
        restoreAttribute(handle, "cy", preview.originalHandleY[index] ?? null);
      });
    }
    clearInteractionOverlay(container);
    drag = undefined;
    setInteractionActive(false);
  };

  const selectedNode = () =>
    props.scene?.nodes.find(({ id }) => id === props.selectedElementId);
  const selectedRelationship = () =>
    props.scene?.relationships.find(({ id }) => id === props.selectedElementId);
  const saveRoute = (relationshipId: string, points: readonly Point[]) => {
    const normalized = normalizeRoutePoints(points);
    const waypoints = normalized.slice(1, -1);
    if (waypoints.length === 0) props.onResetRoute(relationshipId);
    else props.onSetRoute(relationshipId, waypoints);
  };
  const removeWaypoint = (relationshipId: string, pointIndex: number) => {
    const relationship = props.scene?.relationships.find(
      ({ id }) => id === relationshipId,
    );
    const removed = relationship?.points[pointIndex];
    const previous = relationship?.points[pointIndex - 1];
    const next = relationship?.points[pointIndex + 1];
    if (!relationship || !removed || !previous || !next) return;
    const points = [...relationship.points];
    points.splice(pointIndex, 1);
    if (previous.x !== next.x && previous.y !== next.y) {
      const first = { x: next.x, y: previous.y };
      const replacement =
        first.x === removed.x && first.y === removed.y
          ? { x: previous.x, y: next.y }
          : first;
      points.splice(pointIndex, 0, replacement);
    }
    setSelectedWaypoint(undefined);
    saveRoute(relationshipId, points);
  };
  const nodeActionPlacement = (
    node: NonNullable<ReturnType<typeof selectedNode>>,
  ): "above" | "below" => {
    let above = 0;
    let below = 0;
    const centreY = node.y + node.height / 2;
    for (const relationship of props.scene?.relationships ?? []) {
      const adjacent =
        relationship.source === node.id
          ? relationship.points[1]
          : relationship.target === node.id
            ? relationship.points.at(-2)
            : undefined;
      if (!adjacent) continue;
      if (adjacent.y < centreY) above += 1;
      else below += 1;
    }
    const roomAbove = (node.y - props.viewport.y) * props.zoom >= 72;
    const roomBelow =
      (props.viewport.y + props.viewport.height - node.y - node.height) *
        props.zoom >=
      72;
    if (!roomAbove && roomBelow) return "below";
    if (!roomBelow && roomAbove) return "above";
    return above > below ? "below" : "above";
  };
  const actionAnchor = () => {
    const node = selectedNode();
    if (node) {
      const placement = nodeActionPlacement(node);
      return {
        x: node.x + node.width / 2,
        y:
          placement === "above"
            ? node.y - 32 / props.zoom
            : node.y + node.height + 32 / props.zoom,
        placement,
      };
    }
    const relationship = selectedRelationship();
    if (!relationship) return undefined;
    const waypoint = selectedWaypoint();
    const point =
      waypoint?.relationshipId === relationship.id
        ? (relationship.points[waypoint.pointIndex] ??
          midpoint(relationship.points))
        : midpoint(relationship.points);
    return {
      x: point.x,
      y: point.y - 20 / props.zoom,
      placement: "above" as const,
    };
  };
  const actionBarState = () => {
    if (
      props.selectedElementIds.length > 1 ||
      multipleMode() ||
      selectionModifier() ||
      !props.actionBarVisible ||
      !actionBarReady() ||
      interactionActive()
    )
      return undefined;
    const anchor = actionAnchor();
    const node = selectedNode();
    const relationship = selectedRelationship();
    const selected = node ?? relationship;
    return anchor && selected
      ? {
          anchor,
          selected,
          node,
          relationship,
          waypoint:
            selectedWaypoint()?.relationshipId === relationship?.id
              ? selectedWaypoint()
              : undefined,
        }
      : undefined;
  };
  const forwardDirection = (): CanvasDirection => {
    const direction = props.scene?.sourceModel.direction;
    if (direction === "LR") return "right";
    if (direction === "RL") return "left";
    if (direction === "BT") return "top";
    return "bottom";
  };
  const mobileActionInset = () =>
    props.actionBarVisible && size().width <= 1000 ? 64 : 0;

  createEffect(
    () => (props.actionBarVisible ? (props.selectedElementId ?? "") : ""),
    (selectedId) => {
      setActionBarReady(false);
      if (!selectedId) return;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => setActionBarReady(true)),
      );
    },
  );

  createEffect(
    () => ({
      selectedId: props.selectedElementId,
      waypoint: selectedWaypoint(),
    }),
    ({ selectedId, waypoint }) => {
      if (waypoint && waypoint.relationshipId !== selectedId)
        setSelectedWaypoint(undefined);
    },
  );

  onSettled(() => {
    if (!container) return;
    const trackModifiers = (event: KeyboardEvent) =>
      setSelectionModifier(event.shiftKey || event.ctrlKey || event.metaKey);
    const clearModifiers = () => setSelectionModifier(false);
    window.addEventListener("keydown", trackModifiers);
    window.addEventListener("keyup", trackModifiers);
    window.addEventListener("blur", clearModifiers);
    const observer = new ResizeObserver(() => {
      if (container)
        setSize({
          width: container.clientWidth,
          height: container.clientHeight,
          toolsHeight: selectionTools?.offsetHeight ?? 0,
        });
    });
    observer.observe(container);
    if (selectionTools) observer.observe(selectionTools);
    return () => {
      observer.disconnect();
      window.removeEventListener("keydown", trackModifiers);
      window.removeEventListener("keyup", trackModifiers);
      window.removeEventListener("blur", clearModifiers);
    };
  });

  createEffect(
    () => ({
      fit: props.fitView,
      width: props.width,
      height: props.height,
      size: size(),
      actionInset: mobileActionInset(),
    }),
    ({ fit, width, height, size, actionInset }) => {
      if (!fit || size.width <= 32 || size.height <= 32) return;
      props.onZoom(
        Math.max(
          0.1,
          Math.min(
            1,
            (size.width - 48) / width,
            (size.height - size.toolsHeight - 48 - actionInset) / height,
          ),
        ),
      );
      container?.scrollTo(0, 0);
    },
  );

  createEffect(
    () => {
      const draft = props.draft;
      return draft
        ? `${draft.point.x}:${draft.point.y}:${draft.sourceId ?? "standalone"}`
        : "";
    },
    (key) => {
      if (!key) {
        focusedDraftKey = "";
        return;
      }
      if (key === focusedDraftKey) return;
      focusedDraftKey = key;
      requestAnimationFrame(() => {
        draftInput?.focus();
        draftInput?.select();
      });
    },
  );

  return (
    <div
      class={{
        "diagram-surface": true,
        "mermaid-surface": true,
        "is-placing-node": props.placementMode,
        "is-selecting-multiple": multipleMode(),
        "has-selection-modifier": selectionModifier(),
      }}
      ref={container}
      role="application"
      aria-label="Interactive Mermaid diagram"
      aria-describedby="diagram-keyboard-help"
      aria-disabled={props.disabled ? "true" : "false"}
      tabindex={0}
      onKeyDown={(event) => {
        if (
          event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLSelectElement ||
          event.target instanceof HTMLTextAreaElement ||
          event.target instanceof HTMLButtonElement
        )
          return;
        const routeHandle =
          event.target instanceof Element
            ? event.target.closest<SVGGElement>(
                ".route-segment-handle,.route-waypoint-handle",
              )
            : null;
        const routeGroup = routeHandle?.closest<SVGGElement>(
          ".connection-route-handles",
        );
        const routeRelationship = props.scene?.relationships.find(
          ({ id }) => id === routeGroup?.dataset.elementId,
        );
        if (routeHandle && routeRelationship) {
          const pointIndex = Number(routeHandle.dataset.pointIndex);
          if (
            routeHandle.classList.contains("route-waypoint-handle") &&
            Number.isInteger(pointIndex)
          )
            setSelectedWaypoint({
              relationshipId: routeRelationship.id,
              pointIndex,
            });
          const direction = {
            ArrowLeft: [-1, 0],
            ArrowRight: [1, 0],
            ArrowUp: [0, -1],
            ArrowDown: [0, 1],
          }[event.key];
          if (direction) {
            const amount = event.shiftKey ? 20 : 5;
            const dx = direction[0]! * amount;
            const dy = direction[1]! * amount;
            const segmentIndex = Number(routeHandle.dataset.segmentIndex);
            const points = routeHandle.classList.contains(
              "route-segment-handle",
            )
              ? moveRouteSegment(routeRelationship.points, segmentIndex, dx, dy)
              : moveRouteWaypoint(routeRelationship.points, pointIndex, dx, dy);
            const changed =
              points.length !== routeRelationship.points.length ||
              points.some(
                (point, index) =>
                  point.x !== routeRelationship.points[index]?.x ||
                  point.y !== routeRelationship.points[index]?.y,
              );
            if (changed) {
              event.preventDefault();
              saveRoute(routeRelationship.id, points);
              setAnnouncement(
                `${routeHandle.classList.contains("route-segment-handle") ? "Route segment" : "Route waypoint"} moved.`,
              );
            } else event.preventDefault();
            return;
          }
          if (
            event.key === "Delete" &&
            routeHandle.classList.contains("route-waypoint-handle")
          ) {
            event.preventDefault();
            removeWaypoint(routeRelationship.id, pointIndex);
            setAnnouncement("Route waypoint removed.");
            return;
          }
        }
        if (event.key === "Escape") {
          event.preventDefault();
          const cancelled = drag !== undefined;
          clearDrag();
          clearArrangement();
          if (cancelled) return;
          if (props.placementMode) {
            props.onCancelInteraction();
            setAnnouncement("Node placement cancelled.");
            return;
          }
          selectAndAnnounce(undefined);
          return;
        }
        if (props.disabled) return;
        if (
          event.key.toLowerCase() === "a" &&
          (event.ctrlKey || event.metaKey)
        ) {
          event.preventDefault();
          selectElements(
            [...(props.scene?.groups ?? []), ...(props.scene?.nodes ?? [])].map(
              (item) => item.id,
            ),
          );
          return;
        }
        if (
          event.key.toLowerCase() === "n" &&
          !event.ctrlKey &&
          !event.metaKey
        ) {
          event.preventDefault();
          if (props.sourceEditing) {
            props.onArmPlacement();
            setAnnouncement("Node placement active. Choose a canvas position.");
          } else props.onRequestSourceEditing();
          return;
        }
        const selectedId = props.selectedElementId;
        const selectedIsNode = props.scene?.nodes.some(
          ({ id }) => id === selectedId,
        );
        if (
          event.key === "Enter" &&
          (event.ctrlKey || event.metaKey) &&
          selectedId &&
          selectedIsNode &&
          props.selectedElementIds.length <= 1
        ) {
          event.preventDefault();
          if (props.sourceEditing)
            props.onQuickAdd(selectedId, forwardDirection());
          else props.onRequestSourceEditing();
          return;
        }
        if (
          (event.key === "Enter" || event.key === "F2") &&
          selectedId &&
          props.selectedElementIds.length <= 1
        ) {
          event.preventDefault();
          if (props.sourceEditing) props.onEditLabel(selectedId);
          else props.onRequestSourceEditing();
          return;
        }
        if (
          event.key === "Delete" &&
          selectedId &&
          props.selectedElementIds.length <= 1
        ) {
          event.preventDefault();
          if (props.sourceEditing) props.onDelete(selectedId);
          else props.onRequestSourceEditing();
          return;
        }
        const items = navigationItems(props.scene).filter(
          (item) =>
            !event.shiftKey || event.altKey || item.type !== "connection",
        );
        const direction = {
          ArrowLeft: -1,
          ArrowUp: -1,
          ArrowRight: 1,
          ArrowDown: 1,
        }[event.key];
        if (direction === undefined) return;
        const id = elementId(event.target) ?? props.selectedElementId;
        if (!event.altKey) {
          if (items.length === 0) return;
          event.preventDefault();
          const current = items.findIndex((item) => item.id === id);
          const next =
            current < 0
              ? direction > 0
                ? 0
                : items.length - 1
              : (current + direction + items.length) % items.length;
          const nextId = items[next]!.id;
          if (event.shiftKey)
            selectElements(
              [
                ...new Set([
                  ...props.selectedElementIds.filter((id) =>
                    items.some((item) => item.id === id),
                  ),
                  nextId,
                ]),
              ],
              nextId,
            );
          else selectAndAnnounce(nextId);
          return;
        }
        if (!id) return;
        const group = [
          ...(container?.querySelectorAll<SVGElement>("[data-element-id]") ??
            []),
        ].find((item) => item.dataset.elementId === id);
        if (!movable(group)) return;
        const delta = event.shiftKey ? 20 : 5;
        const movement = {
          ArrowLeft: [-delta, 0],
          ArrowRight: [delta, 0],
          ArrowUp: [0, -delta],
          ArrowDown: [0, delta],
        }[event.key];
        if (!movement) return;
        event.preventDefault();
        if (props.selectedElementIds.length > 1)
          props.onMoveElements(
            props.selectedElementIds,
            movement[0]!,
            movement[1]!,
          );
        else props.onNudge(id, movement[0]!, movement[1]!);
        const item = items.find((candidate) => candidate.id === id);
        setAnnouncement(
          `${item?.label ?? id} moved ${event.key.replace("Arrow", "").toLowerCase()}.`,
        );
      }}
      onPointerDown={(event) => {
        if (!event.isPrimary) {
          clearDrag();
          return;
        }
        if (props.disabled || event.button !== 0) return;
        clearArrangement();
        clearDrag();
        const routeGroup =
          event.target instanceof Element
            ? event.target.closest<SVGGElement>(".connection-route-handles")
            : null;
        const routeRelationship = props.scene?.relationships.find(
          ({ id }) => id === routeGroup?.dataset.elementId,
        );
        const routePoint = routeGroup
          ? diagramPoint(container, event.clientX, event.clientY)
          : undefined;
        if (routePoint && routeRelationship && props.scene) {
          const nearest = [
            ...routeRelationship.points.slice(1).map((point, index) => {
              const previous = routeRelationship.points[index]!;
              return {
                handle: "segment" as const,
                index,
                distance: Math.hypot(
                  routePoint.x - (previous.x + point.x) / 2,
                  routePoint.y - (previous.y + point.y) / 2,
                ),
              };
            }),
            ...routeRelationship.points.slice(1, -1).map((point, index) => ({
              handle: "waypoint" as const,
              index: index + 1,
              distance: Math.hypot(
                routePoint.x - point.x,
                routePoint.y - point.y,
              ),
            })),
          ].sort((left, right) => left.distance - right.distance)[0];
          const handle = nearest?.handle;
          const index = nearest?.index;
          const preview = relationshipPreviews(
            props.scene,
            container,
            new Set([routeRelationship.source]),
          ).find(
            (candidate) => candidate.relationship.id === routeRelationship.id,
          );
          if (
            nearest &&
            preview &&
            handle &&
            index !== undefined &&
            nearest.distance * props.zoom <= 22
          ) {
            if (handle === "waypoint")
              setSelectedWaypoint({
                relationshipId: routeRelationship.id,
                pointIndex: index,
              });
            else setSelectedWaypoint(undefined);
            drag = {
              kind: "route",
              relationshipId: routeRelationship.id,
              handle,
              index,
              pointerId: event.pointerId,
              x: event.clientX,
              y: event.clientY,
              touch: event.pointerType === "touch",
              preview,
              originalPoints: routeRelationship.points,
              moved: false,
              points: routeRelationship.points,
            };
            setInteractionActive(true);
            event.currentTarget.setPointerCapture(event.pointerId);
            event.preventDefault();
            return;
          }
        }
        const quickHandle =
          event.target instanceof Element
            ? event.target.closest<SVGGElement>(".node-quick-add")
            : null;
        const quickSource = quickHandle?.dataset.sourceId;
        const quickDirection = quickHandle?.dataset.direction as
          CanvasDirection | undefined;
        if (quickSource && quickDirection) {
          if (!props.sourceEditing) {
            props.onRequestSourceEditing();
            return;
          }
          drag = {
            kind: "connection-create",
            sourceId: quickSource,
            direction: quickDirection,
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            touch: event.pointerType === "touch",
            moved: false,
            point: undefined,
            targetId: undefined,
          };
          setInteractionActive(true);
          event.currentTarget.setPointerCapture(event.pointerId);
          event.preventDefault();
          return;
        }
        if (props.placementMode) {
          if (!props.sourceEditing) {
            props.onRequestSourceEditing();
            return;
          }
          const group = elementGroup(event.target);
          if (!group) {
            const point = diagramPoint(container, event.clientX, event.clientY);
            if (point) props.onPlaceNode(point);
            event.preventDefault();
          }
          return;
        }
        const group = elementGroup(event.target);
        const endpointHandle =
          event.target instanceof Element
            ? event.target.closest<SVGCircleElement>(
                ".connection-endpoint-handle",
              )
            : null;
        const endpoint = endpointHandle?.dataset.endpoint as
          ConnectionEndpoint | undefined;
        const relationship = props.scene?.relationships.find(
          (candidate) => candidate.id === group?.dataset.elementId,
        );
        if (endpoint && relationship && props.scene) {
          const currentId =
            endpoint === "source" ? relationship.source : relationship.target;
          const preview = relationshipPreviews(
            props.scene,
            container,
            new Set([currentId]),
          ).find((candidate) => candidate.relationship.id === relationship.id);
          if (preview) {
            drag = {
              kind: "endpoint",
              relationshipId: relationship.id,
              endpoint,
              pointerId: event.pointerId,
              x: event.clientX,
              y: event.clientY,
              touch: event.pointerType === "touch",
              preview,
              moved: false,
              target: undefined,
            };
            setInteractionActive(true);
            renderEndpointTargets(
              container,
              props.scene,
              relationship,
              endpoint,
              props.sourceEditing,
              undefined,
            );
            event.currentTarget.setPointerCapture(event.pointerId);
            return;
          }
        }
        const draggableGroup =
          movable(group) &&
          (event.pointerType !== "touch" ||
            group?.classList.contains("node") ||
            multipleMode());
        const id = group?.dataset.elementId;
        const toggle =
          event.shiftKey || event.ctrlKey || event.metaKey || multipleMode();
        if (!group && (event.pointerType !== "touch" || multipleMode())) {
          const start = diagramPoint(container, event.clientX, event.clientY);
          if (start) {
            drag = {
              kind: "marquee",
              pointerId: event.pointerId,
              x: event.clientX,
              y: event.clientY,
              touch: event.pointerType === "touch",
              start,
              end: start,
              additive: toggle,
              moved: false,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
            event.preventDefault();
          }
          return;
        }
        const ids =
          id &&
          props.selectedElementIds.includes(id) &&
          props.selectedElementIds.length > 1
            ? props.selectedElementIds
            : id
              ? [id]
              : [];
        const movedIds =
          draggableGroup && id
            ? new Set(
                ids.flatMap((id) => [...movedElementIds(props.scene, id)]),
              )
            : new Set<string>();
        for (const [timer, host] of props.boundaryTimerHosts)
          if (movedIds.has(host)) movedIds.add(timer);
        const groups = draggableGroup
          ? [
              ...(container?.querySelectorAll<SVGElement>(
                ".node[data-element-id],.group[data-element-id]",
              ) ?? []),
            ].filter((candidate) =>
              movedIds.has(candidate.dataset.elementId ?? ""),
            )
          : [];
        drag = {
          kind: "element",
          id,
          ids,
          toggle,
          x: event.clientX,
          y: event.clientY,
          pointerId: event.pointerId,
          touch: event.pointerType === "touch",
          groups,
          relationships: draggableGroup
            ? relationshipPreviews(props.scene, container, movedIds)
            : [],
          moved: false,
          dx: 0,
          dy: 0,
          snapX: undefined,
          snapY: undefined,
        };
        if (draggableGroup) setInteractionActive(true);
        if (group) event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        const screenDx = event.clientX - drag.x;
        const screenDy = event.clientY - drag.y;
        if (
          !drag.moved &&
          Math.hypot(screenDx, screenDy) < (drag.touch ? 8 : 3)
        )
          return;
        drag.moved = true;
        if (drag.kind === "marquee") {
          const end = diagramPoint(container, event.clientX, event.clientY);
          if (!end) return;
          drag.end = end;
          const overlay = interactionOverlay(container);
          const rect = svgElement("rect");
          rect.setAttribute("class", "selection-marquee");
          rect.setAttribute("x", String(Math.min(drag.start.x, end.x)));
          rect.setAttribute("y", String(Math.min(drag.start.y, end.y)));
          rect.setAttribute("width", String(Math.abs(end.x - drag.start.x)));
          rect.setAttribute("height", String(Math.abs(end.y - drag.start.y)));
          overlay?.append(rect);
          return;
        }
        if (drag.kind === "route") {
          const dx = screenDx / props.zoom;
          const dy = screenDy / props.zoom;
          drag.points =
            drag.handle === "segment"
              ? moveRouteSegment(drag.originalPoints, drag.index, dx, dy)
              : moveRouteWaypoint(drag.originalPoints, drag.index, dx, dy);
          updateRoutePreview(drag.preview, drag.points);
          return;
        }
        if (drag.kind === "connection-create") {
          const point = diagramPoint(container, event.clientX, event.clientY);
          if (!point) return;
          const target = connectionTarget(props.scene, drag.sourceId, point);
          drag.point = point;
          drag.targetId = target?.id;
          renderConnectionDraft(
            container,
            props.scene,
            drag.sourceId,
            drag.direction,
            point,
            target?.id,
          );
          return;
        }
        if (drag.kind === "endpoint") {
          const endpointDrag = drag;
          const scene = props.scene;
          const point = diagramPoint(container, event.clientX, event.clientY);
          const relationship = scene?.relationships.find(
            (candidate) => candidate.id === endpointDrag.relationshipId,
          );
          if (!scene || !point || !relationship) return;
          endpointDrag.target = endpointTarget(
            scene,
            relationship,
            endpointDrag.endpoint,
            point,
            props.zoom,
            props.sourceEditing,
          );
          renderEndpointTargets(
            container,
            scene,
            relationship,
            endpointDrag.endpoint,
            props.sourceEditing,
            endpointDrag.target,
          );
          if (endpointDrag.target)
            previewEndpointRoute(
              endpointDrag.preview,
              scene,
              endpointDrag.target,
              endpointDrag.endpoint,
            );
          else
            previewLooseEndpoint(
              endpointDrag.preview,
              endpointDrag.endpoint,
              point,
            );
          return;
        }
        if (drag.groups.length === 0 || !drag.id) return;
        const snapped = snappedNodeDelta(
          props.scene,
          drag.id,
          screenDx / props.zoom,
          screenDy / props.zoom,
          props.zoom,
          drag.snapX,
          drag.snapY,
          event.altKey || drag.ids.length > 1,
        );
        let delta = { dx: snapped.dx, dy: snapped.dy };
        if (drag.ids.length > 1 && props.scene) {
          try {
            delta =
              selectionMovements(
                props.scene,
                drag.ids,
                { x: snapped.dx, y: snapped.dy },
                props.boundaryTimerHosts,
              )[0] ?? delta;
          } catch {
            return;
          }
        }
        drag.dx = delta.dx;
        drag.dy = delta.dy;
        drag.snapX = snapped.snapX;
        drag.snapY = snapped.snapY;
        for (const candidate of drag.groups)
          candidate.setAttribute(
            "transform",
            `translate(${drag.dx} ${drag.dy})`,
          );
        for (const preview of drag.relationships)
          updateRelationshipPreview(preview, drag.dx, drag.dy);
        renderAlignmentGuides(container, props.scene, drag.snapX, drag.snapY);
      }}
      onPointerCancel={(event) => {
        if (drag?.pointerId === event.pointerId) clearDrag();
      }}
      onLostPointerCapture={(event) => {
        if (drag?.pointerId === event.pointerId) clearDrag();
      }}
      onPointerUp={(event) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        const completed = drag;
        const moved =
          Math.hypot(
            event.clientX - completed.x,
            event.clientY - completed.y,
          ) >= (completed.touch ? 8 : 3);
        clearDrag();
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
        if (completed.kind === "marquee") {
          if (!moved) {
            if (!completed.additive) selectAndAnnounce(undefined);
            return;
          }
          const bounds = {
            x: Math.min(completed.start.x, completed.end.x),
            y: Math.min(completed.start.y, completed.end.y),
            width: Math.abs(completed.end.x - completed.start.x),
            height: Math.abs(completed.end.y - completed.start.y),
          };
          const ids = [
            ...(props.scene?.groups ?? []),
            ...(props.scene?.nodes ?? []),
          ]
            .filter(
              (item) =>
                pointInBounds(item, bounds) &&
                pointInBounds(
                  { x: item.x + item.width, y: item.y + item.height },
                  bounds,
                ),
            )
            .map((item) => item.id);
          selectElements([
            ...new Set([
              ...(completed.additive ? props.selectedElementIds : []),
              ...ids,
            ]),
          ]);
          return;
        }
        if (completed.kind === "route") {
          selectAndAnnounce(completed.relationshipId);
          if (!moved) return;
          setSelectedWaypoint(undefined);
          saveRoute(completed.relationshipId, completed.points);
          setAnnouncement("Manual route saved.");
          return;
        }
        if (completed.kind === "endpoint") {
          selectAndAnnounce(completed.relationshipId);
          if (!moved || !completed.target) return;
          if (completed.target.kind === "dock")
            props.onSetDock(
              completed.relationshipId,
              completed.endpoint,
              completed.target.dock,
            );
          else
            props.onReconnect(
              completed.relationshipId,
              completed.endpoint,
              completed.target.nodeId,
            );
          return;
        }
        if (completed.kind === "connection-create") {
          if (!moved) {
            props.onQuickAdd(completed.sourceId, completed.direction);
            return;
          }
          if (completed.targetId) {
            props.onConnectNodes(completed.sourceId, completed.targetId);
            return;
          }
          if (completed.point)
            props.onQuickAdd(
              completed.sourceId,
              completed.direction,
              completed.point,
            );
          return;
        }
        if (moved && completed.groups.length === 0) return;
        if (
          !moved &&
          completed.toggle &&
          completed.id &&
          (props.scene?.nodes.some((item) => item.id === completed.id) ||
            props.scene?.groups.some((item) => item.id === completed.id))
        ) {
          toggleElement(completed.id);
          return;
        }
        if (moved && completed.groups.length > 0 && completed.id) {
          if (completed.ids.length > 1)
            props.onMoveElements(completed.ids, completed.dx, completed.dy);
          else {
            selectAndAnnounce(completed.id);
            props.onNudge(completed.id, completed.dx, completed.dy);
          }
        } else selectAndAnnounce(completed.id);
      }}
      onDblClick={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest(
            ".route-segment-handle,.route-waypoint-handle,.connection-endpoint-handle",
          )
        )
          return;
        const id = elementId(event.target);
        if (!id) return;
        event.preventDefault();
        if (props.sourceEditing) props.onEditLabel(id);
        else props.onRequestSourceEditing();
      }}
    >
      <div
        class="canvas-selection-tools"
        ref={selectionTools}
        role="group"
        aria-label="Selection controls"
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            clearArrangement();
            selectAndAnnounce(undefined);
            container?.focus();
          }
        }}
      >
        <button
          type="button"
          aria-pressed={multipleMode() ? "true" : "false"}
          disabled={props.disabled}
          onClick={() => setMultipleMode(!multipleMode())}
        >
          Select multiple
        </button>
        <Show when={props.selectedElementIds.length > 1}>
          <span aria-live="polite">
            {props.selectedElementIds.length} selected
          </span>
          <label>
            <span class="visually-hidden">Arrange selection</span>
            <select
              aria-label="Arrange selection"
              value={arrangement()}
              onChange={(event) => {
                clearArrangement();
                setArrangement(event.currentTarget.value as Arrangement);
              }}
            >
              <option value="left">Align left</option>
              <option value="center">Align horizontal centres</option>
              <option value="right">Align right</option>
              <option value="top">Align top</option>
              <option value="middle">Align vertical centres</option>
              <option value="bottom">Align bottom</option>
              <option value="horizontal">Distribute horizontally</option>
              <option value="vertical">Distribute vertically</option>
            </select>
          </label>
          <button
            type="button"
            disabled={props.disabled || Boolean(arrangementError())}
            onClick={previewArrangement}
          >
            Preview
          </button>
          <button
            type="button"
            disabled={props.disabled || Boolean(arrangementError())}
            onClick={() => {
              clearArrangement();
              props.onArrange(arrangement());
            }}
          >
            Apply
          </button>
          <button
            type="button"
            onClick={() => {
              clearArrangement();
              selectAndAnnounce(undefined);
            }}
          >
            Clear selection
          </button>
          <div class="selection-move-controls">
            {(
              [
                ["left", -10, 0, "←"],
                ["up", 0, -10, "↑"],
                ["down", 0, 10, "↓"],
                ["right", 10, 0, "→"],
              ] as const
            ).map(([direction, dx, dy, label]) => (
              <button
                type="button"
                aria-label={`Move selected elements ${direction}`}
                disabled={props.disabled}
                onClick={() => {
                  clearArrangement();
                  props.onMoveElements(props.selectedElementIds, dx, dy);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <Show when={arrangementError()}>
            <span class="selection-arrangement-help">{arrangementError()}</span>
          </Show>
        </Show>
      </div>
      <div
        class="mermaid-surface__drawing"
        style={{
          width: `${props.width * props.zoom + 32}px`,
          height: `${props.height * props.zoom + 32}px`,
        }}
      >
        <div class="mermaid-surface__svg" innerHTML={props.svg} />
        <Show when={props.draft}>
          {(draft) => (
            <svg
              class="canvas-node-draft-preview"
              viewBox={`${props.viewport.x} ${props.viewport.y} ${props.viewport.width} ${props.viewport.height}`}
              aria-hidden="true"
            >
              <Show
                when={
                  draft().sourceId
                    ? props.scene?.nodes.find(
                        ({ id }) => id === draft().sourceId,
                      )
                    : undefined
                }
                keyed
              >
                {(readSource) => (
                  <line
                    x1={readSource.x + readSource.width / 2}
                    y1={readSource.y + readSource.height / 2}
                    x2={draft().point.x + 70}
                    y2={draft().point.y + 28}
                  />
                )}
              </Show>
              <rect
                x={draft().point.x}
                y={draft().point.y}
                width="140"
                height="56"
                rx="10"
              />
              <text
                x={draft().point.x + 70}
                y={draft().point.y + 33}
                text-anchor="middle"
              >
                {draft().label}
              </text>
            </svg>
          )}
        </Show>
        <Show when={props.draft}>
          {(draft) => (
            <form
              ref={draftForm}
              class="canvas-node-draft-editor"
              aria-label="New node"
              style={{
                left: `${16 + (draft().point.x - props.viewport.x + 70) * props.zoom}px`,
                top: `${16 + (draft().point.y - props.viewport.y + 28) * props.zoom}px`,
                width: `${Math.max(120, 140 * props.zoom)}px`,
              }}
              onSubmit={(event) => {
                event.preventDefault();
                props.onCommitDraft();
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <label class="visually-hidden" for="canvas-node-draft-label">
                Node label
              </label>
              <input
                id="canvas-node-draft-label"
                ref={draftInput}
                aria-label="Node label"
                value={draft().label}
                onInput={(event) =>
                  props.onChangeDraftLabel(event.currentTarget.value)
                }
                onBlur={() => {
                  window.setTimeout(() => {
                    if (
                      draftForm &&
                      !draftForm.contains(document.activeElement)
                    )
                      props.onCommitDraft();
                  }, 0);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return;
                  event.preventDefault();
                  event.stopPropagation();
                  props.onCancelDraft();
                }}
              />
            </form>
          )}
        </Show>
        <Show when={actionBarState()}>
          {(state) => (
            <div
              class="canvas-action-bar"
              role="toolbar"
              data-placement={state().anchor.placement}
              aria-label={`Actions for ${state().selected.label || state().selected.id}`}
              style={{
                left: `${Math.max(180, Math.min(props.width * props.zoom - 180, (state().anchor.x - props.viewport.x) * props.zoom + 16))}px`,
                top: `${Math.max(48, Math.min(props.height * props.zoom - 48, (state().anchor.y - props.viewport.y) * props.zoom + 16))}px`,
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => {
                  if (props.sourceEditing)
                    props.onEditLabel(state().selected.id);
                  else props.onRequestSourceEditing();
                }}
              >
                Label
              </button>
              <Show when={state().node}>
                <label>
                  <span class="visually-hidden">Node type</span>
                  <select
                    aria-label="Canvas node type"
                    disabled={!props.sourceEditing}
                    value={state().node?.kind}
                    onChange={(event) =>
                      props.onChangeKind(
                        state().selected.id,
                        event.currentTarget.value,
                      )
                    }
                  >
                    {props.nodeKinds.map((kind) => (
                      <option value={kind.value}>{kind.label}</option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    if (props.sourceEditing)
                      props.onDuplicate(state().selected.id);
                    else props.onRequestSourceEditing();
                  }}
                >
                  Duplicate
                </button>
              </Show>
              <Show when={state().relationship}>
                <>
                  <label>
                    <span class="visually-hidden">Connection kind</span>
                    <select
                      aria-label="Canvas connection kind"
                      disabled={!props.sourceEditing}
                      value={state().relationship?.kind}
                      onChange={(event) =>
                        props.onChangeKind(
                          state().selected.id,
                          event.currentTarget.value,
                        )
                      }
                    >
                      {props.connectionKinds.map((kind) => (
                        <option value={kind.value}>{kind.label}</option>
                      ))}
                    </select>
                  </label>
                  <Show when={state().relationship?.manualRoute}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedWaypoint(undefined);
                        props.onResetRoute(state().selected.id);
                      }}
                    >
                      Reset route
                    </button>
                  </Show>
                  <Show when={state().waypoint}>
                    {(waypoint) => (
                      <button
                        type="button"
                        onClick={() =>
                          removeWaypoint(
                            waypoint().relationshipId,
                            waypoint().pointIndex,
                          )
                        }
                      >
                        Remove waypoint
                      </button>
                    )}
                  </Show>
                </>
              </Show>
              <button
                type="button"
                onClick={() => {
                  if (props.sourceEditing) props.onDelete(state().selected.id);
                  else props.onRequestSourceEditing();
                }}
              >
                Delete
              </button>
              <button type="button" onClick={props.onOpenInspector}>
                Inspector
              </button>
            </div>
          )}
        </Show>
      </div>
      <p class="mermaid-surface__keyboard-help" id="diagram-keyboard-help">
        Arrow keys select; Shift+arrow extends selection. Shift, Control or
        Command+click toggles selection. Drag empty canvas to select a
        rectangle. On touch, enable Select multiple first. Alt or Option + arrow
        moves the selection; hold Shift for 20 pixels. N adds a node. Control or
        Command + Enter quick-adds. Focus a route handle and use arrows to move
        it; hold Shift for 20 pixels. Enter edits. Delete removes. Escape
        cancels.
      </p>
      <span class="visually-hidden" role="status" aria-live="polite">
        {announcement()}
      </span>
    </div>
  );
}
