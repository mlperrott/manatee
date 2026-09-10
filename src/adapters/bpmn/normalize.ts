import type { DocumentDiagnostic } from "../../core/document/types";
import {
  MANATEE_BPMN_NAMESPACE,
  readBpmnSource,
} from "../../core/bpmn/bpmnSource";
import {
  isDescendantOf,
  xmlAttribute,
  xmlAttributeByLocalName,
  type XmlElementRange,
  type XmlRangeIndex,
} from "../../core/bpmn/xmlRangeIndex";
import type {
  BpmnEdge,
  BpmnElement,
  BpmnElementStyle,
  BpmnPresentationModel,
  BpmnSemanticModel,
  BpmnShape,
} from "./model";

interface ModdleElement {
  readonly $type?: string;
  readonly $parent?: ModdleElement;
  readonly id?: string;
  readonly name?: string;
  readonly sourceRef?: ModdleElement;
  readonly targetRef?: ModdleElement;
  readonly bpmnElement?: ModdleElement;
  readonly bounds?: {
    readonly x?: number;
    readonly y?: number;
    readonly width?: number;
    readonly height?: number;
  };
  readonly waypoint?: readonly { readonly x?: number; readonly y?: number }[];
}

export interface BpmnModdleParseResult {
  readonly rootElement: ModdleElement;
  readonly elementsById: Readonly<Record<string, ModdleElement>>;
  readonly warnings: readonly { readonly message?: string }[];
}

const connectionTypes = new Set([
  "bpmn:SequenceFlow",
  "bpmn:MessageFlow",
  "bpmn:Association",
  "bpmn:DataInputAssociation",
  "bpmn:DataOutputAssociation",
]);

const visualTypes = new Set([
  "bpmn:Participant",
  "bpmn:Lane",
  "bpmn:StartEvent",
  "bpmn:EndEvent",
  "bpmn:IntermediateCatchEvent",
  "bpmn:IntermediateThrowEvent",
  "bpmn:BoundaryEvent",
  "bpmn:Task",
  "bpmn:UserTask",
  "bpmn:ServiceTask",
  "bpmn:ManualTask",
  "bpmn:ScriptTask",
  "bpmn:BusinessRuleTask",
  "bpmn:SendTask",
  "bpmn:ReceiveTask",
  "bpmn:CallActivity",
  "bpmn:SubProcess",
  "bpmn:Transaction",
  "bpmn:ExclusiveGateway",
  "bpmn:ParallelGateway",
  "bpmn:InclusiveGateway",
  "bpmn:EventBasedGateway",
  "bpmn:ComplexGateway",
  "bpmn:DataObjectReference",
  "bpmn:DataStoreReference",
  "bpmn:TextAnnotation",
  "bpmn:Group",
  ...connectionTypes,
]);

