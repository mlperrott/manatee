import {
  BPMN_MODEL_NAMESPACE,
  MANATEE_BPMN_NAMESPACE,
  patchManateePresentationAttributes,
  readBpmnSource,
  xmlAttributePatches,
} from "../../core/bpmn/bpmnSource";
import {
  xmlAttribute,
  xmlAttributeByLocalName,
  type XmlElementRange,
  type XmlRangeIndex,
} from "../../core/bpmn/xmlRangeIndex";
import type { SourcePatch } from "../../core/document/types";
import {
  applySourcePatches,
  minimalSourcePatch,
  UnsafeSourcePatchError,
} from "../../core/source/patches";

export interface BpmnSourceEdit {
  readonly source: string;
  readonly patches: readonly SourcePatch[];
}

function topLevelDi(index: XmlRangeIndex): readonly XmlElementRange[] {
  const root = index.root;
  return root
    ? index.elements.filter(
        (element) =>
          element.parentIndex === root.index &&
          element.localName === "BPMNDiagram",
      )
    : [];
}

function namespaceAttributes(
  source: string,
  root: XmlElementRange,
): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const attribute of root.attributes) {
    if (attribute.name === "xmlns" || attribute.name.startsWith("xmlns:")) {
      result[attribute.name] = source.slice(
        attribute.value.start,
        attribute.value.end,
      );
    }
  }
  return result;
}

export function patchBpmnDiagramInterchange(
  source: string,
  generatedSource: string,
): BpmnSourceEdit {
  const original = readBpmnSource(source, { kind: "bpmn" });
  const generated = readBpmnSource(generatedSource, { kind: "bpmn" });
  if (
    !original.valid ||
    !original.index.root ||
    !generated.valid ||
    !generated.index.root
  ) {
    throw new UnsafeSourcePatchError(
      "Automatic layout did not produce valid BPMN XML.",
    );
  }
  const nextDi = topLevelDi(generated.index);
  if (nextDi.length === 0) {
    throw new UnsafeSourcePatchError(
      "Automatic layout did not produce BPMN Diagram Interchange.",
    );
  }
  const currentDi = topLevelDi(original.index);
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const diagramXml = nextDi
    .map((diagram) =>
      generatedSource.slice(diagram.whole.start, diagram.whole.end),
    )
    .join(`${newline}  `);
  const patches: SourcePatch[] = [];
  const firstCurrent = currentDi[0];
  const lastCurrent = currentDi.at(-1);
  if (firstCurrent && lastCurrent) {
    for (let index = 1; index < currentDi.length; index += 1) {
      const previous = currentDi[index - 1];
      const current = currentDi[index];
      if (
        previous &&
        current &&
        source.slice(previous.whole.end, current.whole.start).trim().length > 0
      ) {
        throw new UnsafeSourcePatchError(
          "Unknown content is interleaved with BPMN diagram planes.",
        );
      }
    }
    patches.push({
      range: { start: firstCurrent.whole.start, end: lastCurrent.whole.end },
      replacement: diagramXml,
    });
  } else {
    const root = original.index.root;
    if (!root.endTag) {
      throw new UnsafeSourcePatchError(
        "The BPMN definitions element cannot contain generated DI.",
      );
    }
    patches.push({
      range: { start: root.endTag.start, end: root.endTag.start },
      replacement: `${newline}  ${diagramXml}${newline}`,
    });
  }
  const originalNamespaces = namespaceAttributes(source, original.index.root);
  const generatedNamespaces = namespaceAttributes(
    generatedSource,
    generated.index.root,
  );
  const requiredNamespaces: Record<string, string> = {};
  for (const prefix of ["bpmndi", "dc", "di"]) {
    const name = `xmlns:${prefix}`;
    if (!originalNamespaces[name] && generatedNamespaces[name]) {
      requiredNamespaces[name] = generatedNamespaces[name];
    }
  }
  patches.push(
    ...xmlAttributePatches(source, original.index.root, requiredNamespaces),
  );
  return { source: applySourcePatches(source, patches), patches };
}

function indentationAt(source: string, position: number): string {
  const lineStart = source.lastIndexOf("\n", position - 1) + 1;
  return /^\s*/u.exec(source.slice(lineStart, position))?.[0] ?? "";
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
}

