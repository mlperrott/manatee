import type { DocumentAdapter } from "../DocumentAdapter";
import {
  CommandUnavailableError,
  type CommandResult,
  type DocumentCommand,
  type PresentationCommand,
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
import {
  findUnmatchedMetadata,
  patchManateeMetadata,
  readManateeMetadata,
} from "../../core/metadata/manateeMetadata";
import type { MetadataEdit, MetadataValue } from "../../core/metadata/types";
import { available, disabled, presentationAvailability } from "../presentation";
import { inspectMermaidCompatibility, mermaidFamily } from "./compatibility";
import { mermaidFamilyAdapters } from "./familyAdapters";
import { MermaidLayout } from "./layout/MermaidLayout";
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
  readonly #layout: MermaidLayout;
  #current: MermaidDocumentSnapshot | undefined;

  constructor(layout: MermaidLayout = new MermaidLayout()) {
    this.#layout = layout;
  }

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

  async open(
    source: string,
    hint?: DocumentHint,
  ): Promise<MermaidDocumentSnapshot> {
    const snapshot = await this.#engine.open(source, hint);
    return await this.#present(snapshot, undefined, true);
  }

  async execute(
    command: DocumentCommand,
  ): Promise<CommandResult<MermaidDocumentSnapshot>> {
    if (isTransactionCommand(command)) {
      const previousModel = this.#current?.semanticModel;
      const result = await this.#engine.execute(command);
      const snapshot = await this.#present(
        result.snapshot,
        previousModel,
        command.type !== "select",
      );
      return { ...result, snapshot };
    }
    return await this.#executePresentation(command);
  }

  async replaceSource(source: string): Promise<MermaidDocumentSnapshot> {
    return (await this.execute({ type: "replace-source", source })).snapshot;
  }

  snapshot(): MermaidDocumentSnapshot {
    if (!this.#current)
      throw new Error("Open a document before using the adapter.");
    return this.#current;
  }

  dispose(): void {
    this.#layout.dispose();
  }

  async #executePresentation(
    command: PresentationCommand,
  ): Promise<CommandResult<MermaidDocumentSnapshot>> {
    this.#requireAvailable(command);
    switch (command.type) {
      case "move":
        return await this.#edit(this.#moveEdits(command), "visual");
      case "set-appearance":
        return await this.#edit(this.#appearanceEdits(command), "visual");
      case "set-attribute":
        return await this.#edit(
          [
            {
              type: "set",
              path: [
                "elements",
                "nodes",
                command.elementId,
                "attributes",
                command.name,
              ],
              value: command.value,
            },
          ],
          "visual",
        );
      case "create-styling-rule": {
        const rules = metadataRecord(this.snapshot()).rules;
        const index = Array.isArray(rules) ? rules.length : 0;
        const style: Record<string, MetadataValue> = {};
        if (command.appearance.fill !== undefined) {
          style.fill = command.appearance.fill;
        }
        if (command.appearance.stroke !== undefined) {
          style.outline = { color: command.appearance.stroke };
        }
        return await this.#edit(
          [
            {
              type: "set",
              path: ["rules", index],
              value: {
                match: {
                  attributes: {
                    [command.attribute]: { eq: command.value },
                  },
                },
                style,
              },
            },
          ],
          "visual",
        );
      }
      case "set-spacing":
        return await this.#edit(
          [
            {
              type: "set",
              path: ["layout", "spacing", command.spacing],
              value: command.value,
            },
          ],
          "visual",
        );
      case "use-automatic-position":
        return await this.#edit(
          [
            {
              type: "remove",
              path: this.#positionPath(command.elementId),
            },
          ],
          "visual",
        );
      case "reset-layout":
        return await this.#edit(this.#resetLayoutEdits(), "reset-layout");
      case "cleanup-unmatched":
        return await this.#edit(this.#unmatched().edits, "cleanup");
      case "resize":
      case "route":
        throw new CommandUnavailableError(
          command.type,
          `${command.type} is not supported for Mermaid documents.`,
        );
    }
  }

  async #edit(
    edits: readonly MetadataEdit[],
    reason: "visual" | "cleanup" | "reset-layout",
  ): Promise<CommandResult<MermaidDocumentSnapshot>> {
    const patched = patchManateeMetadata(this.snapshot().source, edits);
    if (patched.patches.length === 0) {
      return { snapshot: this.snapshot(), patches: [] };
    }
    const previousModel = this.snapshot().semanticModel;
    const result = await this.#engine.execute({
      type: "apply-patches",
      patches: patched.patches,
      reason,
    });
    const snapshot = await this.#present(result.snapshot, previousModel, true);
    return { ...result, snapshot };
  }

  #moveEdits(
    command: Extract<PresentationCommand, { type: "move" }>,
  ): MetadataEdit[] {
    const scene = this.snapshot().view?.scene;
    const item = scene
      ? [...scene.nodes, ...scene.groups].find(
          ({ id }) => id === command.elementId,
        )
      : undefined;
    if (!item) {
      throw new CommandUnavailableError(
        "move",
        "The element has no current geometry.",
      );
    }
    const parent = item.parentId
      ? scene?.groups.find(({ id }) => id === item.parentId)
      : undefined;
    const x = item.x + command.dx - (parent ? parent.x + parent.padding : 0);
    const y =
      item.y + command.dy - (parent ? parent.y + parent.padding + 28 : 0);
    return [
      {
        type: "set",
        path: this.#positionPath(command.elementId),
        value: {
          x: Math.max(0, Math.round(x)),
          y: Math.max(0, Math.round(y)),
        },
      },
    ];
  }

  #appearanceEdits(
    command: Extract<PresentationCommand, { type: "set-appearance" }>,
  ): MetadataEdit[] {
    const model = this.snapshot().semanticModel!;
    const node = model.nodes.find(({ id }) => id === command.elementId);
    const group = model.groups.find(({ id }) => id === command.elementId);
    const edits: MetadataEdit[] = [];
    if (node || group) {
      const category = node
        ? "nodes"
        : group?.kind === "lane"
          ? "lanes"
          : "groups";
      const base = ["elements", category, command.elementId, "style"] as const;
      if (command.appearance.fill !== undefined) {
        edits.push({
          type: "set",
          path: [...base, "fill"],
          value: command.appearance.fill,
        });
      }
      if (command.appearance.stroke !== undefined) {
        edits.push({
          type: "set",
          path: [...base, "outline", "color"],
          value: command.appearance.stroke,
        });
      }
      return edits;
    }
    const relationship = model.relationships.find(
      ({ id }) => id === command.elementId,
    )!;
    if (command.appearance.stroke === undefined) return [];
    if (relationship.identity.kind === "authored") {
      return [
        {
          type: "set",
          path: [
            "elements",
            "relationships",
            "byId",
            relationship.identity.id,
            "style",
            "color",
          ],
          value: command.appearance.stroke,
        },
      ];
    }
    const entries = metadataRecord(
      metadataRecord(this.snapshot()).elements,
    ).relationships;
    const byEndpoints = metadataRecord(entries).byEndpoints;
    const identity = relationship.identity;
    const index = Array.isArray(byEndpoints)
      ? byEndpoints.findIndex((entry) => {
          const match = metadataRecord(entry).match;
          const value = metadataRecord(match);
          return (
            value.source === identity.source &&
            value.target === identity.target &&
            value.kind === identity.relationshipKind
          );
        })
      : -1;
    if (index >= 0) {
      return [
        {
          type: "set",
          path: [
            "elements",
            "relationships",
            "byEndpoints",
            index,
            "style",
            "color",
          ],
          value: command.appearance.stroke,
        },
      ];
    }
    return [
      {
        type: "set",
        path: [
          "elements",
          "relationships",
          "byEndpoints",
          Array.isArray(byEndpoints) ? byEndpoints.length : 0,
        ],
        value: {
          match: {
            source: identity.source,
            target: identity.target,
            kind: identity.relationshipKind,
          },
          style: { color: command.appearance.stroke },
        },
      },
    ];
  }

  #positionPath(elementId: string): readonly string[] {
    const model = this.snapshot().semanticModel!;
    if (model.nodes.some(({ id }) => id === elementId)) {
      return ["elements", "nodes", elementId, "position"];
    }
    const group = model.groups.find(({ id }) => id === elementId);
    return [
      "elements",
      group?.kind === "lane" ? "lanes" : "groups",
      elementId,
      "position",
    ];
  }

  #resetLayoutEdits(): MetadataEdit[] {
    const model = this.snapshot().semanticModel!;
    return [
      ...model.nodes.map(({ id }) => ({
        type: "remove" as const,
        path: ["elements", "nodes", id, "position"] as const,
      })),
      ...model.groups.map(({ id, kind }) => ({
        type: "remove" as const,
        path: [
          "elements",
          kind === "lane" ? "lanes" : "groups",
          id,
          "position",
        ] as const,
      })),
    ];
  }

  #unmatched() {
    const model = this.snapshot().semanticModel!;
    return findUnmatchedMetadata(this.snapshot().presentationModel?.metadata, {
      nodes: new Set(model.nodes.map(({ id }) => id)),
      groups: new Set(
        model.groups.filter(({ kind }) => kind !== "lane").map(({ id }) => id),
      ),
      lanes: new Set(
        model.groups.filter(({ kind }) => kind === "lane").map(({ id }) => id),
      ),
      relationships: new Set(
        model.relationships.flatMap(({ identity }) =>
          identity.kind === "authored" ? [identity.id] : [],
        ),
      ),
      relationshipMatchers: new Set(
        model.relationships.flatMap(({ identity }) =>
          identity.kind === "matcher"
            ? [
                `${identity.source}\u0000${identity.target}\u0000${identity.relationshipKind}`,
              ]
            : [],
        ),
      ),
    });
  }

  #requireAvailable(command: PresentationCommand): void {
    const elementId = "elementId" in command ? command.elementId : undefined;
    const availability = this.#availability(elementId)[command.type];
    if (availability.state === "available") return;
    throw new CommandUnavailableError(
      command.type,
      availability.state === "disabled"
        ? availability.reason
        : `${command.type} is not supported for Mermaid documents.`,
    );
  }

  #availability(elementId = this.#current?.selectedElementId) {
    const current = this.#current;
    if (!current?.commands.visualEditing) {
      const reason =
        current?.diagnostics.find(({ severity }) => severity === "error")
          ?.message ??
        "Presentation editing is unavailable until the source is valid.";
      const unavailable = disabled(reason);
      return presentationAvailability({
        move: unavailable,
        "set-appearance": unavailable,
        "set-attribute": unavailable,
        "create-styling-rule": unavailable,
        "set-spacing": unavailable,
        "use-automatic-position": unavailable,
        "reset-layout": unavailable,
        "cleanup-unmatched": unavailable,
      });
    }
    const model = current.semanticModel!;
    const node = model.nodes.find(({ id }) => id === elementId);
    const group = model.groups.find(({ id }) => id === elementId);
    const relationship = model.relationships.find(({ id }) => id === elementId);
    const selected = node ?? group ?? relationship;
    const selectReason = disabled(
      elementId
        ? "The selected element does not support this action."
        : "Select an element.",
    );
    const metadata = metadataRecord(current);
    const positionPath =
      selected && !relationship ? this.#positionPath(selected.id) : [];
    const hasPosition =
      positionPath.length > 0 && valueAt(metadata, positionPath) !== undefined;
    return presentationAvailability({
      move: node || group ? available : selectReason,
      "set-appearance":
        relationship?.identity.kind === "ambiguous"
          ? disabled("This relationship has no unique authored identity.")
          : selected
            ? available
            : selectReason,
      "set-attribute": node ? available : selectReason,
      "create-styling-rule": available,
      "set-spacing": available,
      "use-automatic-position":
        node || group
          ? hasPosition
            ? available
            : disabled("This element already uses automatic position.")
          : selectReason,
      "reset-layout": hasAnyManualPosition(metadata)
        ? available
        : disabled("No manual positions to reset."),
      "cleanup-unmatched":
        this.#unmatched().edits.length > 0
          ? available
          : disabled("There are no unmatched presentation overrides."),
    });
  }

  async #present(
    snapshot: MermaidDocumentSnapshot,
    previousModel: MermaidSemanticModel | undefined,
    relayout: boolean,
  ): Promise<MermaidDocumentSnapshot> {
    let scene = this.#current?.view?.scene;
    if (relayout && snapshot.valid && snapshot.semanticModel) {
      scene = await this.#layout.layout({
        model: snapshot.semanticModel,
        metadata: snapshot.presentationModel?.metadata,
        ...(previousModel ? { options: { previousModel } } : {}),
      });
    }
    const view = snapshot.view
      ? Object.freeze({ ...snapshot.view, ...(scene ? { scene } : {}) })
      : this.#current?.view;
    const provisional: MermaidDocumentSnapshot = Object.freeze({
      ...snapshot,
      ...(view ? { view } : {}),
    });
    const label = selectedLabel(provisional);
    const withSelection: MermaidDocumentSnapshot = Object.freeze({
      ...provisional,
      ...(label ? { selectedElementLabel: label } : {}),
      commands: Object.freeze({
        ...provisional.commands,
        presentation: presentationAvailability({}),
      }),
    });
    this.#current = withSelection;
    const decorated: MermaidDocumentSnapshot = Object.freeze({
      ...withSelection,
      commands: Object.freeze({
        ...withSelection.commands,
        presentation: this.#availability(),
      }),
    });
    this.#current = decorated;
    return decorated;
  }
}

