import type { DocumentDiagnostic } from "../../../core/document/types";
import type { MermaidSemanticModel } from "../model";

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Bounds extends Point {
  readonly width: number;
  readonly height: number;
}

export interface ComputedTextStyle {
  readonly color: string;
  readonly size: number;
  readonly weight: 400 | 500 | 600 | 700;
  readonly italic: boolean;
}

export interface ComputedNodeStyle {
  readonly fill: string;
  readonly outline: {
    readonly color: string;
    readonly width: number;
    readonly style: "solid" | "dashed" | "dotted";
  };
  readonly text: ComputedTextStyle;
}

export interface ComputedRelationshipStyle {
  readonly color: string;
  readonly width: number;
  readonly style: "solid" | "dashed" | "dotted";
  readonly text: ComputedTextStyle;
}

export interface LayoutNode extends Bounds {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly parentId: string | undefined;
  readonly manual: boolean;
  readonly style: ComputedNodeStyle;
}

export interface LayoutGroup extends Bounds {
  readonly id: string;
  readonly label: string;
  readonly kind: "subgraph" | "lane" | "boundary";
  readonly parentId: string | undefined;
  readonly padding: number;
  readonly style: ComputedNodeStyle;
}

export interface LayoutRelationship {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly kind: string;
  readonly label: string;
  readonly points: readonly Point[];
  readonly style: ComputedRelationshipStyle;
}

export interface MermaidScene {
  readonly width: number;
  readonly height: number;
  readonly nodes: readonly LayoutNode[];
  readonly groups: readonly LayoutGroup[];
  readonly relationships: readonly LayoutRelationship[];
  readonly diagnostics: readonly DocumentDiagnostic[];
  readonly sourceModel: MermaidSemanticModel;
}

export interface LayoutSpacing {
  readonly node: number;
  readonly layer: number;
  readonly groupPadding: number;
  readonly lane: number;
}

export interface LayoutOptions {
  readonly previousModel?: MermaidSemanticModel;
  readonly reset?: boolean;
  readonly selectedElementId?: string;
}
