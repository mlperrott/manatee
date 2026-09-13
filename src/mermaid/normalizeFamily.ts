import type { DocumentDiagnostic } from "../core/document/types";
import type { MermaidFamily, MermaidSemanticModel } from "./model";
import { normalizeC4Database, normalizeFlowDatabase } from "./normalize";
import {
  isRawC4Database,
  isRawFlowDatabase,
  type ParsedMermaidRuntime,
} from "./runtimeContract";

export function normalizeMermaidFamily(
  family: MermaidFamily,
  runtime: ParsedMermaidRuntime,
  diagnostics: readonly DocumentDiagnostic[],
): MermaidSemanticModel | undefined {
  if (family === "flowchart" || family === "swimlane") {
    return isRawFlowDatabase(runtime.database)
      ? normalizeFlowDatabase(family, runtime.database, diagnostics)
      : undefined;
  }
  if (!isRawC4Database(runtime.database)) return undefined;
  const expected = family === "c4-context" ? "C4Context" : "C4Container";
  if (runtime.database.getC4Type() !== expected) return undefined;
  return normalizeC4Database(
    family,
    runtime.database.getC4ShapeArray(),
    runtime.database.getBoundaries(),
    runtime.database.getRels(),
    diagnostics,
  );
}
