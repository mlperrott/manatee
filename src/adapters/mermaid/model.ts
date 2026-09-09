import type { DocumentDiagnostic } from "../../core/document/types";

export type MermaidFamily =
  "flowchart" | "swimlane" | "c4-context" | "c4-container";

export type DiagramDirection = "TB" | "TD" | "BT" | "LR" | "RL";

export interface MermaidStyle {
  readonly declarations: Readonly<Record<string, string>>;
}

export interface MermaidNode {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly parentId: string | undefined;
  readonly classes: readonly string[];
  readonly style: MermaidStyle;
  readonly technology: string | undefined;
  readonly description: string | undefined;
}

export interface MermaidGroup {
  readonly id: string;
  readonly label: string;
  readonly kind: "subgraph" | "lane" | "boundary";
  readonly parentId: string | undefined;
  readonly direction: DiagramDirection | undefined;
  readonly classes: readonly string[];
  readonly style: MermaidStyle;
}

export type RelationshipIdentity =
  | { readonly kind: "authored"; readonly id: string }
  | {
      readonly kind: "matcher";
      readonly source: string;
      readonly target: string;
      readonly relationshipKind: string;
    }
  | {
      readonly kind: "ambiguous";
      readonly source: string;
      readonly target: string;
      readonly relationshipKind: string;
    };

export interface MermaidRelationship {
  readonly id: string;
  readonly identity: RelationshipIdentity;
  readonly source: string;
  readonly target: string;
  readonly kind: string;
  readonly label: string;
  readonly technology: string | undefined;
  readonly description: string | undefined;
  readonly directionHint: DiagramDirection | undefined;
  readonly classes: readonly string[];
  readonly style: MermaidStyle;
}

export interface MermaidClassDefinition {
  readonly id: string;
  readonly style: MermaidStyle;
  readonly textStyle: MermaidStyle;
}

export interface MermaidSemanticModel {
  readonly family: MermaidFamily;
  readonly direction: DiagramDirection | undefined;
  readonly nodes: readonly MermaidNode[];
  readonly groups: readonly MermaidGroup[];
  readonly relationships: readonly MermaidRelationship[];
  readonly classDefinitions: Readonly<Record<string, MermaidClassDefinition>>;
  readonly diagnostics: readonly DocumentDiagnostic[];
}

export interface MermaidPresentationModel {
  readonly metadata: Readonly<Record<string, unknown>> | undefined;
}

export interface MermaidView {
  readonly family: MermaidFamily;
  readonly model: MermaidSemanticModel;
}

export const MERMAID_ADAPTER_ID = "manatee/mermaid" as const;
