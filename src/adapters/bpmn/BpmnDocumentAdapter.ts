import type { DocumentAdapter } from "../DocumentAdapter";
import { TransactionalDocumentEngine } from "../../core/document/TransactionalDocumentEngine";
import type { DocumentParser } from "../../core/document/TransactionalDocumentEngine";
import {
  CommandUnavailableError,
  type PresentationCommand,
  type CommandResult,
  type DocumentCommand,
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
import { available, disabled, presentationAvailability } from "../presentation";

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

  async open(
    source: string,
    hint?: DocumentHint,
  ): Promise<BpmnDocumentSnapshot> {
    return this.#decorate(await this.#engine.open(source, hint));
  }

  async execute(
    command: DocumentCommand,
  ): Promise<CommandResult<BpmnDocumentSnapshot>> {
    if (isTransactionCommand(command)) {
      const result = await this.#engine.execute(command);
      return { ...result, snapshot: this.#decorate(result.snapshot) };
    }
    return await this.#executePresentation(command);
  }

  async replaceSource(source: string): Promise<BpmnDocumentSnapshot> {
    return (await this.execute({ type: "replace-source", source })).snapshot;
  }

  snapshot(): BpmnDocumentSnapshot {
    return this.#decorate(this.#engine.snapshot());
  }

  async #executePresentation(
    command: PresentationCommand,
  ): Promise<CommandResult<BpmnDocumentSnapshot>> {
    this.#requireAvailable(command);
    switch (command.type) {
      case "move": {
        const before =
          this.snapshot().presentationModel!.shapes[command.elementId]!;
        return await this.#patch(
          patchBpmnShapeBounds(this.snapshot().source, command.elementId, {
            ...before.bounds,
            x: before.bounds.x + command.dx,
            y: before.bounds.y + command.dy,
          }).patches,
          "visual",
        );
      }
      case "resize":
        return await this.#patch(
          patchBpmnShapeBounds(
            this.snapshot().source,
            command.elementId,
            command.bounds,
          ).patches,
          "visual",
        );
      case "route":
        return await this.#patch(
          patchBpmnEdgeWaypoints(
            this.snapshot().source,
            command.elementId,
            command.waypoints,
          ).patches,
          "visual",
        );
      case "set-appearance":
        return await this.#patch(
          patchBpmnElementStyle(
            this.snapshot().source,
            command.elementId,
            command.appearance,
          ).patches,
          "visual",
        );
      case "reset-layout":
        return await this.#resetLayout();
      case "set-attribute":
      case "create-styling-rule":
      case "set-spacing":
      case "use-automatic-position":
      case "cleanup-unmatched":
        throw new CommandUnavailableError(
          command.type,
          `${command.type} is not supported for BPMN documents.`,
        );
    }
  }

  async #patch(
    patches: readonly import("../../core/document/types").SourcePatch[],
    reason: "visual" | "reset-layout",
  ): Promise<CommandResult<BpmnDocumentSnapshot>> {
    if (patches.length === 0) return { snapshot: this.snapshot(), patches: [] };
    const result = await this.#engine.execute({
      type: "apply-patches",
      patches,
      reason,
    });
    return { ...result, snapshot: this.#decorate(result.snapshot) };
  }

  async #resetLayout(): Promise<CommandResult<BpmnDocumentSnapshot>> {
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
    return await this.#patch(edit.patches, "reset-layout");
  }

  async recoverMissingDi(): Promise<BpmnDocumentSnapshot> {
    const current = this.snapshot();
    if (!current.presentationModel?.requiresLayout) return current;
    return (await this.execute({ type: "reset-layout" })).snapshot;
  }

  dispose(): void {
    this.#layout.dispose();
  }

  #requireAvailable(command: PresentationCommand): void {
    const elementId = "elementId" in command ? command.elementId : undefined;
    const item = this.#availability(elementId)[command.type];
    if (item.state === "available") return;
    throw new CommandUnavailableError(
      command.type,
      item.state === "disabled"
        ? item.reason
        : `${command.type} is not supported for BPMN documents.`,
    );
  }

  #availability(elementId = this.#engine.snapshot().selectedElementId) {
    const current = this.#engine.snapshot();
    if (!current.commands.visualEditing) {
      const reason =
        current.diagnostics.find(({ severity }) => severity === "error")
          ?.message ??
        "Presentation editing is unavailable until the source is valid.";
      const unavailable = disabled(reason);
      return presentationAvailability({
        move: unavailable,
        resize: unavailable,
        route: unavailable,
        "set-appearance": unavailable,
        "reset-layout": unavailable,
      });
    }
    const model = current.semanticModel!;
    const selected = model.elements.find(({ id }) => id === elementId);
    const shape = elementId
      ? current.presentationModel?.shapes[elementId]
      : undefined;
    const edge = elementId
      ? current.presentationModel?.edges[elementId]
      : undefined;
    const reason = disabled(
      elementId
        ? "The selected element does not support this action."
        : "Select an element.",
    );
    return presentationAvailability({
      move: shape ? available : reason,
      resize: shape ? available : reason,
      route: edge ? available : reason,
      "set-appearance": selected ? available : reason,
      "reset-layout": available,
    });
  }

  #decorate(snapshot: BpmnDocumentSnapshot): BpmnDocumentSnapshot {
    const id = snapshot.selectedElementId;
    const selected = snapshot.semanticModel?.elements.find(
      (element) => element.id === id,
    );
    const provisional = Object.freeze({
      ...snapshot,
      ...(id ? { selectedElementLabel: selected?.name || id } : {}),
    });
    return Object.freeze({
      ...provisional,
      commands: Object.freeze({
        ...provisional.commands,
        presentation: this.#availability(id),
      }),
    });
  }
}

function isTransactionCommand(
  command: DocumentCommand,
): command is Exclude<DocumentCommand, PresentationCommand> {
  return ["replace-source", "select", "undo", "redo"].includes(command.type);
}
