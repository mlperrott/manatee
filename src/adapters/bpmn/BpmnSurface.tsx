import { onSettled } from "solid-js";

import { BpmnCanvas, type BpmnCanvasOptions } from "./BpmnCanvas";
import type { BpmnPresentationModel } from "./model";

export interface BpmnSurfaceProps extends BpmnCanvasOptions {
  readonly source: string;
  readonly presentation?: BpmnPresentationModel;
  readonly onReady?: (canvas: BpmnCanvas) => void;
  readonly onError?: (error: Error) => void;
}

export function BpmnSurface(props: BpmnSurfaceProps) {
  let container: HTMLDivElement | undefined;

  onSettled(() => {
    if (!container) return;
    const canvas = new BpmnCanvas();
    let disposed = false;
    void canvas
      .mount(container, props.source, {
        ...(props.presentation ? { presentation: props.presentation } : {}),
        ...(props.onCommand ? { onCommand: props.onCommand } : {}),
        ...(props.onSelectionChange
          ? { onSelectionChange: props.onSelectionChange }
          : {}),
      })
      .then(() => {
        if (disposed) canvas.dispose();
        else props.onReady?.(canvas);
      })
      .catch((error: unknown) =>
        props.onError?.(
          error instanceof Error ? error : new Error(String(error)),
        ),
      );
    return () => {
      disposed = true;
      canvas.dispose();
    };
  });

  return (
    <div
      class="bpmn-surface"
      aria-label="BPMN diagram"
      ref={(element) => {
        container = element;
      }}
    />
  );
}
