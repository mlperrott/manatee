import type {
  DocumentDiagnostic,
  DocumentHint,
  SourcePatch,
} from "../document/types";
import { applySourcePatches, UnsafeSourcePatchError } from "../source/patches";
import {
  indexXmlSource,
  isDescendantOf,
  type XmlElementRange,
  type XmlRangeIndex,
  xmlAttribute,
  xmlAttributeByLocalName,
} from "./xmlRangeIndex";

export const BPMN_MODEL_NAMESPACE =
  "http://www.omg.org/spec/BPMN/20100524/MODEL";
export const MANATEE_BPMN_NAMESPACE =
  "https://mlperrott.github.io/manatee/bpmn";

export interface BpmnSourceRead {
  readonly kind: "bpmn" | "unknown";
  readonly valid: boolean;
  readonly index: XmlRangeIndex;
  readonly diagnostics: readonly DocumentDiagnostic[];
}

export interface BpmnSourcePatch extends BpmnSourceRead {
  readonly source: string;
  readonly patches: readonly SourcePatch[];
}

export interface BpmnBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function rootDeclaresBpmn(source: string, root: XmlElementRange): boolean {
  const prefix = root.name.includes(":") ? root.name.split(":")[0] : undefined;
  const namespaceName = prefix ? `xmlns:${prefix}` : "xmlns";
  return xmlAttribute(source, root, namespaceName) === BPMN_MODEL_NAMESPACE;
}

export function readBpmnSource(
  source: string,
  hint?: DocumentHint,
): BpmnSourceRead {
  const index = indexXmlSource(source);
  const hinted =
    hint?.kind === "bpmn" || hint?.filename?.toLowerCase().endsWith(".bpmn");
  const contentMatches =
    index.root?.localName === "definitions" &&
    rootDeclaresBpmn(source, index.root);
  const kind = hinted || contentMatches ? "bpmn" : "unknown";
  const diagnostics = [...index.diagnostics];
  if (kind === "bpmn" && !contentMatches && index.valid) {
    diagnostics.push({
      code: "bpmn.definitions",
      message: "The document does not have a BPMN 2.0 definitions root.",
      severity: "error",
      ...(index.root ? { range: index.root.startTag } : {}),
      path: "xml.definitions",
    });
  }
  return {
    kind,
    valid: kind === "bpmn" && index.valid && contentMatches,
    index,
    diagnostics,
  };
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll("\r", "&#13;")
    .replaceAll("\n", "&#10;");
}

export function xmlAttributePatches(
  source: string,
  element: XmlElementRange,
  values: Readonly<Record<string, string | number>>,
): SourcePatch[] {
  const patches: SourcePatch[] = [];
  const missing: [string, string][] = [];
  for (const [name, rawValue] of Object.entries(values)) {
    const value = escapeAttribute(String(rawValue));
    const attribute = element.attributes.find(
      (candidate) => candidate.name === name,
    );
    if (attribute) patches.push({ range: attribute.value, replacement: value });
    else missing.push([name, value]);
  }

  if (missing.length > 0) {
    const tag = source.slice(element.startTag.start, element.startTag.end);
    const slashOffset = tag.search(/\/\s*>$/u);
    const insertAt =
      slashOffset >= 0
        ? element.startTag.start + slashOffset
        : element.startTag.end - 1;
    patches.push({
      range: { start: insertAt, end: insertAt },
      replacement: missing
        .map(([name, value]) => ` ${name}="${value}"`)
        .join(""),
    });
  }
  return patches;
}

function uniqueElement(
  elements: readonly XmlElementRange[],
  description: string,
): XmlElementRange {
  if (elements.length !== 1) {
    throw new UnsafeSourcePatchError(
      `Expected one ${description}, found ${elements.length}.`,
    );
  }
  return elements[0] as XmlElementRange;
}

function indexedBpmn(source: string): XmlRangeIndex {
  const read = readBpmnSource(source, { kind: "bpmn" });
  if (!read.valid) {
    throw new UnsafeSourcePatchError(
      read.diagnostics[0]?.message ?? "The BPMN XML is not valid.",
    );
  }
  return read.index;
}