function isVisualType(type: string): boolean {
  return visualTypes.has(type) || /(?:Choreography|Conversation)/u.test(type);
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function semanticElement(value: ModdleElement): BpmnElement | undefined {
  const id = value.id;
  const type = value.$type;
  if (!id || !type || !isVisualType(type)) return;
  return {
    id,
    type,
    name: value.name ?? "",
    parentId: value.$parent?.id,
    sourceId: value.sourceRef?.id,
    targetId: value.targetRef?.id,
  };
}

function shape(
  value: ModdleElement,
): BpmnPresentationModel["shapes"][string] | undefined {
  if (
    value.$type !== "bpmndi:BPMNShape" ||
    !value.id ||
    !value.bpmnElement?.id
  ) {
    return;
  }
  const x = finite(value.bounds?.x);
  const y = finite(value.bounds?.y);
  const width = finite(value.bounds?.width);
  const height = finite(value.bounds?.height);
  if (
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined
  ) {
    return;
  }
  return {
    diId: value.id,
    elementId: value.bpmnElement.id,
    bounds: { x, y, width, height },
    fill: undefined,
    stroke: undefined,
  };
}

function edge(value: ModdleElement): BpmnEdge | undefined {
  if (
    value.$type !== "bpmndi:BPMNEdge" ||
    !value.id ||
    !value.bpmnElement?.id
  ) {
    return;
  }
  const waypoints = (value.waypoint ?? []).flatMap((point) => {
    const x = finite(point.x);
    const y = finite(point.y);
    return x === undefined || y === undefined ? [] : [{ x, y }];
  });
  if (waypoints.length < 2) return;
  return {
    diId: value.id,
    elementId: value.bpmnElement.id,
    waypoints: Object.freeze(waypoints),
  };
}

function namespaceFor(
  source: string,
  index: XmlRangeIndex,
  element: XmlElementRange,
): string | undefined {
  const prefix = element.name.includes(":") ? element.name.split(":")[0] : "";
  const attributeName = prefix ? `xmlns:${prefix}` : "xmlns";
  let current: XmlElementRange | undefined = element;
  while (current) {
    const namespace = xmlAttribute(source, current, attributeName);
    if (namespace) return namespace;
    current =
      current.parentIndex === undefined
        ? undefined
        : index.elements[current.parentIndex];
  }
  return;
}

function stylesFromSource(
  source: string,
  index: XmlRangeIndex,
  elements: readonly BpmnElement[],
): Readonly<Record<string, BpmnElementStyle>> {
  const styles: Record<string, BpmnElementStyle> = {};
  const presentation = index.elements.find(
    (element) =>
      element.localName === "presentation" &&
      namespaceFor(source, index, element) === MANATEE_BPMN_NAMESPACE,
  );
  if (presentation) {
    for (const rule of index.elements.filter(
      (candidate) =>
        candidate.localName === "rule" &&
        isDescendantOf(index, candidate, presentation),
    )) {
      const type = xmlAttributeByLocalName(source, rule, "type");
      if (!type) continue;
      const ruleStyle = {
        fill: xmlAttributeByLocalName(source, rule, "fill"),
        stroke: xmlAttributeByLocalName(source, rule, "stroke"),
      };
      for (const element of elements.filter(
        (candidate) => candidate.type === type,
      )) {
        styles[element.id] = ruleStyle;
      }
    }
    for (const element of index.elements.filter(
      (candidate) =>
        candidate.localName === "element" &&
        isDescendantOf(index, candidate, presentation),
    )) {
      const ref = xmlAttributeByLocalName(source, element, "ref");
      if (!ref) continue;
      const previous = styles[ref];
      styles[ref] = {
        fill:
          xmlAttributeByLocalName(source, element, "fill") ?? previous?.fill,
        stroke:
          xmlAttributeByLocalName(source, element, "stroke") ??
          previous?.stroke,
      };
    }
  }
  return Object.freeze(styles);
}

function addCompatibilityDiagnostics(
  source: string,
  index: XmlRangeIndex,
  elements: readonly BpmnElement[],
  diagnostics: DocumentDiagnostic[],
): void {
  const unsupported = elements.filter(({ type }) =>
    /(?:Choreography|Conversation)/u.test(type),
  );
  for (const element of unsupported) {
    diagnostics.push({
      code: "bpmn.unsupported.notation",
      message: `${element.type} ${element.id} is preserved but is not visually supported in this release.`,
      severity: "warning",
      path: `semantic.elements.${element.id}`,
    });
  }
  const executionAttributes = new Set([
    "implementation",
    "operationRef",
    "calledElement",
    "scriptFormat",
  ]);
  for (const element of index.elements) {
    const id = xmlAttributeByLocalName(source, element, "id");
    if (
      id &&
      element.attributes.some(({ localName }) =>
        executionAttributes.has(localName),
      )
    ) {
      diagnostics.push({
        code: "bpmn.execution.preserved",
        message: `Execution configuration on ${id} is preserved but is not edited visually.`,
        severity: "info",
        path: `semantic.elements.${id}`,
      });
    }
  }
  const standardPrefixes = new Set([
    "bpmn",
    "bpmn2",
    "bpmndi",
    "dc",
    "di",
    "xsi",
    "xml",
    "manatee",
    "bioc",
  ]);
  const prefixes = new Set(
    [...source.matchAll(/<\/?([A-Za-z_][\w.-]*):/gu)]
      .map((match) => match[1])
      .filter((prefix): prefix is string => Boolean(prefix)),
  );
  for (const prefix of prefixes) {
    if (standardPrefixes.has(prefix)) continue;
    diagnostics.push({
      code: "bpmn.vendor-extension.preserved",
      message: `The ${prefix} extension is preserved but is not edited or rendered by Manatee.`,
      severity: "info",
      path: `xml.namespaces.${prefix}`,
    });
  }
}

export function normalizeBpmn(
  source: string,
  parsed: BpmnModdleParseResult,
): {
  readonly semantic: BpmnSemanticModel;
  readonly presentation: BpmnPresentationModel;
} {
  const sourceRead = readBpmnSource(source, { kind: "bpmn" });
  const diagnostics: DocumentDiagnostic[] = [...sourceRead.diagnostics];
  for (const warning of parsed.warnings) {
    diagnostics.push({
      code: "bpmn.parse.warning",
      message: warning.message ?? "bpmn-moddle reported a parse warning.",
      severity: "warning",
      path: "semantic",
    });
  }
  const values = Object.values(parsed.elementsById);
  const elements = values.flatMap((value) => {
    const normalized = semanticElement(value);
    return normalized ? [normalized] : [];
  });
  addCompatibilityDiagnostics(source, sourceRead.index, elements, diagnostics);
  const shapes: Record<string, BpmnShape> = {};
  const edges: Record<string, BpmnEdge> = {};
  for (const value of values) {
    const normalizedShape = shape(value);
    if (normalizedShape) {
      const sourceShape = sourceRead.index.elements.find(
        (element) =>
          element.localName === "BPMNShape" &&
          xmlAttributeByLocalName(source, element, "bpmnElement") ===
            normalizedShape.elementId,
      );
      shapes[normalizedShape.elementId] = {
        ...normalizedShape,
        fill: sourceShape
          ? xmlAttributeByLocalName(source, sourceShape, "fill")
          : undefined,
        stroke: sourceShape
          ? xmlAttributeByLocalName(source, sourceShape, "stroke")
          : undefined,
      };
    }
    const normalizedEdge = edge(value);
    if (normalizedEdge) edges[normalizedEdge.elementId] = normalizedEdge;
  }
  const expectedConnections = elements.filter(({ type }) =>
    connectionTypes.has(type),
  );
  const expectedShapes = elements.filter(
    ({ type }) => !connectionTypes.has(type),
  );
  const requiresLayout =
    expectedShapes.some(({ id }) => !shapes[id]) ||
    expectedConnections.some(({ id }) => !edges[id]);
  if (requiresLayout) {
    diagnostics.push({
      code: "bpmn.di.incomplete",
      message:
        "BPMN Diagram Interchange is missing or partial; Reset layout can recover it.",
      severity: "info",
      path: "presentation.di",
    });
  }
  const semantic: BpmnSemanticModel = Object.freeze({
    elements: Object.freeze(elements),
    diagnostics: Object.freeze(diagnostics),
  });
  const presentation: BpmnPresentationModel = Object.freeze({
    shapes: Object.freeze(shapes),
    edges: Object.freeze(edges),
    styles: stylesFromSource(source, sourceRead.index, elements),
    requiresLayout,
  });
  return { semantic, presentation };
}
