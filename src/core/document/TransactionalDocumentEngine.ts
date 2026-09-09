import type {
  CommandResult,
  DocumentCommand,
  DocumentEngine,
} from "./DocumentEngine";
import type {
  DocumentHint,
  DocumentSnapshot,
  ParsedDocument,
  SourcePatch,
} from "./types";
import {
  applySourcePatches,
  minimalSourcePatch,
  UnsafeSourcePatchError,
} from "../source/patches";

export interface DocumentParser<
  SemanticModel = unknown,
  PresentationModel = unknown,
  View = unknown,
> {
  parse(
    source: string,
    hint?: DocumentHint,
  ): Promise<ParsedDocument<SemanticModel, PresentationModel, View>>;
}

interface HistoryEntry<Snapshot extends DocumentSnapshot> {
  readonly before: Snapshot;
  readonly after: Snapshot;
  readonly patches: readonly SourcePatch[];
}

export class TransactionalDocumentEngine<
  SemanticModel = unknown,
  PresentationModel = unknown,
  View = unknown,
> implements DocumentEngine<
  DocumentSnapshot<SemanticModel, PresentationModel, View>
> {
  readonly #parser: DocumentParser<SemanticModel, PresentationModel, View>;
  #current:
    DocumentSnapshot<SemanticModel, PresentationModel, View> | undefined;
  #initialSource = "";
  #hint: DocumentHint | undefined;
  #undo: HistoryEntry<
    DocumentSnapshot<SemanticModel, PresentationModel, View>
  >[] = [];
  #redo: HistoryEntry<
    DocumentSnapshot<SemanticModel, PresentationModel, View>
  >[] = [];

  constructor(parser: DocumentParser<SemanticModel, PresentationModel, View>) {
    this.#parser = parser;
  }

  async open(
    source: string,
    hint?: DocumentHint,
  ): Promise<DocumentSnapshot<SemanticModel, PresentationModel, View>> {
    const parsed = await this.#parser.parse(source, hint);
    this.#initialSource = source;
    this.#hint = hint;
    this.#undo = [];
    this.#redo = [];
    this.#current = this.#createSnapshot(source, parsed, undefined, undefined);
    return this.#current;
  }

  async execute(
    command: DocumentCommand,
  ): Promise<
    CommandResult<DocumentSnapshot<SemanticModel, PresentationModel, View>>
  > {
    const current = this.#requireCurrent();

    switch (command.type) {
      case "select": {
        this.#current = this.#withHistoryAvailability({
          ...current,
          selectedElementId: command.elementId,
        });
        return { snapshot: this.#current, patches: [] };
      }
      case "replace-source": {
        const patch = minimalSourcePatch(current.source, command.source);
        return this.#commitSource(
          command.source,
          patch ? [patch] : [],
          current.selectedElementId,
        );
      }
      case "apply-patches": {
        if (!current.commands.visualEditing) {
          throw new UnsafeSourcePatchError(
            "Visual changes are unavailable until the source is valid.",
          );
        }
        const source = applySourcePatches(current.source, command.patches);
        return this.#commitSource(
          source,
          command.patches,
          current.selectedElementId,
          true,
        );
      }
      case "undo":
        return this.#moveHistory(this.#undo, this.#redo, "before");
      case "redo":
        return this.#moveHistory(this.#redo, this.#undo, "after");
    }
  }

  async replaceSource(
    source: string,
  ): Promise<DocumentSnapshot<SemanticModel, PresentationModel, View>> {
    return (await this.execute({ type: "replace-source", source })).snapshot;
  }

  snapshot(): DocumentSnapshot<SemanticModel, PresentationModel, View> {
    return this.#requireCurrent();
  }

  async #commitSource(
    source: string,
    patches: readonly SourcePatch[],
    selectedElementId: string | undefined,
    requireValid = false,
  ): Promise<
    CommandResult<DocumentSnapshot<SemanticModel, PresentationModel, View>>
  > {
    const before = this.#requireCurrent();
    if (source === before.source) return { snapshot: before, patches: [] };

    const parsed = await this.#parser.parse(source, this.#hint);
    if (requireValid && !parsed.valid) {
      throw new UnsafeSourcePatchError(
        parsed.diagnostics[0]?.message ??
          "The source patch did not produce a valid document.",
      );
    }
    const after = this.#createSnapshot(
      source,
      parsed,
      before,
      selectedElementId,
    );
    const entry = { before, after, patches: Object.freeze([...patches]) };
    this.#undo.push(entry);
    this.#redo = [];
    this.#current = this.#withHistoryAvailability(after);
    return { snapshot: this.#current, patches: entry.patches };
  }

  #moveHistory(
    from: HistoryEntry<
      DocumentSnapshot<SemanticModel, PresentationModel, View>
    >[],
    to: HistoryEntry<
      DocumentSnapshot<SemanticModel, PresentationModel, View>
    >[],
    target: "before" | "after",
  ): CommandResult<DocumentSnapshot<SemanticModel, PresentationModel, View>> {
    const entry = from.pop();
    if (!entry) return { snapshot: this.#requireCurrent(), patches: [] };

    const current = this.#requireCurrent();
    to.push(entry);
    this.#current = this.#withHistoryAvailability(entry[target]);
    const patch = minimalSourcePatch(current.source, this.#current.source);
    return { snapshot: this.#current, patches: patch ? [patch] : [] };
  }

  #createSnapshot(
    source: string,
    parsed: ParsedDocument<SemanticModel, PresentationModel, View>,
    previous:
      DocumentSnapshot<SemanticModel, PresentationModel, View> | undefined,
    selectedElementId: string | undefined,
  ): DocumentSnapshot<SemanticModel, PresentationModel, View> {
    const valid = parsed.valid;
    const snapshot: DocumentSnapshot<SemanticModel, PresentationModel, View> = {
      kind: parsed.kind,
      source,
      semanticModel: valid ? parsed.semanticModel : previous?.semanticModel,
      presentationModel: valid
        ? parsed.presentationModel
        : previous?.presentationModel,
      view: valid ? parsed.view : previous?.view,
      diagnostics: Object.freeze([...parsed.diagnostics]),
      selectedElementId,
      valid,
      previewOutdated: !valid && previous?.view !== undefined,
      dirty: source !== this.#initialSource,
      commands: Object.freeze({
        visualEditing: valid && (parsed.visualEditing ?? true),
        imageExport: valid && (parsed.imageExport ?? true),
        undo: false,
        redo: false,
      }),
    };
    return Object.freeze(snapshot);
  }

  #withHistoryAvailability(
    snapshot: DocumentSnapshot<SemanticModel, PresentationModel, View>,
  ): DocumentSnapshot<SemanticModel, PresentationModel, View> {
    return Object.freeze({
      ...snapshot,
      commands: Object.freeze({
        ...snapshot.commands,
        undo: this.#undo.length > 0,
        redo: this.#redo.length > 0,
      }),
    });
  }

  #requireCurrent(): DocumentSnapshot<SemanticModel, PresentationModel, View> {
    if (!this.#current)
      throw new Error("Open a document before using the engine.");
    return this.#current;
  }
}
