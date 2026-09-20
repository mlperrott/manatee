import { createSignal, Show } from "solid-js";
import type { MermaidDocumentSnapshot } from "../../mermaid";
import { boundaryTimerNotation } from "../../mermaid/notation";
import { contentOrigin } from "../../mermaid/layout/geometry";
import type { DocumentCommand } from "../../core/document/commands";
import type {
  MetadataEdit,
  MetadataPathPart,
  MetadataValue,
} from "../../core/metadata/types";
import { findUnmatchedMetadata } from "../../core/metadata/manateeMetadata";
import { at, editValue, elementPath, record } from "./metadataControls";
import { StyleFields } from "./StyleFields";
import { RulesPanel, ScalarField } from "./RulesPanel";

export function PresentationPanel(props: {
  snapshot: MermaidDocumentSnapshot;
  execute: (command: DocumentCommand) => Promise<boolean>;
}) {
  const id = () => props.snapshot.selectedElementId;
  const target = () => (id() ? elementPath(props.snapshot, id()!) : undefined);
  const edit = (edits: readonly MetadataEdit[]) =>
    props.execute({ type: "edit-metadata", edits });
  const change = (
    path: readonly MetadataPathPart[],
    value: MetadataValue | undefined,
  ) => {
    const selected = target();
    if (!selected) return;
    void edit([
      ...selected.initial,
      editValue([...selected.path, ...path], value),
    ]);
  };
  const entry = () => at(props.snapshot.metadata, target()?.path ?? []);
  const edge = () => !!target()?.edge;
  const style = () =>
    edge()
      ? { ...record(at(entry(), ["style"])), text: at(entry(), ["text"]) }
      : at(entry(), ["style"]);
  const sceneItem = () =>
    [
      ...(props.snapshot.scene?.nodes ?? []),
      ...(props.snapshot.scene?.groups ?? []),
      ...(props.snapshot.scene?.relationships ?? []),
    ].find((item) => item.id === id());
  const timer = () =>
    id() ? boundaryTimerNotation(props.snapshot.metadata, id()!) : undefined;
  const node = () =>
    props.snapshot.model?.nodes.find((item) => item.id === id());
  const [attributeName, setAttributeName] = createSignal("");
  const [attributeValue, setAttributeValue] = createSignal<
    string | number | boolean
  >("");
  const [attributeError, setAttributeError] = createSignal("");
  const position = () => {
    const item = sceneItem();
    if (!item || !("x" in item)) return { x: 0, y: 0 };
    const parent = item.parentId
      ? props.snapshot.scene?.groups.find((group) => group.id === item.parentId)
      : undefined;
    const origin = contentOrigin(parent, !!node());
    const saved = record(at(entry(), ["position"]));
    return {
      x: Number(saved.x ?? Math.max(0, item.x - origin.x)),
      y: Number(saved.y ?? Math.max(0, item.y - origin.y)),
    };
  };
  const unmatched = () => {
    const model = props.snapshot.model;
    if (!model) return [];
    return findUnmatchedMetadata(props.snapshot.metadata, {
      nodes: new Set(model.nodes.map((item) => item.id)),
      groups: new Set(
        model.groups
          .filter((item) => item.kind !== "lane")
          .map((item) => item.id),
      ),
      lanes: new Set(
        model.groups
          .filter((item) => item.kind === "lane")
          .map((item) => item.id),
      ),
      relationships: new Set(
        model.relationships.flatMap((item) =>
          item.identity.kind === "authored" ? [item.identity.id] : [],
        ),
      ),
      relationshipMatchers: new Set(
        model.relationships.flatMap((item) =>
          item.identity.kind === "matcher"
            ? [`${item.source}\u0000${item.target}\u0000${item.kind}`]
            : [],
        ),
      ),
    }).edits;
  };
  return (
    <div class="presentation-panel">
      <Show when={target()}>
        <fieldset disabled={!props.snapshot.commands.visualEditing}>
          <legend>Appearance</legend>
          <StyleFields
            value={style()}
            effective={sceneItem()?.style}
            edge={edge()}
            fixedLine={!!sceneItem()?.notation}
            change={(path, value) => {
              if (edge() && path[0] === "text") change(path, value);
              else change(["style", ...path], value);
            }}
          />
          <button
            type="button"
            onClick={() => {
              const selected = target()!;
              void edit([
                editValue([...selected.path, "style"], undefined),
                ...(edge()
                  ? [editValue([...selected.path, "text"], undefined)]
                  : []),
              ]);
            }}
          >
            Reset appearance
          </button>
        </fieldset>
        <Show when={!edge()}>
          <fieldset disabled={!props.snapshot.commands.visualEditing}>
            <legend>Exact position</legend>
            <Show
              when={timer()}
              fallback={
                <>
                  {(["x", "y"] as const).map((axis) => (
                    <label>
                      {axis.toUpperCase()}
                      <input
                        aria-label={`Position ${axis.toUpperCase()}`}
                        type="number"
                        min="0"
                        step="any"
                        value={position()[axis]}
                        onChange={(event) => {
                          if (event.currentTarget.reportValidity())
                            change(["position"], {
                              ...position(),
                              [axis]: Number(event.currentTarget.value),
                            });
                        }}
                      />
                    </label>
                  ))}
                  <p class="field-help">
                    Coordinates are relative to the parent’s content area.
                  </p>
                </>
              }
            >
              <label>
                Anchor side
                <select
                  aria-label="Anchor side"
                  value={timer()?.anchor?.side ?? "bottom"}
                  onChange={(event) =>
                    change(["notation", "anchor"], {
                      side: event.currentTarget.value,
                      offset: timer()?.anchor?.offset ?? 0.8,
                    })
                  }
                >
                  {["top", "right", "bottom", "left"].map((side) => (
                    <option value={side}>{side}</option>
                  ))}
                </select>
              </label>
              <label>
                Anchor offset
                <input
                  aria-label="Anchor offset"
                  type="number"
                  min="0"
                  max="1"
                  step="any"
                  value={timer()?.anchor?.offset ?? 0.8}
                  onChange={(event) => {
                    if (event.currentTarget.reportValidity())
                      change(["notation", "anchor"], {
                        side: timer()?.anchor?.side ?? "bottom",
                        offset: Number(event.currentTarget.value),
                      });
                  }}
                />
              </label>
            </Show>
            <button
              type="button"
              disabled={
                props.snapshot.commands.presentation["use-automatic-position"]
                  .state !== "available"
              }
              onClick={() =>
                void props.execute({
                  type: "use-automatic-position",
                  elementId: id()!,
                })
              }
            >
              Use automatic position
            </button>
          </fieldset>
        </Show>
        <Show when={node()}>
          <fieldset disabled={!props.snapshot.commands.visualEditing}>
            <legend>Node attributes</legend>
            {Object.entries(record(at(entry(), ["attributes"]))).map(
              ([name, value]) => (
                <div class="attribute-card">
                  <label>
                    Attribute name
                    <input
                      aria-label={`Rename attribute ${name}`}
                      value={name}
                      onChange={(event) => {
                        const next = event.currentTarget.value.trim();
                        if (
                          !next ||
                          (next !== name &&
                            next in record(at(entry(), ["attributes"])))
                        ) {
                          setAttributeError(
                            "Use a unique, nonempty attribute name.",
                          );
                          return;
                        }
                        if (next !== name)
                          void edit([
                            {
                              type: "set",
                              path: [...target()!.path, "attributes", next],
                              value: value as MetadataValue,
                            },
                            {
                              type: "remove",
                              path: [...target()!.path, "attributes", name],
                            },
                          ]);
                      }}
                    />
                  </label>
                  <ScalarField
                    label={`Attribute ${name}`}
                    value={value as string | number | boolean}
                    change={(next) => change(["attributes", name], next)}
                  />
                  <button
                    type="button"
                    onClick={() => change(["attributes", name], undefined)}
                  >
                    Remove {name}
                  </button>
                </div>
              ),
            )}
            <label>
              New attribute name
              <input
                aria-label="New attribute name"
                value={attributeName()}
                onInput={(event) => setAttributeName(event.currentTarget.value)}
              />
            </label>
            <ScalarField
              label="New attribute value"
              value={attributeValue()}
              change={setAttributeValue}
            />
            <button
              type="button"
              onClick={() => {
                const name = attributeName().trim();
                if (!name || name in record(at(entry(), ["attributes"]))) {
                  setAttributeError("Use a unique, nonempty attribute name.");
                  return;
                }
                change(["attributes", name], attributeValue());
                setAttributeName("");
                setAttributeError("");
              }}
            >
              Add attribute
            </button>
            <Show when={attributeError()}>
              <p role="alert">{attributeError()}</p>
            </Show>
          </fieldset>
        </Show>
      </Show>
      <details>
        <summary>Diagram layout</summary>
        <fieldset disabled={!props.snapshot.commands.visualEditing}>
          <legend>Spacing</legend>
          {(
            [
              ["node", "Node spacing", 48],
              ["layer", "Layer spacing", 72],
              ["groupPadding", "Group padding", 24],
              ["lane", "Lane spacing", 32],
            ] as const
          ).map(([key, label, fallback]) => (
            <label>
              {label}
              <input
                aria-label={label}
                type="number"
                min="0"
                step="any"
                value={String(
                  at(props.snapshot.metadata, ["layout", "spacing", key]) ??
                    fallback,
                )}
                onChange={(event) => {
                  if (event.currentTarget.reportValidity())
                    void edit([
                      editValue(
                        ["layout", "spacing", key],
                        event.currentTarget.value
                          ? Number(event.currentTarget.value)
                          : undefined,
                      ),
                    ]);
                }}
              />
              <button
                type="button"
                aria-label={`Reset ${label.toLowerCase()}`}
                onClick={() =>
                  void edit([editValue(["layout", "spacing", key], undefined)])
                }
              >
                ↺
              </button>
            </label>
          ))}
          <button
            type="button"
            onClick={() =>
              void edit([{ type: "remove", path: ["layout", "spacing"] }])
            }
          >
            Reset spacing
          </button>
        </fieldset>
      </details>
      <details>
        <summary>Attributes and styling rules</summary>
        <RulesPanel
          rules={props.snapshot.metadata?.rules}
          disabled={!props.snapshot.commands.visualEditing}
          edit={edit}
        />
      </details>
      <Show when={unmatched().length}>
        <details>
          <summary>Unused presentation settings ({unmatched().length})</summary>
          <p class="field-help">
            These settings are preserved for elements absent from the current
            Mermaid source. Remove only those you no longer need.
          </p>
          {unmatched().map((item) => (
            <div class="unused-setting">
              <code>{item.path.join(" / ")}</code>
              <button type="button" onClick={() => void edit([item])}>
                Remove setting
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => void props.execute({ type: "cleanup-unmatched" })}
          >
            Clean up unused settings
          </button>
        </details>
      </Show>
    </div>
  );
}
