import type { MermaidNode, MermaidSemanticModel, MermaidStyle } from "../model";
import type {
  ComputedNodeStyle,
  ComputedRelationshipStyle,
  ComputedTextStyle,
} from "./types";

type UnknownRecord = Record<string, unknown>;

const defaultText: ComputedTextStyle = {
  color: "#172033",
  size: 15,
  weight: 500,
  italic: false,
};

const defaultNode: ComputedNodeStyle = {
  fill: "#ffffff",
  outline: { color: "#64748b", width: 1.5, style: "solid" },
  text: defaultText,
};

function record(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function lineStyle(value: unknown): "solid" | "dashed" | "dotted" | undefined {
  return value === "solid" || value === "dashed" || value === "dotted"
    ? value
    : undefined;
}

function mergeText(base: ComputedTextStyle, value: unknown): ComputedTextStyle {
  const style = record(value);
  const weight = finite(style.weight);
  return {
    color: typeof style.color === "string" ? style.color : base.color,
    size: finite(style.size) ?? base.size,
    weight:
      weight === 400 || weight === 500 || weight === 600 || weight === 700
        ? weight
        : base.weight,
    italic: typeof style.italic === "boolean" ? style.italic : base.italic,
  };
}

function mergeNode(base: ComputedNodeStyle, value: unknown): ComputedNodeStyle {
  const style = record(value);
  const outline = record(style.outline);
  return {
    fill: typeof style.fill === "string" ? style.fill : base.fill,
    outline: {
      color:
        typeof outline.color === "string" ? outline.color : base.outline.color,
      width: finite(outline.width) ?? base.outline.width,
      style: lineStyle(outline.style) ?? base.outline.style,
    },
    text: mergeText(base.text, style.text),
  };
}

function mergeMermaid(
  base: ComputedNodeStyle,
  style: MermaidStyle,
): ComputedNodeStyle {
  const declarations = style.declarations;
  const width = Number.parseFloat(declarations["stroke-width"] ?? "");
  const size = Number.parseFloat(declarations["font-size"] ?? "");
  const weight = Number.parseInt(declarations["font-weight"] ?? "", 10);
  return {
    fill: declarations.fill ?? base.fill,
    outline: {
      color: declarations.stroke ?? base.outline.color,
      width: Number.isFinite(width) ? width : base.outline.width,
      style: declarations["stroke-dasharray"] ? "dashed" : base.outline.style,
    },
    text: {
      color: declarations.color ?? base.text.color,
      size: Number.isFinite(size) ? size : base.text.size,
      weight:
        weight === 400 || weight === 500 || weight === 600 || weight === 700
          ? weight
          : base.text.weight,
      italic: declarations["font-style"] === "italic" ? true : base.text.italic,
    },
  };
}

function predicateMatches(value: unknown, predicateValue: unknown): boolean {
  const predicate = record(predicateValue);
  if ("eq" in predicate) return value === predicate.eq;
  if (Array.isArray(predicate.in)) return predicate.in.includes(value);
  if (typeof predicate.exists === "boolean") {
    return predicate.exists === (value !== undefined);
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (typeof predicate.gt === "number") return value > predicate.gt;
  if (typeof predicate.gte === "number") return value >= predicate.gte;
  if (typeof predicate.lt === "number") return value < predicate.lt;
  if (typeof predicate.lte === "number") return value <= predicate.lte;
  return false;
}

function ruleMatches(
  node: MermaidNode,
  matchValue: unknown,
  attributes: UnknownRecord,
): boolean {
  const match = record(matchValue);
  if (typeof match.id === "string" && match.id !== node.id) return false;
  if (
    Array.isArray(match.classes) &&
    !match.classes.every(
      (className) =>
        typeof className === "string" && node.classes.includes(className),
    )
  ) {
    return false;
  }
  const predicates = record(match.attributes);
  return Object.entries(predicates).every(([name, predicate]) =>
    predicateMatches(attributes[name], predicate),
  );
}

export function computedNodeStyle(
  model: MermaidSemanticModel,
  node: MermaidNode,
  metadata: Readonly<Record<string, unknown>> | undefined,
): ComputedNodeStyle {
  let result = defaultNode;
  for (const className of node.classes) {
    const classStyle = model.classDefinitions[className];
    if (classStyle) {
      result = mergeMermaid(result, classStyle.style);
      result = mergeMermaid(result, classStyle.textStyle);
    }
  }
  result = mergeMermaid(result, node.style);
  const root = record(metadata);
  const entry = record(record(record(root.elements).nodes)[node.id]);
  const attributes = record(entry.attributes);
  if (Array.isArray(root.rules)) {
    for (const ruleValue of root.rules) {
      const rule = record(ruleValue);
      if (ruleMatches(node, rule.match, attributes)) {
        result = mergeNode(result, rule.style);
      }
    }
  }
  return mergeNode(result, entry.style);
}

export function computedGroupStyle(
  kind: "subgraph" | "lane" | "boundary",
  id: string,
  metadata: Readonly<Record<string, unknown>> | undefined,
): ComputedNodeStyle {
  const root = record(metadata);
  const category = kind === "lane" ? "lanes" : "groups";
  const entry = record(record(record(root.elements)[category])[id]);
  return mergeNode(
    {
      fill: kind === "lane" ? "#f8fafc" : "#f1f5f9",
      outline: { color: "#94a3b8", width: 1.5, style: "solid" },
      text: { ...defaultText, weight: 600 },
    },
    entry.style,
  );
}

export function computedRelationshipStyle(
  entry: unknown,
  mermaid: MermaidStyle,
): ComputedRelationshipStyle {
  const declarations = mermaid.declarations;
  const authored = record(record(entry).style);
  const text = mergeText(defaultText, record(entry).text);
  const width = finite(authored.width);
  const mermaidWidth = Number.parseFloat(declarations["stroke-width"] ?? "");
  return {
    color:
      typeof authored.color === "string"
        ? authored.color
        : (declarations.stroke ?? "#64748b"),
    width: width ?? (Number.isFinite(mermaidWidth) ? mermaidWidth : 1.75),
    style:
      lineStyle(authored.style) ??
      (declarations["stroke-dasharray"] ? "dashed" : "solid"),
    text,
  };
}

export function metadataRecord(value: unknown): UnknownRecord {
  return record(value);
}
