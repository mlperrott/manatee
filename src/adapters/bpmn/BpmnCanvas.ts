import type { BpmnPresentationModel } from "./model";
import { manateeModdleDescriptor } from "./manateeDescriptor";
import type { DocumentCommand } from "../../core/document/DocumentEngine";

export interface BpmnGeometryChange {
  readonly elementId: string;
  readonly bounds?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly waypoints?: readonly { readonly x: number; readonly y: number }[];
}

export interface BpmnCanvasOptions {
  readonly presentation?: BpmnPresentationModel;
  readonly onCommand?: (command: DocumentCommand) => void | Promise<void>;
  readonly onSelectionChange?: (elementId: string | undefined) => void;
}

interface RegistryElement {
  readonly id: string;
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly waypoints?: readonly { readonly x: number; readonly y: number }[];
}

interface ElementRegistry {
  get(id: string): RegistryElement | undefined;
  getAll(): readonly RegistryElement[];
}

interface CanvasService {
  zoom(level: "fit-viewport" | number): void;
}

interface ModelingService {
  setColor(
    elements: readonly RegistryElement[],
    colors: Readonly<{ fill?: string; stroke?: string }>,
  ): void;
}

interface BpmnModeler {
  importXML(source: string): Promise<{ warnings: readonly unknown[] }>;
  saveSVG(): Promise<{ svg?: string }>;
  get(name: "canvas"): CanvasService;
  get(name: "elementRegistry"): ElementRegistry;
  get(name: "modeling"): ModelingService;
  on(event: string, callback: (event: unknown) => void): void;
  destroy(): void;
}

function geometry(element: RegistryElement): BpmnGeometryChange | undefined {
  if (element.waypoints && element.waypoints.length >= 2) {
    return {
      elementId: element.id,
      waypoints: Object.freeze(element.waypoints.map(({ x, y }) => ({ x, y }))),
    };
  }
  const { x, y, width, height } = element;
  return x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined
    ? undefined
    : { elementId: element.id, bounds: { x, y, width, height } };
}

function withExportAttribution(svg: string): string {
  if (svg.includes("data-bpmn-io-attribution")) return svg;
  const viewBox =
    /viewBox=["']([\d.e+-]+)\s+([\d.e+-]+)\s+([\d.e+-]+)\s+([\d.e+-]+)["']/u.exec(
      svg,
    );
  const x = viewBox ? Number(viewBox[1]) + Number(viewBox[3]) - 8 : 992;
  const y = viewBox ? Number(viewBox[2]) + Number(viewBox[4]) - 8 : 992;
  const attribution = `<a data-bpmn-io-attribution="true" href="https://bpmn.io" target="_blank" rel="noopener"><text x="${x}" y="${y}" text-anchor="end" font-family="Arial, sans-serif" font-size="11" fill="#525252">Created with bpmn.io</text></a>`;
  return svg.replace(/<\/svg>\s*$/u, `${attribution}</svg>`);
}

export class BpmnCanvas implements Disposable {
  #modeler: BpmnModeler | undefined;
  #source = "";
  #options: BpmnCanvasOptions = {};
  #presentation: BpmnPresentationModel | undefined;
  #selectedElementId: string | undefined;
  #importing = false;
  #commandPending = false;

