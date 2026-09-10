declare module "bpmn-moddle" {
  export class BpmnModdle {
    constructor(
      additionalPackages?: Readonly<Record<string, unknown>>,
      options?: Readonly<Record<string, unknown>>,
    );
    fromXML(
      xml: string,
      typeName?: string | Readonly<Record<string, unknown>>,
      options?: Readonly<Record<string, unknown>>,
    ): Promise<{
      rootElement: unknown;
      elementsById: Readonly<Record<string, unknown>>;
      references: readonly unknown[];
      warnings: readonly { readonly message?: string }[];
    }>;
    toXML(
      element: unknown,
      options?: Readonly<Record<string, unknown>>,
    ): Promise<{ xml: string }>;
  }
}

declare module "bpmn-auto-layout" {
  export interface LayoutWarning {
    readonly code?: string;
    readonly message?: string;
  }

  export function layoutProcess(
    source: string,
  ): Promise<{ xml: string; warnings: readonly LayoutWarning[] }>;
}
