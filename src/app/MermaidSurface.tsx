import { createEffect, createSignal, onSettled } from "solid-js";
import type {
  LayoutRelationship,
  MermaidScene,
  Point,
} from "../mermaid/layout/types";

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

interface RelationshipPreview {
  readonly relationship: LayoutRelationship;
  readonly paths: readonly SVGPathElement[];
  readonly originalPaths: readonly (string | null)[];
  readonly label: SVGTextElement | undefined;
  readonly originalLabelTransform: string | null;
  readonly startCircle: SVGCircleElement | undefined;
  readonly originalCircleX: string | null;
  readonly originalCircleY: string | null;
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
  id: string | undefined,
): RelationshipPreview[] {
  if (!scene || !container || !id) return [];
  const groups = new Map(
    [...container.querySelectorAll<SVGGElement>("g.relationship")].map(
      (group) => [group.dataset.elementId, group],
    ),
  );
  return scene.relationships.flatMap((relationship) => {
    const sourceMoves = relationship.source === id;
    const targetMoves = relationship.target === id;
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
      (child): child is SVGCircleElement => child instanceof SVGCircleElement,
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
}

export function MermaidSurface(props: MermaidSurfaceProps) {
  let container: HTMLDivElement | undefined;
  const [size, setSize] = createSignal({ width: 0, height: 0 });
  let drag:
    | {
        readonly id: string | undefined;
        readonly x: number;
        readonly y: number;
        readonly pointerId: number;
        readonly touch: boolean;
        readonly group: SVGElement | undefined;
        readonly relationships: readonly RelationshipPreview[];
        moved: boolean;
      }
    | undefined;

  const clearDrag = () => {
    drag?.group?.removeAttribute("transform");
    for (const preview of drag?.relationships ?? []) {
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
    }
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
      ref={(element) => {
        container = element;
      }}
      role="application"
      aria-label="Interactive Mermaid diagram"
      aria-disabled={props.disabled ? "true" : "false"}
      tabindex={0}
      onKeyDown={(event) => {
        const id = elementId(event.target) ?? props.selectedElementId;
        if (!id || props.disabled) return;
        const group = [
          ...(container?.querySelectorAll<SVGElement>("[data-element-id]") ??
            []),
        ].find((item) => item.dataset.elementId === id);
        if (!movable(group)) return;
        const delta = event.shiftKey ? 20 : 5;
        const direction = {
          ArrowLeft: [-delta, 0],
          ArrowRight: [delta, 0],
          ArrowUp: [0, -delta],
          ArrowDown: [0, delta],
        }[event.key];
        if (!direction) return;
        event.preventDefault();
        props.onNudge(id, direction[0]!, direction[1]!);
      }}
      onPointerDown={(event) => {
        if (!event.isPrimary) {
          clearDrag();
          return;
        }
        if (props.disabled || event.button !== 0) return;
        clearDrag();
        const group = elementGroup(event.target);
        const draggableGroup =
          movable(group) &&
          (event.pointerType !== "touch" || group?.classList.contains("node"));
        drag = {
          id: group?.dataset.elementId,
          x: event.clientX,
          y: event.clientY,
          pointerId: event.pointerId,
          touch: event.pointerType === "touch",
          group: draggableGroup ? group : undefined,
          relationships: draggableGroup
            ? relationshipPreviews(
                props.scene,
                container,
                group?.dataset.elementId,
              )
            : [],
          moved: false,
        };
        if (group) event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag || event.pointerId !== drag.pointerId || !drag.group) return;
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) < (drag.touch ? 8 : 3)) return;
        drag.moved = true;
        drag.group.setAttribute(
          "transform",
          `translate(${dx / props.zoom} ${dy / props.zoom})`,
        );
        for (const preview of drag.relationships)
          updateRelationshipPreview(preview, dx / props.zoom, dy / props.zoom);
      }}
      onPointerCancel={(event) => {
        if (drag?.pointerId === event.pointerId) clearDrag();
      }}
      onLostPointerCapture={(event) => {
        if (drag?.pointerId === event.pointerId) clearDrag();
      }}
      onPointerUp={(event) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        const { id, x, y, touch, group } = drag;
        const dx = event.clientX - x;
        const dy = event.clientY - y;
        const moved = Math.hypot(dx, dy) >= (touch ? 8 : 3);
        clearDrag();
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
        if (moved && !group) return;
        props.onSelect(id);
        if (moved && group && id)
          props.onNudge(id, dx / props.zoom, dy / props.zoom);
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
    </div>
  );
}
