import {
  CommandUnavailableError,
  type CommandResult,
  type DocumentCommand,
  type PresentationCommand,
} from "../core/document/commands";
import type {
  CommandAvailability,
  DocumentDiagnostic,
  SourcePatch,
  SourceRange,
} from "../core/document/types";
import {
  findUnmatchedMetadata,
  patchManateeMetadata,
  readManateeMetadata,
} from "../core/metadata/manateeMetadata";
import type { MetadataEdit, MetadataValue } from "../core/metadata/types";
import {
  applySourcePatches,
  minimalSourcePatch,
  UnsafeSourcePatchError,
} from "../core/source/patches";
import { available, disabled, presentationAvailability } from "./presentation";
import { inspectMermaidCompatibility } from "./compatibility";
import { normalizeMermaidFamily } from "./normalizeFamily";
import { boundaryTimerNotation, notationDiagnostics } from "./notation";
import { MermaidLayout } from "./layout/MermaidLayout";
import { contentOrigin } from "./layout/geometry";
import { moveMermaidScene } from "./layout/automaticLayout";
import type { MermaidScene } from "./layout/types";
import type { MermaidSemanticModel } from "./model";
import { parseMermaidDiagram } from "./runtimeContract";

export interface MermaidDocumentSnapshot {
  readonly source: string;
  readonly model: MermaidSemanticModel | undefined;
  readonly metadata: Readonly<Record<string, unknown>> | undefined;
  readonly scene: MermaidScene | undefined;
  readonly diagnostics: readonly DocumentDiagnostic[];
  readonly selectedElementId: string | undefined;
  readonly selectedElementLabel?: string;
  readonly valid: boolean;
  readonly previewOutdated: boolean;
  readonly dirty: boolean;
  readonly commands: CommandAvailability;
}

type MermaidParseResult =
  | {
      readonly valid: true;
      readonly model: MermaidSemanticModel;
      readonly metadata: Readonly<Record<string, unknown>> | undefined;
      readonly diagnostics: readonly DocumentDiagnostic[];
      readonly visualEditing: boolean;
    }
  | {
      readonly valid: false;
      readonly diagnostics: readonly DocumentDiagnostic[];
    };