export function patchBpmnShapeBounds(
  source: string,
  bpmnElement: string,
  bounds: BpmnBounds,
): BpmnSourcePatch {
  const index = indexedBpmn(source);
  const shape = uniqueElement(
    index.elements.filter(
      (element) =>
        element.localName === "BPMNShape" &&
        xmlAttributeByLocalName(source, element, "bpmnElement") === bpmnElement,
    ),
    `BPMNShape for ${bpmnElement}`,
  );
  const boundsElement = uniqueElement(
    index.elements.filter(
      (element) =>
        element.localName === "Bounds" && isDescendantOf(index, element, shape),
    ),
    `Bounds for ${bpmnElement}`,
  );
  const patches = xmlAttributePatches(source, boundsElement, {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  });
  const updated = applySourcePatches(source, patches);
  return {
    ...readBpmnSource(updated, { kind: "bpmn" }),
    source: updated,
    patches,
  };
}

function indentationAt(source: string, position: number): string {
  const lineStart = source.lastIndexOf("\n", position - 1) + 1;
  return /^\s*/u.exec(source.slice(lineStart, position))?.[0] ?? "";
}

export function patchBpmnEdgeWaypoints(
  source: string,
  bpmnElement: string,
  waypoints: readonly { readonly x: number; readonly y: number }[],
): BpmnSourcePatch {
  if (waypoints.length < 2) {
    throw new UnsafeSourcePatchError(
      "A BPMN edge needs at least two waypoints.",
    );
  }
  const index = indexedBpmn(source);
  const edge = uniqueElement(
    index.elements.filter(
      (element) =>
        element.localName === "BPMNEdge" &&
        xmlAttributeByLocalName(source, element, "bpmnElement") === bpmnElement,
    ),
    `BPMNEdge for ${bpmnElement}`,
  );
  if (!edge.endTag) {
    throw new UnsafeSourcePatchError("The BPMN edge cannot contain waypoints.");
  }
  const existing = index.elements.filter(
    (element) =>
      element.localName === "waypoint" && element.parentIndex === edge.index,
  );
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const childIndent = existing[0]
    ? indentationAt(source, existing[0].startTag.start)
    : `${indentationAt(source, edge.startTag.start)}  `;
  const prefix = existing[0]?.name.includes(":")
    ? `${existing[0].name.split(":")[0]}:`
    : "di:";
  const patches: SourcePatch[] = [];
  if (existing.length === waypoints.length) {
    for (const [waypointIndex, element] of existing.entries()) {
      const waypoint = waypoints[waypointIndex];
      if (!waypoint) continue;
      patches.push(
        ...xmlAttributePatches(source, element, {
          x: waypoint.x,
          y: waypoint.y,
        }),
      );
    }
  } else if (existing.length > 0) {
    const unexpectedAttribute = existing.some((element) =>
      element.attributes.some(
        ({ localName }) => localName !== "x" && localName !== "y",
      ),
    );
    const hasInterleavedContent = existing.slice(1).some((element, index) => {
      const previous = existing[index];
      return (
        previous !== undefined &&
        source.slice(previous.whole.end, element.whole.start).trim().length > 0
      );
    });
    if (unexpectedAttribute || hasInterleavedContent) {
      throw new UnsafeSourcePatchError(
        "Changing the waypoint count would discard unknown BPMN DI content.",
      );
    }
    const replacement = waypoints
      .map(
        ({ x, y }, waypointIndex) =>
          `${waypointIndex === 0 ? "" : childIndent}<${prefix}waypoint x="${x}" y="${y}" />`,
      )
      .join(newline);
    patches.push({
      range: {
        start: existing[0]?.whole.start ?? edge.content.start,
        end: existing.at(-1)?.whole.end ?? edge.content.start,
      },
      replacement,
    });
  } else {
    const replacement = waypoints
      .map(
        ({ x, y }) => `${childIndent}<${prefix}waypoint x="${x}" y="${y}" />`,
      )
      .join(newline);
    patches.push({
      range: { start: edge.endTag.start, end: edge.endTag.start },
      replacement: `${newline}${replacement}${newline}${indentationAt(source, edge.startTag.start)}`,
    });
  }
  const updated = applySourcePatches(source, patches);
  return {
    ...readBpmnSource(updated, { kind: "bpmn" }),
    source: updated,
    patches,
  };
}

