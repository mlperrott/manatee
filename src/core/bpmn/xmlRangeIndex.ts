import type { DocumentDiagnostic, SourceRange } from "../document/types";

export interface XmlAttributeRange {
  readonly name: string;
  readonly localName: string;
  readonly whole: SourceRange;
  readonly value: SourceRange;
  readonly quote: '"' | "'";
}

export interface XmlElementRange {
  readonly index: number;
  readonly parentIndex: number | undefined;
  readonly name: string;
  readonly localName: string;
  readonly startTag: SourceRange;
  readonly content: SourceRange;
  readonly endTag: SourceRange | undefined;
  readonly whole: SourceRange;
  readonly selfClosing: boolean;
  readonly attributes: readonly XmlAttributeRange[];
}

export interface XmlRangeIndex {
  readonly valid: boolean;
  readonly elements: readonly XmlElementRange[];
  readonly root: XmlElementRange | undefined;
  readonly diagnostics: readonly DocumentDiagnostic[];
}

interface MutableElement {
  index: number;
  parentIndex: number | undefined;
  name: string;
  localName: string;
  startTag: SourceRange;
  content: SourceRange;
  endTag: SourceRange | undefined;
  whole: SourceRange;
  selfClosing: boolean;
  attributes: XmlAttributeRange[];
}

function localName(name: string): string {
  return name.includes(":") ? (name.split(":").at(-1) ?? name) : name;
}

function diagnostic(
  code: string,
  message: string,
  range: SourceRange,
): DocumentDiagnostic {
  return { code, message, severity: "error", range, path: "xml" };
}

function markupEnd(source: string, start: number, doctype = false): number {
  let quote: '"' | "'" | undefined;
  let bracketDepth = 0;
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (doctype && character === "[") bracketDepth += 1;
    if (doctype && character === "]")
      bracketDepth = Math.max(0, bracketDepth - 1);
    if (character === ">" && bracketDepth === 0) return index + 1;
  }
  return -1;
}

function attributesIn(
  source: string,
  tagEnd: number,
  nameEnd: number,
  diagnostics: DocumentDiagnostic[],
): XmlAttributeRange[] {
  const attributes: XmlAttributeRange[] = [];
  const attributeNames = new Set<string>();
  let cursor = nameEnd;
  while (cursor < tagEnd - 1) {
    while (/\s/u.test(source[cursor] ?? "")) cursor += 1;
    if (source[cursor] === "/" || source[cursor] === ">") break;

    const nameMatch = /^[A-Za-z_][\w.:-]*/u.exec(source.slice(cursor));
    if (!nameMatch) {
      diagnostics.push(
        diagnostic("xml.attribute", "An XML attribute name is malformed.", {
          start: cursor,
          end: Math.min(cursor + 1, tagEnd),
        }),
      );
      break;
    }
    const name = nameMatch[0];
    const attributeStart = cursor;
    if (attributeNames.has(name)) {
      diagnostics.push(
        diagnostic("xml.attribute", `Attribute ${name} is duplicated.`, {
          start: attributeStart,
          end: attributeStart + name.length,
        }),
      );
    }
    attributeNames.add(name);
    cursor += name.length;
    while (/\s/u.test(source[cursor] ?? "")) cursor += 1;
    if (source[cursor] !== "=") {
      diagnostics.push(
        diagnostic("xml.attribute", `Attribute ${name} has no value.`, {
          start: attributeStart,
          end: cursor,
        }),
      );
      break;
    }
    cursor += 1;
    while (/\s/u.test(source[cursor] ?? "")) cursor += 1;
    const quote = source[cursor];
    if (quote !== '"' && quote !== "'") {
      diagnostics.push(
        diagnostic("xml.attribute", `Attribute ${name} must use quotes.`, {
          start: attributeStart,
          end: Math.min(cursor + 1, tagEnd),
        }),
      );
      break;
    }
    cursor += 1;
    const valueStart = cursor;
    const valueEnd = source.indexOf(quote, cursor);
    if (valueEnd < 0 || valueEnd >= tagEnd) {
      diagnostics.push(
        diagnostic("xml.attribute", `Attribute ${name} has no closing quote.`, {
          start: attributeStart,
          end: tagEnd,
        }),
      );
      break;
    }
    if (source.slice(valueStart, valueEnd).includes("<")) {
      diagnostics.push(
        diagnostic(
          "xml.attribute",
          `Attribute ${name} contains an unescaped '<'.`,
          {
            start: valueStart,
            end: valueEnd,
          },
        ),
      );
    }
    cursor = valueEnd + 1;
    attributes.push({
      name,
      localName: localName(name),
      whole: { start: attributeStart, end: cursor },
      value: { start: valueStart, end: valueEnd },
      quote,
    });
  }
  return attributes;
}

