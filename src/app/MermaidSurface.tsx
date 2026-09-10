export interface MermaidSurfaceProps {
  readonly svg: string;
  readonly zoom: number;
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
  let drag:
    { readonly id: string; readonly x: number; readonly y: number } | undefined;

  return (
    <div
      class="diagram-surface mermaid-surface"
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
        const id = elementId(event.target);
        if (!id) {
          props.onSelect(undefined);
          return;
        }
        if (props.disabled || event.button !== 0) return;
        drag = { id, x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerUp={(event) => {
        if (!drag) return;
        const { id, x, y } = drag;
        drag = undefined;
        event.currentTarget.releasePointerCapture(event.pointerId);
        const dx = (event.clientX - x) / props.zoom;
        const dy = (event.clientY - y) / props.zoom;
        props.onSelect(id);
        if (Math.abs(dx) + Math.abs(dy) > 2) {
          props.onNudge(id, dx, dy);
        }
      }}
    >
      <div
        class="mermaid-surface__drawing"
        style={{ transform: `scale(${props.zoom})` }}
        innerHTML={props.svg}
      />
    </div>
  );
}
