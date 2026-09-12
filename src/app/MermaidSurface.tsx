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

export function MermaidSurface(props: MermaidSurfaceProps) {
  let container: HTMLDivElement | undefined;
  const [size, setSize] = createSignal({ width: 0, height: 0 });
  let drag:
    | {
        readonly id: string;
        readonly x: number;
        readonly y: number;
        readonly pointerId: number;
        readonly touch: boolean;
      }
    | undefined;

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
          drag = undefined;
          return;
        }
        const id = elementId(event.target);
        if (!id) {
          props.onSelect(undefined);
          return;
        }
        if (props.disabled || event.button !== 0) return;
        drag = {
          id,
          x: event.clientX,
          y: event.clientY,
          pointerId: event.pointerId,
          touch: event.pointerType === "touch",
        };
        if (!drag.touch) event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        drag = undefined;
      }}
      onLostPointerCapture={() => {
        drag = undefined;
      }}
      onPointerUp={(event) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        const { id, x, y, touch } = drag;
        drag = undefined;
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
        // Touch gestures belong to native scrolling and page zoom. Only a tap
        // selects; explicit inspector controls perform precise mobile moves.
        if (
          touch &&
          Math.abs(event.clientX - x) + Math.abs(event.clientY - y) > 8
        )
          return;
        const dx = (event.clientX - x) / props.zoom;
        const dy = (event.clientY - y) / props.zoom;
        props.onSelect(id);
        if (!touch && Math.abs(dx) + Math.abs(dy) > 2) {
          props.onNudge(id, dx, dy);
        }
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