function namespaceFor(
  source: string,
  index: XmlRangeIndex,
  element: XmlElementRange,
): string | undefined {
  const prefix = element.name.includes(":") ? element.name.split(":")[0] : "";
  let current: XmlElementRange | undefined = element;
  while (current) {
    const namespace = xmlAttribute(
      source,
      current,
      prefix ? `xmlns:${prefix}` : "xmlns",
    );
    if (namespace) return namespace;
    current =
      current.parentIndex === undefined
        ? undefined
        : index.elements[current.parentIndex];
  }
  return;
}

function updateStyleSource(
  source: string,
  elementId: string,
  style: Readonly<{ fill?: string; stroke?: string }>,
): string {
  const read = readBpmnSource(source, { kind: "bpmn" });
  if (!read.valid)
    throw new UnsafeSourcePatchError("The BPMN source is invalid.");
  const presentation = read.index.elements.find(
    (element) =>
      element.localName === "presentation" &&
      namespaceFor(source, read.index, element) === MANATEE_BPMN_NAMESPACE,
  );
  if (!presentation) {
    throw new UnsafeSourcePatchError(
      "The Manatee presentation extension could not be created.",
    );
  }
  const version = xmlAttributeByLocalName(source, presentation, "version");
  if (version !== "1") {
    throw new UnsafeSourcePatchError(
      `Manatee BPMN metadata version ${version ?? "missing"} is not supported.`,
    );
  }
  const entries = read.index.elements.filter(
    (element) =>
      element.parentIndex === presentation.index &&
      element.localName === "element" &&
      namespaceFor(source, read.index, element) === MANATEE_BPMN_NAMESPACE &&
      xmlAttributeByLocalName(source, element, "ref") === elementId,
  );
  if (entries.length > 1) {
    throw new UnsafeSourcePatchError(
      `More than one Manatee style references ${elementId}.`,
    );
  }
  const values: Record<string, string> = {};
  if (style.fill !== undefined) values.fill = style.fill;
  if (style.stroke !== undefined) values.stroke = style.stroke;
  if (entries[0]) {
    return applySourcePatches(
      source,
      xmlAttributePatches(source, entries[0], values),
    );
  }
  const prefix = presentation.name.includes(":")
    ? `${presentation.name.split(":")[0]}:`
    : "manatee:";
  const attributes = Object.entries({ ref: elementId, ...values })
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join("");
  const child = `<${prefix}element${attributes} />`;
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  if (presentation.selfClosing) {
    const tag = source.slice(
      presentation.startTag.start,
      presentation.startTag.end,
    );
    const slash = tag.search(/\/\s*>$/u);
    if (slash < 0)
      throw new UnsafeSourcePatchError("Presentation XML is malformed.");
    const position = presentation.startTag.start + slash;
    const indent = indentationAt(source, presentation.startTag.start);
    return applySourcePatches(source, [
      {
        range: { start: position, end: presentation.startTag.end },
        replacement: `>${newline}${indent}  ${child}${newline}${indent}</${presentation.name}>`,
      },
    ]);
  }
  if (!presentation.endTag) {
    throw new UnsafeSourcePatchError("Presentation XML is not writable.");
  }
  const indent = `${indentationAt(source, presentation.startTag.start)}  `;
  return applySourcePatches(source, [
    {
      range: {
        start: presentation.endTag.start,
        end: presentation.endTag.start,
      },
      replacement: `${newline}${indent}${child}${newline}${indentationAt(source, presentation.startTag.start)}`,
    },
  ]);
}

export function patchBpmnElementStyle(
  source: string,
  elementId: string,
  style: Readonly<{ fill?: string; stroke?: string }>,
): BpmnSourceEdit {
  if (style.fill === undefined && style.stroke === undefined) {
    return { source, patches: [] };
  }
  for (const value of [style.fill, style.stroke]) {
    if (value !== undefined && !/^#[\da-f]{3,8}$/iu.test(value)) {
      throw new UnsafeSourcePatchError(
        "BPMN presentation colours must use CSS hex notation.",
      );
    }
  }
  const withPresentation = patchManateePresentationAttributes(
    source,
    {},
  ).source;
  const updated = updateStyleSource(withPresentation, elementId, style);
  const patch = minimalSourcePatch(source, updated);
  return { source: updated, patches: patch ? [patch] : [] };
}

export function isBpmnDefinitionsNamespace(namespace: string): boolean {
  return namespace === BPMN_MODEL_NAMESPACE;
}
