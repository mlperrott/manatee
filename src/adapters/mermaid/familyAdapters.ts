import type { DocumentDiagnostic } from "../../core/document/types";
import type { MermaidFamily, MermaidSemanticModel } from "./model";
import { normalizeC4Database, normalizeFlowDatabase } from "./normalize";
import {
  isRawC4Database,
  isRawFlowDatabase,
  type ParsedMermaidRuntime,
} from "./runtimeContract";

export interface MermaidFamilyAdapter {
  readonly family: MermaidFamily;
  normalize(
    runtime: ParsedMermaidRuntime,
    diagnostics: readonly DocumentDiagnostic[],
  ): MermaidSemanticModel | undefined;
}

export class FlowchartSemanticAdapter implements MermaidFamilyAdapter {
  readonly family = "flowchart" as const;

  normalize(
    runtime: ParsedMermaidRuntime,
    diagnostics: readonly DocumentDiagnostic[],
  ): MermaidSemanticModel | undefined {
    return isRawFlowDatabase(runtime.database)
      ? normalizeFlowDatabase(this.family, runtime.database, diagnostics)
      : undefined;
  }
}

export class SwimlaneSemanticAdapter implements MermaidFamilyAdapter {
  readonly family = "swimlane" as const;

  normalize(
    runtime: ParsedMermaidRuntime,
    diagnostics: readonly DocumentDiagnostic[],
  ): MermaidSemanticModel | undefined {
    return isRawFlowDatabase(runtime.database)
      ? normalizeFlowDatabase(this.family, runtime.database, diagnostics)
      : undefined;
  }
}

abstract class C4SemanticAdapter implements MermaidFamilyAdapter {
  abstract readonly family: "c4-context" | "c4-container";
  abstract readonly runtimeType: "C4Context" | "C4Container";

  normalize(
    runtime: ParsedMermaidRuntime,
    diagnostics: readonly DocumentDiagnostic[],
  ): MermaidSemanticModel | undefined {
    if (
      !isRawC4Database(runtime.database) ||
      runtime.database.getC4Type() !== this.runtimeType
    ) {
      return;
    }
    return normalizeC4Database(
      this.family,
      runtime.database.getC4ShapeArray(),
      runtime.database.getBoundaries(),
      runtime.database.getRels(),
      diagnostics,
    );
  }
}

export class C4ContextSemanticAdapter extends C4SemanticAdapter {
  readonly family = "c4-context" as const;
  readonly runtimeType = "C4Context" as const;
}

export class C4ContainerSemanticAdapter extends C4SemanticAdapter {
  readonly family = "c4-container" as const;
  readonly runtimeType = "C4Container" as const;
}

export const mermaidFamilyAdapters: Readonly<
  Record<MermaidFamily, MermaidFamilyAdapter>
> = Object.freeze({
  flowchart: new FlowchartSemanticAdapter(),
  swimlane: new SwimlaneSemanticAdapter(),
  "c4-context": new C4ContextSemanticAdapter(),
  "c4-container": new C4ContainerSemanticAdapter(),
});
