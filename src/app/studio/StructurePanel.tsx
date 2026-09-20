import { createSignal, Show, untrack } from "solid-js";
import type { MermaidDocumentSnapshot } from "../../mermaid";
import type { DocumentCommand } from "../../core/document/commands";
import {
  c4Shapes,
  flowShapes,
  type StructureEdit,
} from "../../mermaid/authoring";
import type { DiagramDirection } from "../../mermaid/model";

function StructureForm(props: {
  snapshot: MermaidDocumentSnapshot;
  action: "node" | "group" | "relationship";
  existingId?: string;
  execute: (command: DocumentCommand) => Promise<boolean>;
  done: () => void;
}) {
  // The form owns a draft of the selected model at the moment it opens.
  // A keyed Show remounts it for a different edit target.
  const initial = untrack(() => ({
    model: props.snapshot.model!,
    action: props.action,
    existingId: props.existingId,
  }));
  const { model, action } = initial;
  const flow = model.family === "flowchart" || model.family === "swimlane";
  const existing = [
    ...model.nodes,
    ...model.groups,
    ...model.relationships,
  ].find((item) => item.id === initial.existingId);
  const [id, setId] = createSignal(
    existing?.id ??
      `${action}_${[...model.nodes, ...model.groups, ...model.relationships].length + 1}`,
  );
  const [authoredId, setAuthoredId] = createSignal("");
  const [label, setLabel] = createSignal(existing?.label ?? "");
  const [kind, setKind] = createSignal(
    existing?.kind ??
      (action === "relationship"
        ? flow
          ? "arrow_point"
          : "rel"
        : flow
          ? "rectangle"
          : model.family === "c4-container"
            ? "container"
            : "system"),
  );
  const [parent, setParent] = createSignal(
    existing && "parentId" in existing ? (existing.parentId ?? "") : "",
  );
  const [from, setFrom] = createSignal(
    existing && "source" in existing
      ? existing.source
      : (model.nodes[0]?.id ?? ""),
  );
  const [to, setTo] = createSignal(
    existing && "target" in existing
      ? existing.target
      : (model.nodes[1]?.id ?? model.nodes[0]?.id ?? ""),
  );
  const [technology, setTechnology] = createSignal(
    existing && "technology" in existing ? (existing.technology ?? "") : "",
  );
  const [description, setDescription] = createSignal(
    existing && "description" in existing ? (existing.description ?? "") : "",
  );
  const [classes, setClasses] = createSignal(
    existing?.classes.join(", ") ?? "",
  );
  const [direction, setDirection] = createSignal(
    existing && "directionHint" in existing
      ? (existing.directionHint ?? "")
      : existing && "direction" in existing
        ? (existing.direction ?? "")
        : "",
  );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const base = { id: id(), label: label() };
        const edit: StructureEdit =
          props.action === "node"
            ? {
                action: "node",
                ...base,
                kind: kind(),
                ...(parent() ? { parentId: parent() } : {}),
                technology: technology(),
                description: description(),
                classes: classes()
                  .split(",")
                  .map((value) => value.trim())
                  .filter(Boolean),
              }
            : props.action === "group"
              ? {
                  action: "group",
                  ...base,
                  ...(parent() ? { parentId: parent() } : {}),
                  ...(direction()
                    ? { direction: direction() as DiagramDirection }
                    : {}),
                }
              : {
                  action: "relationship",
                  ...base,
                  ...(authoredId().trim()
                    ? { authoredId: authoredId().trim() }
                    : {}),
                  source: from(),
                  target: to(),
                  kind: kind(),
                  technology: technology(),
                  description: description(),
                  ...(direction()
                    ? { directionHint: direction() as DiagramDirection }
                    : {}),
                };
        void props.execute({ type: "edit-structure", edit }).then((success) => {
          if (success) props.done();
        });
      }}
    >
      <label>
        Identifier
        <input
          aria-label="Element identifier"
          required
          readonly={!!existing}
          value={id()}
          onInput={(event) => setId(event.currentTarget.value)}
        />
      </label>
      <Show
        when={
          flow &&
          props.action === "relationship" &&
          existing &&
          "identity" in existing &&
          existing.identity.kind !== "authored"
        }
      >
        <label>
          Connection ID
          <input
            aria-label="Connection ID"
            value={authoredId()}
            placeholder="Optional unique ID"
            onInput={(event) => setAuthoredId(event.currentTarget.value)}
          />
        </label>
        <p class="field-help">
          A named connection can have individual styling and serve as a timeout
          attachment.
        </p>
      </Show>
      <label>
        Label
        <input
          aria-label="Element label"
          required={props.action !== "relationship"}
          value={label()}
          onInput={(event) => setLabel(event.currentTarget.value)}
        />
      </label>
      <Show when={props.action === "node"}>
        <label>
          {flow ? "Shape" : "C4 type"}
          <select
            aria-label="Element kind"
            value={kind()}
            onChange={(event) => setKind(event.currentTarget.value)}
          >
            {(flow
              ? Object.keys(flowShapes).filter(
                  (key) => !["square", "rect"].includes(key),
                )
              : Object.keys(c4Shapes)
            ).map((value) => (
              <option value={value}>
                {flow ? value : (c4Shapes[value] ?? value)}
              </option>
            ))}
          </select>
        </label>
        <Show when={flow}>
          <label>
            Classes
            <input
              aria-label="Element classes"
              value={classes()}
              onInput={(event) => setClasses(event.currentTarget.value)}
              placeholder="critical, approved"
            />
          </label>
        </Show>
      </Show>
      <Show when={props.action !== "relationship"}>
        <label>
          Parent group
          <select
            aria-label="Parent group"
            value={parent()}
            onChange={(event) => setParent(event.currentTarget.value)}
          >
            <option value="">Top level</option>
            {model.groups
              .filter((group) => group.id !== existing?.id)
              .map((group) => (
                <option value={group.id}>{group.label}</option>
              ))}
          </select>
        </label>
      </Show>
      <Show when={props.action === "relationship"}>
        <label>
          From
          <select
            aria-label="Connection from"
            value={from()}
            onChange={(event) => setFrom(event.currentTarget.value)}
          >
            {[...model.nodes, ...(flow ? model.groups : [])].map((node) => (
              <option value={node.id}>{node.label}</option>
            ))}
          </select>
        </label>
        <label>
          To
          <select
            aria-label="Connection to"
            value={to()}
            onChange={(event) => setTo(event.currentTarget.value)}
          >
            {[...model.nodes, ...(flow ? model.groups : [])].map((node) => (
              <option value={node.id}>{node.label}</option>
            ))}
          </select>
        </label>
        <label>
          Connection kind
          <select
            aria-label="Connection kind"
            value={kind()}
            onChange={(event) => setKind(event.currentTarget.value)}
          >
            {(flow
              ? [
                  "arrow_point",
                  "arrow_open",
                  "arrow_circle",
                  "arrow_cross",
                  "double_arrow_point",
                  "double_arrow_circle",
                  "double_arrow_cross",
                ]
              : ["rel", "birel", "rel_b"]
            ).map((value) => (
              <option value={value}>{value}</option>
            ))}
          </select>
        </label>
      </Show>
      <Show when={!flow && props.action !== "group"}>
        <Show
          when={props.action === "relationship" || kind().includes("container")}
        >
          <label>
            Technology
            <input
              aria-label="Technology"
              value={technology()}
              onInput={(event) => setTechnology(event.currentTarget.value)}
            />
          </label>
        </Show>
        <label>
          Description
          <textarea
            aria-label="Description"
            value={description()}
            onInput={(event) => setDescription(event.currentTarget.value)}
          />
        </label>
      </Show>
      <Show
        when={
          (flow && props.action === "group") ||
          (!flow && props.action === "relationship" && kind() === "rel")
        }
      >
        <label>
          Direction
          <select
            aria-label="Element direction"
            value={direction()}
            onChange={(event) => setDirection(event.currentTarget.value)}
          >
            <option value="">Automatic</option>
            {["TB", "BT", "LR", "RL"].map((value) => (
              <option value={value}>{value}</option>
            ))}
          </select>
        </label>
      </Show>
      <div class="studio-actions">
        <button type="submit">
          {existing
            ? "Update element"
            : `Create ${props.action === "relationship" ? "connection" : props.action}`}
        </button>
        <button type="button" onClick={props.done}>
          Cancel
        </button>
      </div>
    </form>
  );
}
export function StructurePanel(props: {
  snapshot: MermaidDocumentSnapshot;
  execute: (command: DocumentCommand) => Promise<boolean>;
}) {
  const [draft, setDraft] = createSignal<{
    action: "node" | "group" | "relationship";
    id?: string;
  }>();
  const selectionType = () =>
    props.snapshot.model?.nodes.some(
      (item) => item.id === props.snapshot.selectedElementId,
    )
      ? "node"
      : props.snapshot.model?.groups.some(
            (item) => item.id === props.snapshot.selectedElementId,
          )
        ? "group"
        : "relationship";
  return (
    <section class="structure-panel">
      <label class="scope-toggle">
        <input
          type="checkbox"
          aria-label="Allow Mermaid source edits"
          checked={props.snapshot.sourceEditing !== false}
          onChange={(event) =>
            void props.execute({
              type: "set-source-editing",
              allowed: event.currentTarget.checked,
            })
          }
        />
        Allow Mermaid source edits
      </label>
      <p class="field-help">
        {props.snapshot.sourceEditing === false
          ? "Presentation-only mode. Enable Mermaid source edits to change labels, elements, connections or groups."
          : "Visual structure edits update Mermaid text and may reformat its structural statements. Manatee settings remain editable independently."}
      </p>
      <details>
        <summary>Create and edit structure</summary>
        <fieldset
          disabled={
            props.snapshot.sourceEditing === false ||
            !props.snapshot.commands.visualEditing
          }
          title={
            props.snapshot.sourceEditing === false
              ? "Enable Allow Mermaid source edits."
              : undefined
          }
        >
          <legend>Diagram structure</legend>
          <div class="studio-actions">
            <button type="button" onClick={() => setDraft({ action: "node" })}>
              Add node
            </button>
            <button
              type="button"
              onClick={() => setDraft({ action: "relationship" })}
            >
              Add connection
            </button>
            <button type="button" onClick={() => setDraft({ action: "group" })}>
              Add group
            </button>
          </div>
          <Show when={props.snapshot.selectedElementId}>
            <div class="studio-actions">
              <button
                type="button"
                onClick={() =>
                  setDraft({
                    action: selectionType(),
                    id: props.snapshot.selectedElementId!,
                  })
                }
              >
                Edit selected element
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft(undefined);
                  void props.execute({
                    type: "edit-structure",
                    edit: {
                      action: "delete",
                      id: props.snapshot.selectedElementId!,
                    },
                  });
                }}
              >
                Delete selected element
              </button>
            </div>
            <p class="field-help">
              Deleting a node removes its connections. Deleting a group keeps
              its contents. Undo restores the change.
            </p>
          </Show>
          <Show when={props.snapshot.model?.direction}>
            <label>
              Diagram direction
              <select
                aria-label="Diagram direction"
                value={props.snapshot.model?.direction ?? "TB"}
                onChange={(event) =>
                  void props.execute({
                    type: "edit-structure",
                    edit: {
                      action: "direction",
                      direction: event.currentTarget.value as DiagramDirection,
                    },
                  })
                }
              >
                {["TB", "BT", "LR", "RL"].map((value) => (
                  <option value={value}>{value}</option>
                ))}
              </select>
            </label>
          </Show>
          <Show when={draft()} keyed>
            {(value) => (
              <StructureForm
                snapshot={props.snapshot}
                action={value.action}
                {...(value.id ? { existingId: value.id } : {})}
                execute={props.execute}
                done={() => setDraft(undefined)}
              />
            )}
          </Show>
        </fieldset>
      </details>
    </section>
  );
}
