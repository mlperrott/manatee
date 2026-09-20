import { createEffect, createSignal, onSettled } from "solid-js";

export interface MermaidSurfaceProps {
  readonly svg: string;
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
        moved: boolean;
      }
    | undefined;

  const clearDrag = () => {
    drag?.group?.removeAttribute("transform");
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
        drag = {
          id: group?.dataset.elementId,
          x: event.clientX,
          y: event.clientY,
          pointerId: event.pointerId,
          touch: event.pointerType === "touch",
          group:
            movable(group) &&
            (event.pointerType !== "touch" || group?.classList.contains("node"))
              ? group
              : undefined,
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
