import { createEffect, createSignal, onSettled } from "solid-js";
import type {
  Bounds,
  LayoutRelationship,
  MermaidScene,
  Point,
} from "../mermaid/layout/types";
import type {
  ConnectionDock,
  ConnectionEndpoint,
} from "../core/document/commands";
import { route } from "../mermaid/layout/routing";

export interface MermaidSurfaceProps {
  readonly svg: string;
  readonly scene: MermaidScene | undefined;
  readonly width: number;
  readonly height: number;
  readonly zoom: number;
  readonly fitView: boolean;
  readonly onZoom: (zoom: number) => void;
  readonly disabled: boolean;
  readonly selectedElementId: string | undefined;
  readonly onSelect: (elementId: string | undefined) => void;
  readonly onNudge: (elementId: string, dx: number, dy: number) => void;
  readonly sourceEditing: boolean;
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
}

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const dockSides = ["top", "right", "bottom", "left"] as const;

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

type SurfaceDrag =
  | {
      readonly kind: "element";
      readonly id: string | undefined;
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
    };

export function MermaidSurface(props: MermaidSurfaceProps) {
  // Assigned by Solid's bare-ref transform from ref={container}.
  // oxlint-disable-next-line no-unassigned-vars
  let container: HTMLDivElement | undefined;
  const [size, setSize] = createSignal({ width: 0, height: 0 });
  const [announcement, setAnnouncement] = createSignal("");
  let drag: SurfaceDrag | undefined;

  const selectAndAnnounce = (id: string | undefined) => {
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
  };

  onSettled(() => {
    if (!container) return;
    const observer = new ResizeObserver(() => {
      if (container)
        setSize({
          width: container.clientWidth,
          height: container.clientHeight,
        });
    });
    observer.observe(container);
    return () => observer.disconnect();
  });

  createEffect(
    () => ({
      fit: props.fitView,
      width: props.width,
      height: props.height,
      size: size(),
    }),
    ({ fit, width, height, size }) => {
      if (!fit || size.width <= 32 || size.height <= 32) return;
      props.onZoom(
        Math.min(1, (size.width - 32) / width, (size.height - 32) / height),
      );
      container?.scrollTo(0, 0);
    },
  );

  return (
    <div
      class="diagram-surface mermaid-surface"
      ref={container}
      role="application"
      aria-label="Interactive Mermaid diagram"
      aria-describedby="diagram-keyboard-help"
      aria-disabled={props.disabled ? "true" : "false"}
      tabindex={0}
      onKeyDown={(event) => {
        if (props.disabled) return;
        if (event.key === "Escape") {
          event.preventDefault();
          selectAndAnnounce(undefined);
          return;
        }
        const items = navigationItems(props.scene);
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
          selectAndAnnounce(items[next]!.id);
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
        props.onNudge(id, movement[0]!, movement[1]!);
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
        clearDrag();
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
          (event.pointerType !== "touch" || group?.classList.contains("node"));
        const id = group?.dataset.elementId;
        const movedIds =
          draggableGroup && id
            ? movedElementIds(props.scene, id)
            : new Set<string>();
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
          event.altKey,
        );
        drag.dx = snapped.dx;
        drag.dy = snapped.dy;
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
        if (moved && completed.groups.length === 0) return;
        selectAndAnnounce(completed.id);
        if (moved && completed.groups.length > 0 && completed.id)
          props.onNudge(completed.id, completed.dx, completed.dy);
      }}
    >
      <div
        class="mermaid-surface__drawing"
        style={{
          width: `${props.width * props.zoom + 32}px`,
          height: `${props.height * props.zoom + 32}px`,
        }}
        innerHTML={props.svg}
      />
      <p class="mermaid-surface__keyboard-help" id="diagram-keyboard-help">
        Arrow keys select elements. Alt or Option + arrow moves a selected node.
        Escape clears the selection.
      </p>
      <span class="visually-hidden" role="status" aria-live="polite">
        {announcement()}
      </span>
    </div>
  );
}