export function indexXmlSource(source: string): XmlRangeIndex {
  const diagnostics: DocumentDiagnostic[] = [];
  const elements: MutableElement[] = [];
  const stack: number[] = [];
  let cursor = 0;

  while (cursor < source.length) {
    const start = source.indexOf("<", cursor);
    if (start < 0) break;

    if (source.startsWith("<!--", start)) {
      const end = source.indexOf("-->", start + 4);
      if (end < 0) {
        diagnostics.push(
          diagnostic("xml.comment", "An XML comment is not closed.", {
            start,
            end: source.length,
          }),
        );
        break;
      }
      cursor = end + 3;
      continue;
    }
    if (source.startsWith("<![CDATA[", start)) {
      const end = source.indexOf("]]>", start + 9);
      if (end < 0) {
        diagnostics.push(
          diagnostic("xml.cdata", "An XML CDATA section is not closed.", {
            start,
            end: source.length,
          }),
        );
        break;
      }
      cursor = end + 3;
      continue;
    }
    if (source.startsWith("<?", start)) {
      const end = source.indexOf("?>", start + 2);
      if (end < 0) {
        diagnostics.push(
          diagnostic(
            "xml.processing-instruction",
            "An XML instruction is not closed.",
            {
              start,
              end: source.length,
            },
          ),
        );
        break;
      }
      cursor = end + 2;
      continue;
    }
    if (source.startsWith("<!", start)) {
      const end = markupEnd(source, start, true);
      if (end < 0) {
        diagnostics.push(
          diagnostic("xml.declaration", "An XML declaration is not closed.", {
            start,
            end: source.length,
          }),
        );
        break;
      }
      cursor = end;
      continue;
    }

    const end = markupEnd(source, start);
    if (end < 0) {
      diagnostics.push(
        diagnostic("xml.tag", "An XML tag is not closed.", {
          start,
          end: source.length,
        }),
      );
      break;
    }

    if (source.startsWith("</", start)) {
      const match = /^<\/\s*([A-Za-z_][\w.:-]*)\s*>/u.exec(
        source.slice(start, end),
      );
      if (!match) {
        diagnostics.push(
          diagnostic("xml.end-tag", "An XML end tag is malformed.", {
            start,
            end,
          }),
        );
        cursor = end;
        continue;
      }
      const name = match[1] ?? "";
      const elementIndex = stack.pop();
      const element =
        elementIndex === undefined ? undefined : elements[elementIndex];
      if (!element || element.name !== name) {
        diagnostics.push(
          diagnostic("xml.mismatched-tag", `Unexpected closing tag ${name}.`, {
            start,
            end,
          }),
        );
      } else {
        element.endTag = { start, end };
        element.content = { start: element.startTag.end, end: start };
        element.whole = { start: element.startTag.start, end };
      }
      cursor = end;
      continue;
    }

    const match = /^<\s*([A-Za-z_][\w.:-]*)/u.exec(source.slice(start, end));
    if (!match) {
      diagnostics.push(
        diagnostic("xml.start-tag", "An XML start tag is malformed.", {
          start,
          end,
        }),
      );
      cursor = end;
      continue;
    }
    const name = match[1] ?? "";
    const nameEnd = start + (match[0]?.length ?? 0);
    const selfClosing = /\/\s*>$/u.test(source.slice(start, end));
    const index = elements.length;
    if (
      stack.length === 0 &&
      elements.some(({ parentIndex }) => parentIndex === undefined)
    ) {
      diagnostics.push(
        diagnostic(
          "xml.multiple-roots",
          "XML must have exactly one root element.",
          {
            start,
            end,
          },
        ),
      );
    }
    const element: MutableElement = {
      index,
      parentIndex: stack.at(-1),
      name,
      localName: localName(name),
      startTag: { start, end },
      content: { start: end, end },
      endTag: undefined,
      whole: { start, end },
      selfClosing,
      attributes: attributesIn(source, end, nameEnd, diagnostics),
    };
    elements.push(element);
    if (!selfClosing) stack.push(index);
    cursor = end;
  }

  for (const index of stack) {
    const element = elements[index];
    if (element) {
      diagnostics.push(
        diagnostic(
          "xml.unclosed-tag",
          `Element ${element.name} is not closed.`,
          {
            start: element.startTag.start,
            end: element.startTag.end,
          },
        ),
      );
    }
  }

  const frozen = elements.map((element) =>
    Object.freeze({
      ...element,
      attributes: Object.freeze([...element.attributes]),
    }),
  );
  return {
    valid: diagnostics.length === 0,
    elements: Object.freeze(frozen),
    root: frozen.find((element) => element.parentIndex === undefined),
    diagnostics: Object.freeze(diagnostics),
  };
}

export function xmlAttribute(
  source: string,
  element: XmlElementRange,
  name: string,
): string | undefined {
  const attribute = element.attributes.find(
    (candidate) => candidate.name === name,
  );
  return attribute
    ? source.slice(attribute.value.start, attribute.value.end)
    : undefined;
}

export function xmlAttributeByLocalName(
  source: string,
  element: XmlElementRange,
  name: string,
): string | undefined {
  const attribute = element.attributes.find(
    (candidate) => candidate.localName === name,
  );
  return attribute
    ? source.slice(attribute.value.start, attribute.value.end)
    : undefined;
}

export function isDescendantOf(
  index: XmlRangeIndex,
  element: XmlElementRange,
  ancestor: XmlElementRange,
): boolean {
  let parent = element.parentIndex;
  while (parent !== undefined) {
    if (parent === ancestor.index) return true;
    parent = index.elements[parent]?.parentIndex;
  }
  return false;
}
