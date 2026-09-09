import Ajv2020, {
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import {
  isMap,
  isPair,
  isScalar,
  isSeq,
  parseDocument,
  type Document,
  type Node,
  type Pair,
} from "yaml";

import schema from "../../../docs/schema/manatee-v1.schema.json" with { type: "json" };
import type { DocumentDiagnostic, SourcePatch } from "../document/types";
import { applySourcePatches } from "../source/patches";
import { findFrontMatter, type FrontMatterBlock } from "./frontMatter";
import type {
  AuthoredIdentityIndex,
  ManateeMetadataPatch,
  ManateeMetadataRead,
  MetadataEdit,
  MetadataPathPart,
  UnmatchedMetadata,
} from "./types";

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validate = ajv.compile(schema) as ValidateFunction;
const INVALID = Symbol("invalid metadata value");

type UnknownRecord = Record<string, unknown>;
type SchemaNode = Record<string, unknown>;

interface ParsedYaml {
  readonly block: FrontMatterBlock;
  readonly content: string;
  readonly yamlDocument: Document;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function keyValue(pair: Pair): unknown {
  return isScalar(pair.key) ? pair.key.value : undefined;
}

function manateePair(yamlDocument: Document): Pair | undefined {
  if (!isMap(yamlDocument.contents)) return;
  return yamlDocument.contents.items.find(
    (item): item is Pair => isPair(item) && keyValue(item) === "manatee",
  );
}

function rangeOf(node: Node | null | undefined): readonly number[] | undefined {
  return node && "range" in node ? (node.range ?? undefined) : undefined;
}

function sourceRangeForPath(
  parsed: ParsedYaml,
  path: readonly MetadataPathPart[],
): { start: number; end: number } | undefined {
  const node = parsed.yamlDocument.getIn(["manatee", ...path], true) as
    Node | undefined;
  const range = rangeOf(node);
  if (!range) return;
  return {
    start: parsed.block.content.start + (range[0] ?? 0),
    end: parsed.block.content.start + (range[1] ?? range[0] ?? 0),
  };
}

function yamlDiagnostic(parsed: ParsedYaml): DocumentDiagnostic[] {
  return parsed.yamlDocument.errors.map((error) => {
    const start = error.pos[0] ?? 0;
    const end = error.pos[1] ?? start;
    return {
      code: "manatee.yaml",
      message: error.message,
      severity: "error",
      range: {
        start: parsed.block.content.start + start,
        end: parsed.block.content.start + end,
      },
      path: "frontmatter",
    };
  });
}

function pointerParts(error: ErrorObject): MetadataPathPart[] {
  const parts = error.instancePath
    .split("/")
    .slice(1)
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
  if (error.keyword === "required") {
    const property = (error.params as { missingProperty?: string })
      .missingProperty;
    if (property) parts.push(property);
  }
  return parts;
}

function validationDiagnostics(
  parsed: ParsedYaml,
  errors: readonly ErrorObject[],
): DocumentDiagnostic[] {
  return errors.map((error) => {
    const parts = pointerParts(error);
    const range = sourceRangeForPath(parsed, parts);
    return {
      code: `manatee.schema.${error.keyword}`,
      message: `Invalid Manatee setting at manatee${error.instancePath || ""}: ${error.message ?? "schema validation failed"}.`,
      severity: "warning",
      ...(range ? { range } : {}),
      path: ["manatee", ...parts].join("."),
    };
  });
}

function resolveSchema(node: SchemaNode): SchemaNode {
  const reference = node.$ref;
  if (typeof reference !== "string" || !reference.startsWith("#/$defs/")) {
    return node;
  }
  const name = reference.slice("#/$defs/".length);
  const definition = (schema.$defs as Record<string, SchemaNode>)[name];
  return definition ? resolveSchema(definition) : node;
}

function validPrimitive(value: unknown, node: SchemaNode): boolean {
  if ("const" in node && value !== node.const) return false;
  if (Array.isArray(node.enum) && !node.enum.includes(value)) return false;

  if (node.type === "string") {
    if (typeof value !== "string") return false;
    if (typeof node.minLength === "number" && value.length < node.minLength) {
      return false;
    }
    if (
      typeof node.pattern === "string" &&
      !new RegExp(node.pattern).test(value)
    ) {
      return false;
    }
  }
  if (node.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    if (typeof node.minimum === "number" && value < node.minimum) return false;
    if (
      typeof node.exclusiveMinimum === "number" &&
      value <= node.exclusiveMinimum
    ) {
      return false;
    }
  }
  if (node.type === "boolean" && typeof value !== "boolean") return false;
  return true;
}

function projectKnown(
  value: unknown,
  inputSchema: SchemaNode,
): unknown | typeof INVALID {
  const node = resolveSchema(inputSchema);
  if (Array.isArray(node.allOf)) {
    return projectKnown(value, node.allOf[0] as SchemaNode);
  }
  if (Array.isArray(node.oneOf)) {
    const candidates = node.oneOf
      .map((candidate) => projectKnown(value, candidate as SchemaNode))
      .filter((candidate) => candidate !== INVALID);
    return candidates.length === 1 ? candidates[0] : INVALID;
  }

  if (node.type === "object") {
    if (!isRecord(value)) return INVALID;
    const properties = isRecord(node.properties)
      ? (node.properties as Record<string, SchemaNode>)
      : {};
    const required = new Set(
      Array.isArray(node.required) ? (node.required as string[]) : [],
    );
    const projected: UnknownRecord = {};

    for (const [key, child] of Object.entries(value)) {
      const propertySchema = properties[key];
      if (propertySchema) {
        const result = projectKnown(child, propertySchema);
        if (result !== INVALID) projected[key] = result;
        continue;
      }

      if (isRecord(node.additionalProperties)) {
        const result = projectKnown(
          child,
          node.additionalProperties as SchemaNode,
        );
        if (result !== INVALID) projected[key] = result;
      } else if (node.additionalProperties === false) {
        return INVALID;
      } else {
        projected[key] = child;
      }
    }

    for (const key of required) {
      if (!(key in projected)) return INVALID;
    }
    if (
      typeof node.minProperties === "number" &&
      Object.keys(projected).length < node.minProperties
    ) {
      return INVALID;
    }
    return projected;
  }

  if (node.type === "array") {
    if (!Array.isArray(value)) return INVALID;
    const projected = value
      .map((item) => projectKnown(item, node.items as SchemaNode))
      .filter((item) => item !== INVALID);
    if (typeof node.minItems === "number" && projected.length < node.minItems) {
      return INVALID;
    }
    if (
      node.uniqueItems === true &&
      new Set(projected).size !== projected.length
    ) {
      return INVALID;
    }
    return projected;
  }

  return validPrimitive(value, node) ? value : INVALID;
}

function parseYaml(
  source: string,
):
  | { readonly kind: "absent" }
  | { readonly kind: "malformed"; readonly diagnostics: DocumentDiagnostic[] }
  | { readonly kind: "parsed"; readonly parsed: ParsedYaml } {
  const frontMatter = findFrontMatter(source);
  if (frontMatter.kind === "absent") return { kind: "absent" };
  if (frontMatter.kind === "malformed") {
    return { kind: "malformed", diagnostics: [frontMatter.diagnostic] };
  }

  const content = source.slice(
    frontMatter.block.content.start,
    frontMatter.block.content.end,
  );
  const parsed: ParsedYaml = {
    block: frontMatter.block,
    content,
    yamlDocument: parseDocument(content, {
      keepSourceTokens: true,
      prettyErrors: false,
      strict: true,
    }),
  };
  const diagnostics = yamlDiagnostic(parsed);
  return diagnostics.length > 0
    ? { kind: "malformed", diagnostics }
    : { kind: "parsed", parsed };
}

export function readManateeMetadata(source: string): ManateeMetadataRead {
  const yaml = parseYaml(source);
  if (yaml.kind === "absent") {
    return {
      state: "absent",
      sourceMetadata: undefined,
      metadata: undefined,
      diagnostics: [],
      visualEditing: true,
    };
  }
  if (yaml.kind === "malformed") {
    return {
      state: "malformed",
      sourceMetadata: undefined,
      metadata: undefined,
      diagnostics: yaml.diagnostics,
      visualEditing: false,
    };
  }

  const pair = manateePair(yaml.parsed.yamlDocument);
  if (!pair) {
    return {
      state: "absent",
      sourceMetadata: undefined,
      metadata: undefined,
      diagnostics: [],
      visualEditing: true,
    };
  }

  const root = yaml.parsed.yamlDocument.toJS() as unknown;
  const raw =
    isRecord(root) && isRecord(root.manatee) ? root.manatee : undefined;
  if (!raw) {
    const range = sourceRangeForPath(yaml.parsed, []);
    return {
      state: "invalid",
      sourceMetadata: undefined,
      metadata: undefined,
      diagnostics: [
        {
          code: "manatee.schema.type",
          message: "The manatee field must be a YAML mapping.",
          severity: "warning",
          ...(range === undefined ? {} : { range }),
          path: "manatee",
        },
      ],
      visualEditing: false,
    };
  }

  if (raw.version !== 1) {
    const range = sourceRangeForPath(yaml.parsed, ["version"]);
    return {
      state: "unknown-version",
      sourceMetadata: raw,
      metadata: undefined,
      diagnostics: [
        {
          code: "manatee.version.unsupported",
          message: `Manatee metadata version ${String(raw.version)} is not supported.`,
          severity: "warning",
          ...(range === undefined ? {} : { range }),
          path: "manatee.version",
        },
      ],
      visualEditing: false,
    };
  }

  const valid = validate(raw);
  const projection = projectKnown(raw, schema as SchemaNode);
  const metadata =
    projection === INVALID ? undefined : (projection as UnknownRecord);
  const diagnostics = valid
    ? []
    : validationDiagnostics(yaml.parsed, validate.errors ?? []);
  return {
    state: valid ? "valid" : "invalid",
    sourceMetadata: raw,
    metadata,
    diagnostics,
    visualEditing: true,
  };
}

function pairRange(pair: Pair): { start: number; end: number } | undefined {
  const keyRange = rangeOf(pair.key as Node);
  const valueRange = rangeOf(pair.value as Node);
  if (!keyRange || !valueRange) return;
  return { start: keyRange[0] ?? 0, end: valueRange[2] ?? valueRange[1] ?? 0 };
}

function renderedManateePair(yamlDocument: Document): string {
  const rendered = yamlDocument.toString({ lineWidth: 0 });
  const reparsed = parseDocument(rendered, { keepSourceTokens: true });
  const pair = manateePair(reparsed);
  const range = pair && pairRange(pair);
  if (!range)
    throw new Error("Could not serialize the Manatee metadata mapping.");
  return rendered.slice(range.start, range.end);
}

function ensureEditParents(
  yamlDocument: Document,
  path: readonly MetadataPathPart[],
): void {
  for (let index = 1; index < path.length; index += 1) {
    const parentPath = path.slice(0, index);
    const current = yamlDocument.getIn(parentPath, true) as Node | undefined;
    const nextPart = path[index];
    const expectedCollection =
      typeof nextPart === "number" ? isSeq(current) : isMap(current);
    if (!expectedCollection) {
      yamlDocument.setIn(
        parentPath,
        yamlDocument.createNode(typeof nextPart === "number" ? [] : {}),
      );
    }
  }
}

function compareRemovalOrder(left: MetadataEdit, right: MetadataEdit): number {
  const leftParent = left.path.slice(0, -1).join("\u0000");
  const rightParent = right.path.slice(0, -1).join("\u0000");
  if (leftParent !== rightParent) return leftParent.localeCompare(rightParent);
  const leftKey = left.path.at(-1);
  const rightKey = right.path.at(-1);
  return typeof leftKey === "number" && typeof rightKey === "number"
    ? rightKey - leftKey
    : 0;
}

function applyMetadataEdits(
  yamlDocument: Document,
  edits: readonly MetadataEdit[],
): void {
  const ordered = [
    ...edits.filter(({ type }) => type === "set"),
    ...edits.filter(({ type }) => type === "remove").sort(compareRemovalOrder),
  ];
  for (const edit of ordered) {
    const path = ["manatee", ...edit.path];
    if (edit.type === "set") {
      ensureEditParents(yamlDocument, path);
      yamlDocument.setIn(path, edit.value);
    } else {
      yamlDocument.deleteIn(path);
    }
  }
}

export function patchManateeMetadata(
  source: string,
  edits: readonly MetadataEdit[],
): ManateeMetadataPatch {
  const before = readManateeMetadata(source);
  if (edits.length === 0) return { ...before, source, patches: [] };
  if (before.state === "malformed" || before.state === "unknown-version") {
    return { ...before, source, patches: [] };
  }

  const yaml = parseYaml(source);
  let patches: readonly SourcePatch[];
  if (yaml.kind === "absent") {
    const yamlDocument = parseDocument("manatee:\n  version: 1\n", {
      keepSourceTokens: true,
    });
    applyMetadataEdits(yamlDocument, edits);
    const newline = source.includes("\r\n") ? "\r\n" : "\n";
    const block =
      `---\n${yamlDocument.toString({ lineWidth: 0 })}---\n`.replaceAll(
        "\n",
        newline,
      );
    const insertionPoint = source.startsWith("\uFEFF") ? 1 : 0;
    patches = [
      {
        range: { start: insertionPoint, end: insertionPoint },
        replacement: block,
      },
    ];
  } else if (yaml.kind === "parsed") {
    const originalPair = manateePair(yaml.parsed.yamlDocument);
    if (!originalPair) {
      yaml.parsed.yamlDocument.set("manatee", { version: 1 });
      applyMetadataEdits(yaml.parsed.yamlDocument, edits);
      const fragment = renderedManateePair(yaml.parsed.yamlDocument).replaceAll(
        "\n",
        yaml.parsed.block.newline,
      );
      const prefix =
        yaml.parsed.content.length > 0 &&
        !yaml.parsed.content.endsWith("\n") &&
        !yaml.parsed.content.endsWith("\r")
          ? yaml.parsed.block.newline
          : "";
      patches = [
        {
          range: {
            start: yaml.parsed.block.content.end,
            end: yaml.parsed.block.content.end,
          },
          replacement: prefix + fragment,
        },
      ];
    } else {
      const originalRange = pairRange(originalPair);
      if (!originalRange)
        throw new Error("The Manatee mapping has no source range.");
      applyMetadataEdits(yaml.parsed.yamlDocument, edits);
      const fragment = renderedManateePair(yaml.parsed.yamlDocument).replaceAll(
        "\n",
        yaml.parsed.block.newline,
      );
      patches = [
        {
          range: {
            start: yaml.parsed.block.content.start + originalRange.start,
            end: yaml.parsed.block.content.start + originalRange.end,
          },
          replacement: fragment,
        },
      ];
    }
  } else {
    return { ...before, source, patches: [] };
  }

  const updatedSource = applySourcePatches(source, patches);
  return {
    ...readManateeMetadata(updatedSource),
    source: updatedSource,
    patches,
  };
}

function relationshipMatcherKey(value: unknown): string | undefined {
  if (!isRecord(value)) return;
  const { source, target, kind } = value;
  if (
    typeof source !== "string" ||
    typeof target !== "string" ||
    typeof kind !== "string"
  ) {
    return;
  }
  return `${source}\u0000${target}\u0000${kind}`;
}

function entriesAt(
  root: UnknownRecord,
  path: readonly string[],
): UnknownRecord {
  let current: unknown = root;
  for (const part of path) {
    if (!isRecord(current)) return {};
    current = current[part];
  }
  return isRecord(current) ? current : {};
}

export function findUnmatchedMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined,
  identities: AuthoredIdentityIndex,
): UnmatchedMetadata {
  if (!metadata) return { edits: [], diagnostics: [] };
  const edits: MetadataEdit[] = [];
  const diagnostics: DocumentDiagnostic[] = [];
  const categories = [
    ["nodes", identities.nodes],
    ["groups", identities.groups],
    ["lanes", identities.lanes],
  ] as const;

  for (const [category, authored] of categories) {
    for (const id of Object.keys(entriesAt(metadata, ["elements", category]))) {
      if (authored.has(id)) continue;
      const path = ["elements", category, id] as const;
      edits.push({ type: "remove", path });
      diagnostics.push({
        code: "manatee.element.unmatched",
        message: `Presentation settings refer to missing ${category.slice(0, -1)} ${id}.`,
        severity: "warning",
        path: ["manatee", ...path].join("."),
      });
    }
  }

  const byId = entriesAt(metadata, ["elements", "relationships", "byId"]);
  for (const id of Object.keys(byId)) {
    if (identities.relationships.has(id)) continue;
    const path = ["elements", "relationships", "byId", id] as const;
    edits.push({ type: "remove", path });
    diagnostics.push({
      code: "manatee.relationship.unmatched",
      message: `Presentation settings refer to missing relationship ${id}.`,
      severity: "warning",
      path: ["manatee", ...path].join("."),
    });
  }

  const relationships = entriesAt(metadata, ["elements", "relationships"]);
  const byEndpoints = relationships.byEndpoints;
  if (Array.isArray(byEndpoints)) {
    byEndpoints.forEach((entry, index) => {
      const key = isRecord(entry)
        ? relationshipMatcherKey(entry.match)
        : undefined;
      if (key && identities.relationshipMatchers.has(key)) return;
      const path = ["elements", "relationships", "byEndpoints", index] as const;
      edits.push({ type: "remove", path });
      diagnostics.push({
        code: "manatee.relationship.unmatched",
        message:
          "Presentation settings refer to a missing relationship matcher.",
        severity: "warning",
        path: ["manatee", ...path].join("."),
      });
    });
  }

  return { edits, diagnostics };
}
