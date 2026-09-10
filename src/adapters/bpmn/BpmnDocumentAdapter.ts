import type { DocumentAdapter } from "../DocumentAdapter";
import {
  TransactionalDocumentEngine,
  type DocumentParser,
} from "../../core/document/TransactionalDocumentEngine";
import type {
  CommandResult,
  DocumentCommand,
} from "../../core/document/DocumentEngine";
import type {
  DocumentDiagnostic,
  DocumentHint,
  DocumentSnapshot,
  ParsedDocument,
} from "../../core/document/types";
import { UnsafeSourcePatchError } from "../../core/source/patches";
import {
  MANATEE_BPMN_NAMESPACE,
  patchBpmnEdgeWaypoints,
  patchBpmnShapeBounds,
  readBpmnSource,
  type BpmnBounds,
} from "../../core/bpmn/bpmnSource";
import {
  xmlAttribute,
  xmlAttributeByLocalName,
  type XmlElementRange,
  type XmlRangeIndex,
} from "../../core/bpmn/xmlRangeIndex";
import {
  BpmnAutoLayout,
  type BpmnLayoutService,
} from "./layout/BpmnAutoLayout";
import { manateeModdleDescriptor } from "./manateeDescriptor";
import type {
  BpmnPresentationModel,
  BpmnSemanticModel,
  BpmnView,
} from "./model";
import { normalizeBpmn, type BpmnModdleParseResult } from "./normalize";
import {
  patchBpmnDiagramInterchange,
  patchBpmnElementStyle,
} from "./sourcePatches";

export type BpmnDocumentSnapshot = DocumentSnapshot<
  BpmnSemanticModel,
  BpmnPresentationModel,
  BpmnView
>;

function invalid(
  diagnostics: readonly DocumentDiagnostic[],
): ParsedDocument<BpmnSemanticModel, BpmnPresentationModel, BpmnView> {
  return { valid: false, kind: "bpmn", diagnostics };
}

function metadataVersion(source: string): {
  readonly supported: boolean;
  readonly diagnostics: readonly DocumentDiagnostic[];
} {
  const read = readBpmnSource(source, { kind: "bpmn" });
  const namespaceFor = (
    index: XmlRangeIndex,
    element: XmlElementRange,
  ): string | undefined => {
    const prefix = element.name.includes(":") ? element.name.split(":")[0] : "";
    let current: XmlElementRange | undefined = element;
    while (current) {
      const namespace = xmlAttribute(
        source,
        current,
        prefix ? `xmlns:${prefix}` : "xmlns",
      );
      if (namespace) return namespace;
      current =
        current.parentIndex === undefined
          ? undefined
          : index.elements[current.parentIndex];
    }
    return;
  };
  const presentations = read.index.elements.filter(
    (element) =>
      element.localName === "presentation" &&
      namespaceFor(read.index, element) === MANATEE_BPMN_NAMESPACE,
  );
  if (presentations.length === 0) return { supported: true, diagnostics: [] };
  if (presentations.length > 1) {
    return {
      supported: false,
      diagnostics: [
        {
          code: "bpmn.metadata.duplicate",
          message:
            "The document contains more than one Manatee presentation element.",
          severity: "error",
          path: "presentation",
        },
      ],
    };
  }
  const version = xmlAttributeByLocalName(source, presentations[0]!, "version");
  return version === "1"
    ? { supported: true, diagnostics: [] }
    : {
        supported: false,
        diagnostics: [
          {
            code: "bpmn.metadata.unknown-version",
            message: `Manatee presentation version ${version ?? "missing"} is preserved but cannot be edited.`,
            severity: "error",
            path: "presentation.version",
          },
        ],
      };
}

const parser: DocumentParser<
  BpmnSemanticModel,
  BpmnPresentationModel,
  BpmnView
