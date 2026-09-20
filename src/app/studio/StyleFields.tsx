import { Show } from "solid-js";
import type {
  MetadataPathPart,
  MetadataValue,
} from "../../core/metadata/types";
import { at } from "./metadataControls";

/** The same style vocabulary is used for individual overrides and rule output. */
export function StyleFields(props: {
  value: unknown;
  effective?: unknown;
  edge?: boolean;
  fixedLine?: boolean;
  change: (
    path: readonly MetadataPathPart[],
    value: MetadataValue | undefined,
  ) => void;
}) {
  const line = () => (props.edge ? [] : ["outline"]);
  const text = () => ["text", "color"];
  const current = (path: readonly MetadataPathPart[]) => at(props.value, path);
  const effective = (path: readonly MetadataPathPart[]) =>
    current(path) ?? at(props.effective, path);
  const colorField = (
    label: string,
    path: () => readonly MetadataPathPart[],
  ) => (
    <label class="studio-field">
      {label}
      <span class="studio-field__controls">
        <input
          type="text"
          aria-label={label}
          value={String(effective(path()) ?? "")}
          placeholder="#RRGGBB or #RRGGBBAA"
          pattern="#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?"
          onChange={(event) => {
            if (event.currentTarget.reportValidity())
              props.change(path(), event.currentTarget.value || undefined);
          }}
        />
        <input
          type="color"
          aria-label={`${label} picker`}
          value={String(effective(path()) ?? "#ffffff").slice(0, 7)}
          onInput={(event) => props.change(path(), event.currentTarget.value)}
        />
        <button
          type="button"
          aria-label={`Reset ${label.toLowerCase()}`}
          disabled={current(path()) === undefined}
          onClick={() => props.change(path(), undefined)}
        >
          ↺
        </button>
      </span>
    </label>
  );
  return (
    <div class="style-fields">
      <Show when={!props.edge}>
        {colorField("Fill colour", () => ["fill"])}
      </Show>
      {colorField(props.edge ? "Connector colour" : "Outline colour", () => [
        ...line(),
        "color",
      ])}
      <label>
        Line width
        <input
          aria-label="Line width"
          type="number"
          min="0.1"
          step="any"
          value={String(effective([...line(), "width"]) ?? "")}
          onChange={(event) => {
            if (event.currentTarget.reportValidity())
              props.change(
                [...line(), "width"],
                event.currentTarget.value
                  ? Number(event.currentTarget.value)
                  : undefined,
              );
          }}
        />
        <button
          type="button"
          onClick={() => props.change([...line(), "width"], undefined)}
        >
          Reset width
        </button>
      </label>
      <label>
        Line pattern
        <select
          aria-label="Line pattern"
          disabled={props.fixedLine}
          title={
            props.fixedLine
              ? "Process notation determines its identifying line pattern."
              : undefined
          }
          value={String(current([...line(), "style"]) ?? "")}
          onChange={(event) =>
            props.change(
              [...line(), "style"],
              event.currentTarget.value || undefined,
            )
          }
        >
          <option value="">
            Inherit (
            {String(at(props.effective, [...line(), "style"]) ?? "solid")})
          </option>
          <option value="solid">Solid</option>
          <option value="dashed">Dashed</option>
          <option value="dotted">Dotted</option>
        </select>
      </label>
      <Show when={props.fixedLine}>
        <p class="field-help">
          Process notation determines the identifying line pattern.
        </p>
      </Show>
      <details>
        <summary>Typography</summary>
        {colorField("Text colour", text)}
        <label>
          Text size
          <input
            aria-label="Text size"
            type="number"
            min="1"
            step="any"
            value={String(effective(["text", "size"]) ?? "")}
            onChange={(event) => {
              if (event.currentTarget.reportValidity())
                props.change(
                  ["text", "size"],
                  event.currentTarget.value
                    ? Number(event.currentTarget.value)
                    : undefined,
                );
            }}
          />
          <button
            type="button"
            onClick={() => props.change(["text", "size"], undefined)}
          >
            Reset size
          </button>
        </label>
        <label>
          Text weight
          <select
            aria-label="Text weight"
            value={String(current(["text", "weight"]) ?? "")}
            onChange={(event) =>
              props.change(
                ["text", "weight"],
                event.currentTarget.value
                  ? Number(event.currentTarget.value)
                  : undefined,
              )
            }
          >
            <option value="">
              Inherit ({String(at(props.effective, ["text", "weight"]) ?? 400)})
            </option>
            {[400, 500, 600, 700].map((weight) => (
              <option value={weight}>{weight}</option>
            ))}
          </select>
        </label>
        <label>
          Text slant
          <select
            aria-label="Text slant"
            value={
              current(["text", "italic"]) === undefined
                ? ""
                : String(current(["text", "italic"]))
            }
            onChange={(event) =>
              props.change(
                ["text", "italic"],
                event.currentTarget.value === ""
                  ? undefined
                  : event.currentTarget.value === "true",
              )
            }
          >
            <option value="">
              Inherit (
              {at(props.effective, ["text", "italic"]) ? "italic" : "upright"})
            </option>
            <option value="false">Upright</option>
            <option value="true">Italic</option>
          </select>
        </label>
      </details>
      <p class="field-help">
        Eight-digit hex colours include transparency. Reset a value to inherit
        its appearance.
      </p>
    </div>
  );
}
