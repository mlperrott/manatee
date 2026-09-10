import type { DocumentDiagnostic } from "../../core/document/types";
import type { BpmnBounds } from "../../core/bpmn/bpmnSource";

export interface BpmnElement {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly parentId: string | undefined;
  readonly sourceId: string | undefined;
  readonly targetId: string | undefined;
}

export interface BpmnShape {
  readonly diId: string;
  readonly elementId: string;
  readonly bounds: BpmnBounds;
  readonly fill: string | undefined;
  readonly stroke: string | undefined;
}

export interface BpmnEdge {
  readonly diId: string;
  readonly elementId: string;
  readonly waypoints: readonly { readonly x: number; readonly y: number }[];
}

export interface BpmnElementStyle {
  readonly fill: string | undefined;
  readonly stroke: string | undefined;
}

export interface BpmnSemanticModel {
  readonly elements: readonly BpmnElement[];
  readonly diagnostics: readonly DocumentDiagnostic[];
}

export interface BpmnPresentationModel {
  readonly shapes: Readonly<Record<string, BpmnShape>>;
  readonly edges: Readonly<Record<string, BpmnEdge>>;
  readonly styles: Readonly<Record<string, BpmnElementStyle>>;
  readonly requiresLayout: boolean;
}

export interface BpmnView {
  readonly model: BpmnSemanticModel;
  readonly presentation: BpmnPresentationModel;
}

export const BPMN_ADAPTER_ID = "manatee/bpmn" as const;
