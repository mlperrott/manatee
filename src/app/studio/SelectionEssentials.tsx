import { Show } from "solid-js";
import type { DocumentCommand } from "../../core/document/commands";
import type { MermaidDocumentSnapshot } from "../../mermaid";
import {
  c4Shapes,
  flowShapes,
  type StructureEdit,
} from "../../mermaid/authoring";
import { connectionKindLabels, flowShapeLabels } from "./controlLabels";

export function SelectionEssentials(props: {
  snapshot: MermaidDocumentSnapshot;
  execute: (command: DocumentCommand) => Promise<boolean>;
}) {
  const selected = () => {
    const id = props.snapshot.selectedElementId;
    if (!id || !props.snapshot.model) return;
    return (
      props.snapshot.model.nodes.find((item) => item.id === id) ??
      props.snapshot.model.groups.find((item) => item.id === id) ??
      props.snapshot.model.relationships.find((item) => item.id === id)
    );
  };
  const edit = (changes: { label?: string; kind?: string }) => {
    const item = selected();
    const model = props.snapshot.model;
    if (!item || !model) return;
    const node = model.nodes.find(({ id }) => id === item.id);
    const group = model.groups.find(({ id }) => id === item.id);
    const relationship = model.relationships.find(({ id }) => id === item.id);
    const next: StructureEdit = node
      ? {
          action: "node",
          id: node.id,
          label: node.label,
          kind: node.kind,
          ...(node.parentId ? { parentId: node.parentId } : {}),
          technology: node.technology,
          description: node.description,
          classes: node.classes,
          ...changes,
        }
      : group
        ? {
            action: "group",
            id: group.id,
            label: group.label,
            ...(group.parentId ? { parentId: group.parentId } : {}),
            ...(group.direction ? { direction: group.direction } : {}),
            ...changes,
          }
        : {
            action: "relationship",
            id: relationship!.id,
            ...(relationship!.identity.kind === "authored"
              ? { authoredId: relationship!.identity.id }
              : {}),
            source: relationship!.source,
            target: relationship!.target,
            label: relationship!.label,
            kind: relationship!.kind,
            technology: relationship!.technology,
            description: relationship!.description,
            directionHint: relationship!.directionHint,
            ...changes,
          };
    void props.execute({ type: "edit-structure", edit: next });
  };
  const node = () =>
    props.snapshot.model?.nodes.find(
      ({ id }) => id === props.snapshot.selectedElementId,
    );
  const relationship = () =>
    props.snapshot.model?.relationships.find(
      ({ id }) => id === props.snapshot.selectedElementId,
    );
  const flow = () =>
    props.snapshot.model?.family === "flowchart" ||
    props.snapshot.model?.family === "swimlane";

  return (
    <fieldset
      class="selection-essentials"
      disabled={
        props.snapshot.sourceEditing === false ||
        !props.snapshot.commands.visualEditing
      }
    >
      <legend>Essentials</legend>
      <label>
        Label
        <input
          aria-label="Selected element label"
          value={selected()?.label ?? ""}
          onChange={(event) => edit({ label: event.currentTarget.value })}
        />
      </label>
      <Show when={node()}>
        {(readNode) => (
          <label>
            Shape
            <select
              aria-label="Selected node shape"
              value={readNode().kind}
              onChange={(event) => edit({ kind: event.currentTarget.value })}
            >
              {(flow()
                ? Object.keys(flowShapes).filter(
                    (key) => !["square", "rect"].includes(key),
                  )
                : Object.keys(c4Shapes)
              ).map((value) => (
                <option value={value}>
                  {flow()
                    ? (flowShapeLabels[value] ?? value)
                    : (c4Shapes[value] ?? value)}
                </option>
              ))}
            </select>
          </label>
        )}
      </Show>
      <Show when={relationship()}>
        {(readRelationship) => (
          <label>
            Connection
            <select
              aria-label="Selected connection kind"
              value={readRelationship().kind}
              onChange={(event) => edit({ kind: event.currentTarget.value })}
            >
              {(flow()
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
                <option value={value}>
                  {connectionKindLabels[value] ?? value}
                </option>
              ))}
            </select>
          </label>
        )}
      </Show>
      <Show when={props.snapshot.sourceEditing === false}>
        <p class="field-help">
          Enable Mermaid source edits in Structure to change labels or shapes.
        </p>
      </Show>
    </fieldset>
  );
}