> = {
  async parse(source, hint) {
    const sourceRead = readBpmnSource(source, hint);
    if (sourceRead.kind !== "bpmn") {
      return invalid([
        ...sourceRead.diagnostics,
        {
          code: "bpmn.detect",
          message: "The source is not a BPMN 2.0 document.",
          severity: "error",
          path: "xml.definitions",
        },
      ]);
    }
    if (!sourceRead.valid) return invalid(sourceRead.diagnostics);
    try {
      const { BpmnModdle } = await import("bpmn-moddle");
      const moddle = new BpmnModdle({ manatee: manateeModdleDescriptor });
      const parsed = (await moddle.fromXML(source)) as BpmnModdleParseResult;
      const normalized = normalizeBpmn(source, parsed);
      const metadata = metadataVersion(source);
      const diagnostics = [
        ...normalized.semantic.diagnostics,
        ...metadata.diagnostics,
      ];
      const semanticModel = Object.freeze({
        ...normalized.semantic,
        diagnostics: Object.freeze(diagnostics),
      });
      const view = Object.freeze({
        model: semanticModel,
        presentation: normalized.presentation,
      });
      return {
        valid: true,
        kind: "bpmn",
        semanticModel,
        presentationModel: normalized.presentation,
        view,
        diagnostics,
        visualEditing: metadata.supported,
        imageExport: !normalized.presentation.requiresLayout,
      };
    } catch (error) {
      return invalid([
        ...sourceRead.diagnostics,
        {
          code: "bpmn.parse",
          message:
            error instanceof Error
              ? error.message
              : "bpmn-moddle could not parse this document.",
          severity: "error",
          path: "semantic",
        },
      ]);
    }
  },
};

export class BpmnDocumentAdapter implements DocumentAdapter<BpmnDocumentSnapshot> {
  readonly kind = "bpmn" as const;
  readonly #engine = new TransactionalDocumentEngine(parser);
  readonly #layout: BpmnLayoutService;

  constructor(layout: BpmnLayoutService = new BpmnAutoLayout()) {
    this.#layout = layout;
  }

  matches(source: string, hint?: DocumentHint): boolean {
    if (hint?.kind === "mermaid") return false;
    return readBpmnSource(source, hint).kind === "bpmn";
  }

  open(source: string, hint?: DocumentHint): Promise<BpmnDocumentSnapshot> {
    return this.#engine.open(source, hint);
  }

  execute(
    command: DocumentCommand,
  ): Promise<CommandResult<BpmnDocumentSnapshot>> {
    return this.#engine.execute(command);
  }

  replaceSource(source: string): Promise<BpmnDocumentSnapshot> {
    return this.#engine.replaceSource(source);
  }

  snapshot(): BpmnDocumentSnapshot {
    return this.#engine.snapshot();
  }

  async moveOrResize(
    elementId: string,
    bounds: BpmnBounds,
  ): Promise<CommandResult<BpmnDocumentSnapshot>> {
    const edit = patchBpmnShapeBounds(
      this.snapshot().source,
      elementId,
      bounds,
    );
    return this.#engine.execute({
      type: "apply-patches",
      patches: edit.patches,
      reason: "visual",
    });
  }

  async route(
    elementId: string,
    waypoints: readonly { readonly x: number; readonly y: number }[],
  ): Promise<CommandResult<BpmnDocumentSnapshot>> {
    const edit = patchBpmnEdgeWaypoints(
      this.snapshot().source,
      elementId,
      waypoints,
    );
    return this.#engine.execute({
      type: "apply-patches",
      patches: edit.patches,
      reason: "visual",
    });
  }

  async style(
    elementId: string,
    style: Readonly<{ fill?: string; stroke?: string }>,
  ): Promise<CommandResult<BpmnDocumentSnapshot>> {
    const edit = patchBpmnElementStyle(
      this.snapshot().source,
      elementId,
      style,
    );
    return this.#engine.execute({
      type: "apply-patches",
      patches: edit.patches,
      reason: "visual",
    });
  }

  async resetLayout(): Promise<CommandResult<BpmnDocumentSnapshot>> {
    const current = this.snapshot();
    const generated = await this.#layout.layout(current.source);
    if (generated.warnings.length > 0) {
      throw new UnsafeSourcePatchError(
        `Automatic layout left unsupported geometry: ${generated.warnings
          .map(({ code, message }) => code ?? message)
          .join(", ")}.`,
      );
    }
    const edit = patchBpmnDiagramInterchange(current.source, generated.source);
    return this.#engine.execute({
      type: "apply-patches",
      patches: edit.patches,
      reason: "reset-layout",
    });
  }

  async recoverMissingDi(): Promise<BpmnDocumentSnapshot> {
    const current = this.snapshot();
    if (!current.presentationModel?.requiresLayout) return current;
    return (await this.resetLayout()).snapshot;
  }

  dispose(): void {
    this.#layout.dispose();
  }
}
