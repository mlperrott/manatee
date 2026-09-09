import type { DocumentAdapter } from "../DocumentAdapter";
import type {
  CommandResult,
  DocumentCommand,
} from "../../core/document/DocumentEngine";
import {
  TransactionalDocumentEngine,
  type DocumentParser,
} from "../../core/document/TransactionalDocumentEngine";
import type {
  DocumentDiagnostic,
  DocumentHint,
  DocumentSnapshot,
  ParsedDocument,
  SourceRange,
} from "../../core/document/types";
import { readManateeMetadata } from "../../core/metadata/manateeMetadata";
import { inspectMermaidCompatibility, mermaidFamily } from "./compatibility";
import { mermaidFamilyAdapters } from "./familyAdapters";
import type {
  MermaidPresentationModel,
  MermaidSemanticModel,
  MermaidView,
} from "./model";
import { parseMermaidDiagram } from "./runtimeContract";

export type MermaidDocumentSnapshot = DocumentSnapshot<
  MermaidSemanticModel,
  MermaidPresentationModel,
  MermaidView
>;

interface MermaidParseLocation {
  readonly first_line?: number;
  readonly first_column?: number;
  readonly last_line?: number;
  readonly last_column?: number;
}

interface MermaidParseError {
  readonly message?: unknown;
  readonly hash?: { readonly loc?: MermaidParseLocation };
}

function positionAt(source: string, line: number, column: number): number {
  let position = 0;
  for (let currentLine = 1; currentLine < line; currentLine += 1) {
    const newline = source.indexOf("\n", position);
    if (newline < 0) return source.length;
    position = newline + 1;
  }
  return Math.min(source.length, position + column);
}

function parseErrorRange(
  source: string,
  error: MermaidParseError,
): SourceRange | undefined {
  const location = error.hash?.loc;
  if (!location?.first_line) return;
  const start = positionAt(
    source,
    location.first_line,
    location.first_column ?? 0,
  );
  const end = positionAt(
    source,
    location.last_line ?? location.first_line,
    (location.last_column ?? location.first_column ?? 0) + 1,
  );
  return { start, end: Math.max(start, end) };
}

function invalidParse(
  source: string,
  error: unknown,
  diagnostics: readonly DocumentDiagnostic[],
): ParsedDocument<MermaidSemanticModel, MermaidPresentationModel, MermaidView> {
  const parseError =
    typeof error === "object" && error !== null
      ? (error as MermaidParseError)
      : undefined;
  const range = parseError ? parseErrorRange(source, parseError) : undefined;
  return {
    valid: false,
    kind: "mermaid",
    diagnostics: [
      ...diagnostics,
      {
        code: "mermaid.parse",
        message:
          typeof parseError?.message === "string"
            ? parseError.message
            : "Mermaid could not parse this diagram.",
        severity: "error",
        ...(range ? { range } : {}),
        path: "semantic",
      },
    ],
  };
}

const parser: DocumentParser<
  MermaidSemanticModel,
  MermaidPresentationModel,
  MermaidView
> = {
  async parse(
    source,
  ): Promise<
    ParsedDocument<MermaidSemanticModel, MermaidPresentationModel, MermaidView>
  > {
    const compatibility = inspectMermaidCompatibility(source);
    const metadata = readManateeMetadata(source);
    const diagnostics = [...metadata.diagnostics, ...compatibility.diagnostics];

    let diagram;
    try {
      diagram = await parseMermaidDiagram(source);
    } catch (error) {
      return invalidParse(source, error, diagnostics);
    }

    if (!compatibility.family || compatibility.unsupported) {
      return { valid: false, kind: "mermaid", diagnostics };
    }

    const model = mermaidFamilyAdapters[compatibility.family].normalize(
      diagram,
      diagnostics,
    );
    if (!model) {
      return invalidParse(
        source,
        new Error(
          `Mermaid ${diagram.type} did not satisfy the pinned adapter contract.`,
        ),
        diagnostics,
      );
    }

    if (model.diagnostics.some(({ severity }) => severity === "error")) {
      return {
        valid: false,
        kind: "mermaid",
        diagnostics: model.diagnostics,
      };
    }

    return {
      valid: true,
      kind: "mermaid",
      semanticModel: model,
      presentationModel: { metadata: metadata.metadata },
      view: { family: model.family, model },
      diagnostics: model.diagnostics,
      visualEditing: metadata.visualEditing,
      imageExport: true,
    };
  },
};

export class MermaidDocumentAdapter implements DocumentAdapter<MermaidDocumentSnapshot> {
  readonly kind = "mermaid" as const;
  readonly #engine = new TransactionalDocumentEngine(parser);

  matches(source: string, hint?: DocumentHint): boolean {
    if (hint?.kind === "bpmn") return false;
    if (hint?.kind === "mermaid") return true;
    const filename = hint?.filename?.toLowerCase();
    return (
      filename?.endsWith(".mmd") === true ||
      filename?.endsWith(".mermaid") === true ||
      mermaidFamily(source) !== undefined
    );
  }

  open(source: string, hint?: DocumentHint): Promise<MermaidDocumentSnapshot> {
    return this.#engine.open(source, hint);
  }

  execute(
    command: DocumentCommand,
  ): Promise<CommandResult<MermaidDocumentSnapshot>> {
    return this.#engine.execute(command);
  }

  replaceSource(source: string): Promise<MermaidDocumentSnapshot> {
    return this.#engine.replaceSource(source);
  }

  snapshot(): MermaidDocumentSnapshot {
    return this.#engine.snapshot();
  }
}
