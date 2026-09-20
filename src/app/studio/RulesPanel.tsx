import { createSignal, Show } from "solid-js";
import type {
  MetadataEdit,
  MetadataPathPart,
  MetadataValue,
} from "../../core/metadata/types";
import { StyleFields } from "./StyleFields";
import { record, scalar } from "./metadataControls";

type Scalar = string | number | boolean;
export function ScalarField(props: {
  label: string;
  value: Scalar;
  change: (value: Scalar) => void;
}) {
  const [error, setError] = createSignal("");
  return (
    <div class="scalar-field">
      <label>
        {props.label}
        <input
          aria-label={props.label}
          value={String(props.value)}
          onChange={(event) => {
            try {
              props.change(
                scalar(event.currentTarget.value, typeof props.value),
              );
              setError("");
            } catch (error) {
              setError(String(error));
            }
          }}
        />
      </label>
      <label>
        Value type
        <select
          aria-label={`${props.label} type`}
          value={typeof props.value}
          onChange={(event) => {
            const type = event.currentTarget.value;
            props.change(
              type === "boolean"
                ? false
                : type === "number"
                  ? 0
                  : String(props.value),
            );
            setError("");
          }}
        >
          <option value="string">Text</option>
          <option value="number">Number</option>
          <option value="boolean">Boolean</option>
        </select>
      </label>
      <Show when={error()}>
        <p role="alert">{error()}</p>
      </Show>
    </div>
  );
}
interface Condition {
  name: string;
  operator: string;
  values: Scalar[];
}
function setNested(
  root: Record<string, unknown>,
  path: readonly MetadataPathPart[],
  value: MetadataValue | undefined,
): Record<string, unknown> {
  const copy = structuredClone(root);
  let parent = copy;
  for (const part of path.slice(0, -1)) {
    parent[part] = { ...record(parent[part]) };
    parent = parent[part] as Record<string, unknown>;
  }
  const last = path.at(-1)!;
  if (value === undefined) delete parent[last];
  else parent[last] = value;
  return copy;
}
function RuleEditor(props: {
  initial: Record<string, unknown>;
  save: (rule: MetadataValue) => void;
  cancel: () => void;
}) {
  const match = record(props.initial.match);
  const [id, setId] = createSignal(String(match.id ?? ""));
  const [classes, setClasses] = createSignal(
    Array.isArray(match.classes) ? match.classes.join(", ") : "",
  );
  const [conditions, setConditions] = createSignal<Condition[]>(
    Object.entries(record(match.attributes)).map(([name, predicate]) => {
      const [operator, value] = Object.entries(record(predicate))[0] ?? [
        "eq",
        "",
      ];
      return {
        name,
        operator,
        values: Array.isArray(value) ? (value as Scalar[]) : [value as Scalar],
      };
    }),
  );
  const [style, setStyle] = createSignal(record(props.initial.style));
  const [error, setError] = createSignal("");
  const update = (index: number, changes: Partial<Condition>) =>
    setConditions((items) =>
      items.map((item, i) => (i === index ? { ...item, ...changes } : item)),
    );
  return (
    <form
      class="rule-editor"
      onSubmit={(event) => {
        event.preventDefault();
        const attributes: Record<string, MetadataValue> = {};
        for (const condition of conditions()) {
          if (!condition.name.trim() || condition.name in attributes) {
            setError("Give each condition a unique attribute name.");
            return;
          }
          attributes[condition.name] = {
            [condition.operator]:
              condition.operator === "in"
                ? condition.values
                : condition.values[0]!,
          };
        }
        const matcher = {
          ...(id().trim() ? { id: id().trim() } : {}),
          ...(classes().trim()
            ? {
                classes: [
                  ...new Set(
                    classes()
                      .split(",")
                      .map((value) => value.trim())
                      .filter(Boolean),
                  ),
                ],
              }
            : {}),
          ...(conditions().length ? { attributes } : {}),
        };
        if (!Object.keys(matcher).length) {
          setError("Add an ID, class, or attribute condition.");
          return;
        }
        props.save({
          ...props.initial,
          match: matcher,
          style: style(),
        } as MetadataValue);
      }}
    >
      <label>
        Match node ID
        <input
          aria-label="Match node ID"
          value={id()}
          onInput={(event) => setId(event.currentTarget.value)}
        />
      </label>
      <label>
        Match classes
        <input
          aria-label="Match classes"
          placeholder="critical, approved"
          value={classes()}
          onInput={(event) => setClasses(event.currentTarget.value)}
        />
      </label>
      <p class="field-help">
        All conditions must match. Classes are separated by commas.
      </p>
      {conditions().map((condition, index) => (
        <div class="condition-card">
          <label>
            Attribute
            <input
              aria-label={`Condition ${index + 1} attribute`}
              value={condition.name}
              onChange={(event) =>
                update(index, { name: event.currentTarget.value })
              }
            />
          </label>
          <label>
            Condition
            <select
              aria-label={`Condition ${index + 1} operator`}
              value={condition.operator}
              onChange={(event) => {
                const operator = event.currentTarget.value;
                update(index, {
                  operator,
                  values:
                    operator === "exists"
                      ? [true]
                      : ["gt", "gte", "lt", "lte"].includes(operator)
                        ? [0]
                        : condition.values,
                });
              }}
            >
              {[
                ["eq", "Equals"],
                ["in", "Is one of"],
                ["gt", "Greater than"],
                ["gte", "At least"],
                ["lt", "Less than"],
                ["lte", "At most"],
                ["exists", "Exists"],
              ].map(([value, label]) => (
                <option value={value}>{label}</option>
              ))}
            </select>
          </label>
          <Show
            when={condition.operator === "eq" || condition.operator === "in"}
            fallback={
              <label>
                Comparison value
                <input
                  aria-label={`Condition ${index + 1} value`}
                  type={condition.operator === "exists" ? "checkbox" : "number"}
                  step="any"
                  checked={Boolean(condition.values[0])}
                  value={String(condition.values[0])}
                  onChange={(event) =>
                    update(index, {
                      values: [
                        condition.operator === "exists"
                          ? event.currentTarget.checked
                          : Number(event.currentTarget.value),
                      ],
                    })
                  }
                />
              </label>
            }
          >
            {(condition.operator === "in"
              ? condition.values
              : condition.values.slice(0, 1)
            ).map((value, valueIndex) => (
              <div>
                <ScalarField
                  label={`Condition ${index + 1} value ${valueIndex + 1}`}
                  value={value}
                  change={(next) =>
                    update(index, {
                      values: condition.values.map((item, i) =>
                        i === valueIndex ? next : item,
                      ),
                    })
                  }
                />
                <Show
                  when={
                    condition.operator === "in" && condition.values.length > 1
                  }
                >
                  <button
                    type="button"
                    onClick={() =>
                      update(index, {
                        values: condition.values.filter(
                          (_, i) => i !== valueIndex,
                        ),
                      })
                    }
                  >
                    Remove value
                  </button>
                </Show>
              </div>
            ))}
            <Show when={condition.operator === "in"}>
              <button
                type="button"
                onClick={() =>
                  update(index, { values: [...condition.values, ""] })
                }
              >
                Add value
              </button>
            </Show>
          </Show>
          <button
            type="button"
            onClick={() =>
              setConditions((items) => items.filter((_, i) => i !== index))
            }
          >
            Remove condition
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          setConditions((items) => [
            ...items,
            { name: "", operator: "eq", values: [""] },
          ])
        }
      >
        Add condition
      </button>
      <StyleFields
        value={style()}
        change={(path, value) =>
          setStyle((current) => setNested(current, path, value))
        }
      />
      <Show when={error()}>
        <p role="alert">{error()}</p>
      </Show>
      <div class="studio-actions">
        <button type="submit">Save rule</button>
        <button type="button" onClick={props.cancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
export function RulesPanel(props: {
  rules: unknown;
  disabled: boolean;
  edit: (edits: readonly MetadataEdit[]) => Promise<boolean>;
}) {
  const rules = () =>
    Array.isArray(props.rules)
      ? (props.rules as Record<string, unknown>[])
      : [];
  const [editing, setEditing] = createSignal<{
    index: number;
    rule: Record<string, unknown>;
  }>();
  const replace = (value: readonly Record<string, unknown>[]) =>
    props.edit([
      { type: "set", path: ["rules"], value: value as MetadataValue },
    ]);
  const move = (index: number, step: number) => {
    const list = [...rules()];
    [list[index], list[index + step]] = [list[index + step]!, list[index]!];
    void replace(list);
  };
  return (
    <fieldset disabled={props.disabled}>
      <legend>Styling rules</legend>
      <p class="field-help">
        Rules apply to nodes in order. Later rules override earlier rules;
        individual overrides take priority.
      </p>
      <ol class="rule-list">
        {rules().map((rule, index) => (
          <li>
            <strong>Rule {index + 1}</strong>
            <span>
              {Object.entries(record(rule.match))
                .map(
                  ([key, value]) =>
                    `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`,
                )
                .join(" · ")}
            </span>
            <div class="studio-actions">
              <button type="button" onClick={() => setEditing({ index, rule })}>
                Edit rule {index + 1}
              </button>
              <button
                type="button"
                aria-label={`Move rule ${index + 1} up`}
                disabled={index === 0 || !!editing()}
                onClick={() => move(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`Move rule ${index + 1} down`}
                disabled={index === rules().length - 1 || !!editing()}
                onClick={() => move(index, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                disabled={!!editing()}
                onClick={() =>
                  void replace(rules().filter((_, i) => i !== index))
                }
              >
                Delete rule {index + 1}
              </button>
            </div>
          </li>
        ))}
      </ol>
      <button
        type="button"
        onClick={() =>
          setEditing({ index: rules().length, rule: { match: {}, style: {} } })
        }
      >
        Add styling rule
      </button>
      <Show when={editing()} keyed>
        {(draft) => (
          <RuleEditor
            initial={draft.rule}
            cancel={() => setEditing(undefined)}
            save={(rule) => {
              void props
                .edit([
                  { type: "set", path: ["rules", draft.index], value: rule },
                ])
                .then((success) => {
                  if (success) setEditing(undefined);
                });
            }}
          />
        )}
      </Show>
    </fieldset>
  );
}