interface HistoryEntry {
  readonly before: MermaidDocumentSnapshot;
  readonly after: MermaidDocumentSnapshot;
  readonly patches: readonly SourcePatch[];
}

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
): MermaidParseResult {
  const parseError =
    typeof error === "object" && error !== null
      ? (error as MermaidParseError)
      : undefined;
  const range = parseError ? parseErrorRange(source, parseError) : undefined;
  return {
    valid: false,
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

async function parseDocument(source: string): Promise<MermaidParseResult> {
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
    return { valid: false, diagnostics };
  }

  const model = normalizeMermaidFamily(
    compatibility.family,
    diagram,
    diagnostics,
  );
  if (!model) {
    return invalidParse(
      source,
      new Error(
        `Mermaid ${diagram.type} did not satisfy the pinned document contract.`,
      ),
      diagnostics,
    );
  }

  const notationProblems = notationDiagnostics(model, metadata.metadata);
  const processDiagnostics = [...model.diagnostics, ...notationProblems];
  if (processDiagnostics.some(({ severity }) => severity === "error")) {
    return {
      valid: false,
      diagnostics: processDiagnostics,
    };
  }

  return {
    valid: true,
    model,
    metadata: metadata.metadata,
    diagnostics: processDiagnostics,
    visualEditing: metadata.visualEditing && notationProblems.length === 0,
  };
}

export class MermaidDocument {
  readonly #layout: MermaidLayout;
  #current: MermaidDocumentSnapshot | undefined;
  #initialSource = "";
  #undo: HistoryEntry[] = [];
  #redo: HistoryEntry[] = [];

  constructor(layout: MermaidLayout = new MermaidLayout()) {
    this.#layout = layout;
  }

  async open(source: string): Promise<MermaidDocumentSnapshot> {
    const parsed = await parseDocument(source);
    this.#initialSource = source;
    this.#undo = [];
    this.#redo = [];
    const snapshot = this.#createSnapshot(source, parsed, undefined, undefined);
    return await this.#present(snapshot, undefined, true);
  }

  async execute(
    command: DocumentCommand,
  ): Promise<CommandResult<MermaidDocumentSnapshot>> {
    switch (command.type) {
      case "select": {
        const current = this.snapshot();
        const snapshot = await this.#present(
          this.#withHistoryAvailability({
            ...current,
            selectedElementId: command.elementId,
          }),
          current.model,
          false,
        );
        return { snapshot, patches: [] };
      }
      case "replace-source":
        return await this.#replaceSource(command.source);
      case "undo":
        return await this.#moveHistory(this.#undo, this.#redo, "before");
      case "redo":
        return await this.#moveHistory(this.#redo, this.#undo, "after");
      default:
        return await this.#executePresentation(command);
    }
  }

  async replaceSource(source: string): Promise<MermaidDocumentSnapshot> {
    return (await this.execute({ type: "replace-source", source })).snapshot;
  }

  snapshot(): MermaidDocumentSnapshot {
    if (!this.#current) throw new Error("Open a document before using it.");
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
        return await this.#move(command);
      case "set-appearance":
        return await this.#edit(this.#appearanceEdits(command));
      case "set-notation":
        return await this.#edit(this.#notationEdits(command));
      case "set-attribute":
        return await this.#edit([
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
        ]);
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
        return await this.#edit([
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
        ]);
      }
      case "set-spacing":
        return await this.#edit([
          {
            type: "set",
            path: ["layout", "spacing", command.spacing],
            value: command.value,
          },
        ]);
      case "use-automatic-position":
        return await this.#edit(
          this.#automaticPositionEdits(command.elementId),
        );
      case "reset-layout":
        return await this.#edit(this.#resetLayoutEdits());
      case "cleanup-unmatched":
        return await this.#edit(this.#unmatched().edits);
    }
  }

  #notationEdits(
    command: Extract<PresentationCommand, { type: "set-notation" }>,
  ): MetadataEdit[] {
    const model = this.snapshot().model!;
    const node = model.nodes.find(({ id }) => id === command.elementId);
    const group = model.groups.find(({ id }) => id === command.elementId);
    const relationship = model.relationships.find(
      ({ id }) => id === command.elementId,
    );
    if (
      command.notation &&
      model.family !== "flowchart" &&
      model.family !== "swimlane"
    ) {
      throw new CommandUnavailableError(
        "set-notation",
        "Process notation applies to Mermaid flowcharts and swimlanes.",
      );
    }
    const nodeChoices = new Set([
      "task",
      "start-event",
      "end-event",
      "exclusive-gateway",
      "parallel-gateway",
      "timer-event",
      "boundary-timer",
      "collapsed-subprocess",
    ]);
    const containerChoices = new Set(["pool", "lane"]);
    const relationshipChoices = new Set(["sequence-flow", "message-flow"]);
    if (
      command.notation &&
      ((node && !nodeChoices.has(command.notation)) ||
        (group && !containerChoices.has(command.notation)) ||
        (relationship && !relationshipChoices.has(command.notation)))
    ) {
      throw new CommandUnavailableError(
        "set-notation",
        "That notation does not apply to the selected element.",
      );
    }
    if (command.notation === "boundary-timer") {
      if (!node || !command.boundaryTimer) {
        throw new CommandUnavailableError(
          "set-notation",
          "Choose a host task and its authored fallback attachment.",
        );
      }
      const host = model.nodes.find(
        ({ id }) => id === command.boundaryTimer?.hostId,
      );
      const attachment = model.relationships.find(
        ({ identity }) =>
          identity.kind === "authored" &&
          identity.id === command.boundaryTimer?.attachmentRelationshipId,
      );
      if (
        !host ||
        host.id === node.id ||
        !attachment ||
        attachment.source !== host.id ||
        attachment.target !== node.id
      ) {
        throw new CommandUnavailableError(
          "set-notation",
          "The fallback attachment must be an authored relationship from the host task to this timer.",
        );
      }
    }
    let path: readonly (string | number)[];
    if (node) path = ["elements", "nodes", node.id, "notation"];
    else if (group) {
      path = [
        "elements",
        group.kind === "lane" ? "lanes" : "groups",
        group.id,
        "notation",
      ];
    } else if (relationship?.identity.kind === "authored") {
      path = [
        "elements",
        "relationships",
        "byId",
        relationship.identity.id,
        "notation",
      ];
    } else if (relationship?.identity.kind === "matcher") {
      const identity = relationship.identity;
      const entries = metadataRecord(
        metadataRecord(this.snapshot()).elements,
      ).relationships;
      const byEndpoints = metadataRecord(entries).byEndpoints;
      const index = Array.isArray(byEndpoints)
        ? byEndpoints.findIndex((entry) => {
            const match = metadataRecord(metadataRecord(entry).match);
            return (
              match.source === identity.source &&
              match.target === identity.target &&
              match.kind === identity.relationshipKind
            );
          })
        : -1;
      if (index >= 0) {
        path = ["elements", "relationships", "byEndpoints", index, "notation"];
      } else {
        if (!command.notation) return [];
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
              notation: { type: command.notation },
            },
          },
        ];
      }
    } else {
      throw new CommandUnavailableError(
        "set-notation",
        "This relationship needs a unique authored identity before notation can be assigned.",
      );
    }
    return command.notation
      ? [
          {
            type: "set",
            path,
            value:
              command.notation === "boundary-timer"
                ? {
                    type: command.notation,
                    host: command.boundaryTimer!.hostId,
                    attachment: command.boundaryTimer!.attachmentRelationshipId,
                    anchor: command.boundaryTimer!.anchor ?? {
                      side: "bottom",
                      offset: 0.8,
                    },
                  }
                : { type: command.notation },
          },
        ]
      : [{ type: "remove", path }];
  }

  async #edit(
    edits: readonly MetadataEdit[],
    preparedScene?: MermaidScene,
  ): Promise<CommandResult<MermaidDocumentSnapshot>> {
    const patched = patchManateeMetadata(this.snapshot().source, edits);
    if (patched.patches.length === 0) {
      return { snapshot: this.snapshot(), patches: [] };
    }
    return await this.#commitSource(
      applySourcePatches(this.snapshot().source, patched.patches),
      patched.patches,
      true,
      preparedScene,
    );
  }

  async #move(
    command: Extract<PresentationCommand, { type: "move" }>,
  ): Promise<CommandResult<MermaidDocumentSnapshot>> {
    const edits = this.#moveEdits(command);
    const current = this.snapshot();
    const scene = current.scene;
    const item = scene
      ? [...scene.nodes, ...scene.groups].find(
          ({ id }) => id === command.elementId,
        )
      : undefined;
    if (!scene || !item || boundaryTimerNotation(current.metadata, item.id)) {
      return await this.#edit(edits);
    }
    const positionEdit = edits[0];
    if (!positionEdit || positionEdit.type !== "set") {
      return await this.#edit(edits);
    }
    const position = metadataRecord(positionEdit.value);
    const parent = item.parentId
      ? scene.groups.find(({ id }) => id === item.parentId)
      : undefined;
    const isNode = scene.nodes.some(({ id }) => id === item.id);
    const origin = contentOrigin(parent, isNode);
    const targetX = Number(position.x) + origin.x;
    const targetY = Number(position.y) + origin.y;
    const boundaryTimerHosts = new Map(
      scene.nodes.flatMap((node) => {
        const notation = boundaryTimerNotation(current.metadata, node.id);
        return notation ? [[node.id, notation.host] as const] : [];
      }),
    );
    return await this.#edit(
      edits,
      moveMermaidScene(
        scene,
        item.id,
        targetX - item.x,
        targetY - item.y,
        boundaryTimerHosts,
      ),
    );
  }

  async #replaceSource(
    source: string,
  ): Promise<CommandResult<MermaidDocumentSnapshot>> {
    const patch = minimalSourcePatch(this.snapshot().source, source);
    return await this.#commitSource(source, patch ? [patch] : [], false);
  }

  async #commitSource(
    source: string,
    patches: readonly SourcePatch[],
    requireValid: boolean,
    preparedScene?: MermaidScene,
  ): Promise<CommandResult<MermaidDocumentSnapshot>> {
    const before = this.snapshot();
    if (source === before.source) return { snapshot: before, patches: [] };
    const parsed = await parseDocument(source);
    if (requireValid && (!parsed.valid || !parsed.visualEditing)) {
      throw new UnsafeSourcePatchError(
        parsed.diagnostics[0]?.message ??
          "The source patch did not produce a valid document.",
      );
    }
    const created = this.#createSnapshot(
      source,
      parsed,
      before,
      before.selectedElementId,
    );
    const provisional = preparedScene
      ? Object.freeze({
          ...created,
          scene: Object.freeze({
            ...preparedScene,
            sourceModel: parsed.valid
              ? parsed.model
              : preparedScene.sourceModel,
          }),
        })
      : created;
    const after = await this.#present(
      provisional,
      before.model,
      preparedScene === undefined,
    );
    const entry = {
      before,
      after,
      patches: Object.freeze([...patches]),
    };
    this.#undo.push(entry);
    this.#redo = [];
    const snapshot = await this.#present(
      this.#withHistoryAvailability(after),
      after.model,
      false,
    );
    return { snapshot, patches: entry.patches };
  }

  async #moveHistory(
    from: HistoryEntry[],
    to: HistoryEntry[],
    target: "before" | "after",
  ): Promise<CommandResult<MermaidDocumentSnapshot>> {
    const entry = from.pop();
    if (!entry) return { snapshot: this.snapshot(), patches: [] };
    const current = this.snapshot();
    to.push(entry);
    const snapshot = await this.#present(
      this.#withHistoryAvailability(entry[target]),
      current.model,
      true,
    );
    const patch = minimalSourcePatch(current.source, snapshot.source);
    return { snapshot, patches: patch ? [patch] : [] };
  }

  #createSnapshot(
    source: string,
    parsed: MermaidParseResult,
    previous: MermaidDocumentSnapshot | undefined,
    selectedElementId: string | undefined,
  ): MermaidDocumentSnapshot {
    const valid = parsed.valid;
    return Object.freeze({
      source,
      model: valid ? parsed.model : previous?.model,
      metadata: valid ? parsed.metadata : previous?.metadata,
      scene: previous?.scene,
      diagnostics: Object.freeze([...parsed.diagnostics]),
      selectedElementId,
      valid,
      previewOutdated: !valid && previous?.scene !== undefined,
      dirty: source !== this.#initialSource,
      commands: Object.freeze({
        visualEditing: valid && (parsed.visualEditing ?? true),
        imageExport:
          valid &&
          !parsed.diagnostics.some(({ code }) =>
            code.startsWith("manatee.notation."),
          ),
        undo: false,
        redo: false,
        presentation: presentationAvailability({}),
      }),
    });
  }

  #withHistoryAvailability(
    snapshot: MermaidDocumentSnapshot,
  ): MermaidDocumentSnapshot {
    return Object.freeze({
      ...snapshot,
      commands: Object.freeze({
        ...snapshot.commands,
        undo: this.#undo.length > 0,
        redo: this.#redo.length > 0,
      }),
    });
  }

  #moveEdits(
    command: Extract<PresentationCommand, { type: "move" }>,
  ): MetadataEdit[] {
    const scene = this.snapshot().scene;
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
    const boundaryTimer = boundaryTimerNotation(
      this.snapshot().metadata,
      item.id,
    );
    if (boundaryTimer) {
      const host = scene?.nodes.find(({ id }) => id === boundaryTimer.host);
      if (!host) {
        throw new CommandUnavailableError(
          "move",
          "The boundary timer host is unavailable.",
        );
      }
      const center = {
        x: item.x + item.width / 2 + command.dx,
        y: item.y + item.height / 2 + command.dy,
      };
      const distances = [
        ["top", Math.abs(center.y - host.y)] as const,
        ["right", Math.abs(center.x - (host.x + host.width))] as const,
        ["bottom", Math.abs(center.y - (host.y + host.height))] as const,
        ["left", Math.abs(center.x - host.x)] as const,
      ];
      const side = distances.sort((left, right) => left[1] - right[1])[0]![0];
      const offset =
        side === "top" || side === "bottom"
          ? (center.x - host.x) / host.width
          : (center.y - host.y) / host.height;
      return [
        {
          type: "set",
          path: ["elements", "nodes", item.id, "notation", "anchor"],
          value: {
            side,
            offset: Math.max(0, Math.min(1, Number(offset.toFixed(3)))),
          },
        },
      ];
    }
    const parent = item.parentId
      ? scene?.groups.find(({ id }) => id === item.parentId)
      : undefined;
    const isNode = scene?.nodes.some(({ id }) => id === item.id) ?? false;
    const origin = contentOrigin(parent, isNode);
    const x = item.x + command.dx - origin.x;
    const y = item.y + command.dy - origin.y;
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
    const model = this.snapshot().model!;
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
    const model = this.snapshot().model!;
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

  #automaticPositionEdits(elementId: string): MetadataEdit[] {
    const paths = [this.#positionPath(elementId)];
    if (boundaryTimerNotation(this.snapshot().metadata, elementId)) {
      paths.push(["elements", "nodes", elementId, "notation", "anchor"]);
    }
    return paths
      .filter(
        (path) => valueAt(metadataRecord(this.snapshot()), path) !== undefined,
      )
      .map((path) => ({ type: "remove", path }));
  }

  #resetLayoutEdits(): MetadataEdit[] {
    const model = this.snapshot().model!;
    return [...model.nodes, ...model.groups].flatMap(({ id }) =>
      this.#automaticPositionEdits(id),
    );
  }

  #unmatched() {
    const model = this.snapshot().model!;
    return findUnmatchedMetadata(this.snapshot().metadata, {
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
        "set-notation": unavailable,
        "set-attribute": unavailable,
        "create-styling-rule": unavailable,
        "set-spacing": unavailable,
        "use-automatic-position": unavailable,
        "reset-layout": unavailable,
        "cleanup-unmatched": unavailable,
      });
    }
    const model = current.model!;
    const node = model.nodes.find(({ id }) => id === elementId);
    const group = model.groups.find(({ id }) => id === elementId);
    const relationship = model.relationships.find(({ id }) => id === elementId);
    const selected = node ?? group ?? relationship;
    const supportsProcessNotation =
      model.family === "flowchart" || model.family === "swimlane";
    const selectReason = disabled(
      elementId
        ? "The selected element does not support this action."
        : "Select an element.",
    );
    const metadata = metadataRecord(current);
    const positionPath =
      selected && !relationship ? this.#positionPath(selected.id) : [];
    const hasPosition =
      positionPath.length > 0 &&
      (valueAt(metadata, positionPath) !== undefined ||
        (node &&
          valueAt(metadata, [
            "elements",
            "nodes",
            node.id,
            "notation",
            "anchor",
          ]) !== undefined));
    return presentationAvailability({
      move: node || group ? available : selectReason,
      "set-appearance":
        relationship?.identity.kind === "ambiguous"
          ? disabled("This relationship has no unique authored identity.")
          : selected
            ? available
            : selectReason,
      "set-notation": !supportsProcessNotation
        ? disabled(
            "Process notation applies to Mermaid flowcharts and swimlanes.",
          )
        : relationship?.identity.kind === "ambiguous"
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
    let scene = snapshot.scene;
    if (relayout && snapshot.valid && snapshot.model) {
      scene = await this.#layout.layout({
        model: snapshot.model,
        metadata: snapshot.metadata,
        ...(previousModel ? { options: { previousModel } } : {}),
      });
    }
    const provisional: MermaidDocumentSnapshot = Object.freeze({
      ...snapshot,
      ...(scene ? { scene } : {}),
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

function metadataRecord(
  snapshot: MermaidDocumentSnapshot,
): Record<string, unknown>;
function metadataRecord(value: unknown): Record<string, unknown>;
function metadataRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && "metadata" in value) {
    return metadataRecord((value as MermaidDocumentSnapshot).metadata);
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
      (entry) =>
        metadataRecord(entry).position !== undefined ||
        (category === "nodes" &&
          metadataRecord(metadataRecord(entry).notation).type ===
            "boundary-timer" &&
          metadataRecord(metadataRecord(entry).notation).anchor !== undefined),
    ),
  );
}

function selectedLabel(snapshot: MermaidDocumentSnapshot): string | undefined {
  const id = snapshot.selectedElementId;
  if (!id) return;
  return (
    snapshot.model?.nodes.find((item) => item.id === id)?.label ??
    snapshot.model?.groups.find((item) => item.id === id)?.label ??
    snapshot.model?.relationships.find((item) => item.id === id)?.label ??
    id
  );
}