function namespaceFor(
  source: string,
  index: XmlRangeIndex,
  element: XmlElementRange,
): string | undefined {
  const prefix = element.name.includes(":") ? element.name.split(":")[0] : "";
  const attributeName = prefix ? `xmlns:${prefix}` : "xmlns";
  let current: XmlElementRange | undefined = element;
  while (current) {
    const namespace = xmlAttribute(source, current, attributeName);
    if (namespace) return namespace;
    current =
      current.parentIndex === undefined
        ? undefined
        : index.elements[current.parentIndex];
  }
  return;
}

export function patchManateePresentationAttributes(
  source: string,
  values: Readonly<Record<string, string | number>>,
): BpmnSourcePatch {
  const index = indexedBpmn(source);
  const presentations = index.elements.filter(
    (element) =>
      element.localName === "presentation" &&
      namespaceFor(source, index, element) === MANATEE_BPMN_NAMESPACE,
  );
  let patches: SourcePatch[];
  if (presentations.length === 1) {
    const presentation = presentations[0] as XmlElementRange;
    const version = xmlAttributeByLocalName(source, presentation, "version");
    if (version !== "1") {
      throw new UnsafeSourcePatchError(
        `Manatee BPMN metadata version ${version ?? "missing"} is not supported.`,
      );
    }
    patches = xmlAttributePatches(source, presentation, values);
  } else if (presentations.length > 1) {
    throw new UnsafeSourcePatchError(
      "The BPMN document has more than one Manatee presentation element.",
    );
  } else {
    const root = index.root as XmlElementRange;
    if (!root.endTag) {
      throw new UnsafeSourcePatchError(
        "The BPMN definitions element is not writable.",
      );
    }
    const extension = index.elements.find(
      (element) =>
        element.parentIndex === root.index &&
        element.localName === "extensionElements" &&
        namespaceFor(source, index, element) === BPMN_MODEL_NAMESPACE,
    );
    const newline = source.includes("\r\n") ? "\r\n" : "\n";
    const attributes = Object.entries({ version: 1, ...values })
      .map(([name, value]) => ` ${name}="${escapeAttribute(String(value))}"`)
      .join("");
    if (extension?.endTag) {
      const indent = `${indentationAt(source, extension.startTag.start)}  `;
      patches = [
        {
          range: { start: extension.endTag.start, end: extension.endTag.start },
          replacement: `${newline}${indent}<manatee:presentation xmlns:manatee="${MANATEE_BPMN_NAMESPACE}"${attributes} />${newline}${indentationAt(source, extension.startTag.start)}`,
        },
      ];
    } else {
      const rootPrefix = root.name.includes(":")
        ? `${root.name.split(":")[0]}:`
        : "";
      const rootIndent = indentationAt(source, root.startTag.start);
      const extensionIndent = `${rootIndent}  `;
      const presentationIndent = `${extensionIndent}  `;
      patches = [
        {
          range: { start: root.startTag.end, end: root.startTag.end },
          replacement:
            `${newline}${extensionIndent}<${rootPrefix}extensionElements>` +
            `${newline}${presentationIndent}<manatee:presentation xmlns:manatee="${MANATEE_BPMN_NAMESPACE}"${attributes} />` +
            `${newline}${extensionIndent}</${rootPrefix}extensionElements>` +
            `${newline}${rootIndent}`,
        },
      ];
    }
  }
  const updated = applySourcePatches(source, patches);
  return {
    ...readBpmnSource(updated, { kind: "bpmn" }),
    source: updated,
    patches,
  };
}