function isTransactionCommand(
  command: DocumentCommand,
): command is Exclude<DocumentCommand, PresentationCommand> {
  return ["replace-source", "select", "undo", "redo"].includes(command.type);
}

function metadataRecord(
  snapshot: MermaidDocumentSnapshot,
): Record<string, unknown>;
function metadataRecord(value: unknown): Record<string, unknown>;
function metadataRecord(value: unknown): Record<string, unknown> {
  if (
    typeof value === "object" &&
    value !== null &&
    "presentationModel" in value
  ) {
    return metadataRecord(
      (value as MermaidDocumentSnapshot).presentationModel?.metadata,
    );
  }
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function valueAt(
  root: Record<string, unknown>,
  path: readonly string[],
): unknown {
  let value: unknown = root;
  for (const part of path) value = metadataRecord(value)[part];
  return value;
}

function hasAnyManualPosition(metadata: Record<string, unknown>): boolean {
  const elements = metadataRecord(metadata.elements);
  return ["nodes", "groups", "lanes"].some((category) =>
    Object.values(metadataRecord(elements[category])).some(
      (entry) => metadataRecord(entry).position !== undefined,
    ),
  );
}

function selectedLabel(snapshot: MermaidDocumentSnapshot): string | undefined {
  const id = snapshot.selectedElementId;
  if (!id) return;
  return (
    snapshot.semanticModel?.nodes.find((item) => item.id === id)?.label ??
    snapshot.semanticModel?.groups.find((item) => item.id === id)?.label ??
    snapshot.semanticModel?.relationships.find((item) => item.id === id)
      ?.label ??
    id
  );
}