  async mount(
    container: HTMLElement,
    source: string,
    options: BpmnCanvasOptions = {},
  ): Promise<void> {
    this.dispose();
    this.#options = options;
    await Promise.all([
      import("bpmn-js/dist/assets/diagram-js.css"),
      import("bpmn-js/dist/assets/bpmn-font/css/bpmn.css"),
    ]);
    const { default: Modeler } = await import("bpmn-js/lib/Modeler");
    const modeler = new Modeler({
      container,
      moddleExtensions: { manatee: manateeModdleDescriptor },
    }) as unknown as BpmnModeler;
    this.#modeler = modeler;
    modeler.on("commandStack.changed", () => this.#emitGeometry());
    modeler.on("selection.changed", (event) => {
      const selection = (
        event as { readonly newSelection?: readonly RegistryElement[] }
      ).newSelection;
      this.#selectedElementId = selection?.[0]?.id;
      this.#options.onSelectionChange?.(this.#selectedElementId);
    });
    await this.importSource(source, options.presentation);
  }

  async importSource(
    source: string,
    presentation = this.#options.presentation,
  ): Promise<void> {
    const modeler = this.#requireModeler();
    this.#importing = true;
    try {
      await modeler.importXML(source);
      this.#source = source;
      this.#presentation = presentation;
      this.#applyStyles(presentation);
      modeler.get("canvas").zoom("fit-viewport");
    } finally {
      this.#commandPending = false;
      this.#importing = false;
    }
  }

  source(): string {
    return this.#source;
  }

  geometry(elementId: string): BpmnGeometryChange | undefined {
    const element = this.#modeler?.get("elementRegistry").get(elementId);
    return element ? geometry(element) : undefined;
  }

  setZoom(level: number): void {
    this.#requireModeler().get("canvas").zoom(level);
  }

  async exportSvg(): Promise<string> {
    const { svg } = await this.#requireModeler().saveSVG();
    if (!svg) throw new Error("bpmn-js did not produce SVG output.");
    return withExportAttribution(svg);
  }

  [Symbol.dispose](): void {
    this.dispose();
  }

  dispose(): void {
    this.#modeler?.destroy();
    this.#modeler = undefined;
    this.#source = "";
    this.#presentation = undefined;
    this.#selectedElementId = undefined;
    this.#commandPending = false;
  }

  #applyStyles(presentation: BpmnPresentationModel | undefined): void {
    if (!presentation || !this.#modeler) return;
    const registry = this.#modeler.get("elementRegistry");
    const modeling = this.#modeler.get("modeling");
    for (const [elementId, style] of Object.entries(presentation.styles)) {
      const element = registry.get(elementId);
      if (!element) continue;
      const colors: { fill?: string; stroke?: string } = {};
      if (style.fill) colors.fill = style.fill;
      if (style.stroke) colors.stroke = style.stroke;
      if (colors.fill || colors.stroke) modeling.setColor([element], colors);
    }
  }

  #emitGeometry(): void {
    const callback = this.#options.onCommand;
    const id = this.#selectedElementId;
    if (
      !callback ||
      !id ||
      !this.#modeler ||
      this.#importing ||
      this.#commandPending
    ) {
      return;
    }
    const element = this.#modeler.get("elementRegistry").get(id);
    if (!element) return;
    const current = geometry(element);
    const beforeShape = this.#presentation?.shapes[id]?.bounds;
    const beforeEdge = this.#presentation?.edges[id]?.waypoints;
    let command: DocumentCommand | undefined;
    if (current?.bounds && beforeShape) {
      command =
        current.bounds.width !== beforeShape.width ||
        current.bounds.height !== beforeShape.height
          ? { type: "resize", elementId: id, bounds: current.bounds }
          : current.bounds.x !== beforeShape.x ||
              current.bounds.y !== beforeShape.y
            ? {
                type: "move",
                elementId: id,
                dx: current.bounds.x - beforeShape.x,
                dy: current.bounds.y - beforeShape.y,
              }
            : undefined;
    } else if (
      current?.waypoints &&
      beforeEdge &&
      !samePoints(current.waypoints, beforeEdge)
    ) {
      command = { type: "route", elementId: id, waypoints: current.waypoints };
    }
    if (!command) return;
    this.#commandPending = true;
    void Promise.resolve(callback(command)).finally(() => {
      this.#commandPending = false;
    });
  }

  #requireModeler(): BpmnModeler {
    if (!this.#modeler) throw new Error("Mount the BPMN canvas first.");
    return this.#modeler;
  }
}

function samePoints(
  left: readonly { readonly x: number; readonly y: number }[],
  right: readonly { readonly x: number; readonly y: number }[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (point, index) =>
        point.x === right[index]?.x && point.y === right[index]?.y,
    )
  );
}

export { withExportAttribution as addBpmnExportAttribution };
