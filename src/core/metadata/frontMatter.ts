import type { DocumentDiagnostic, SourceRange } from "../document/types";

export interface FrontMatterBlock {
  readonly opening: SourceRange;
  readonly content: SourceRange;
  readonly closing: SourceRange;
  readonly newline: "\n" | "\r\n";
}

export type FrontMatterResult =
  | { readonly kind: "absent" }
  | { readonly kind: "present"; readonly block: FrontMatterBlock }
  | {
      readonly kind: "malformed";
      readonly diagnostic: DocumentDiagnostic;
    };

interface Line {
  readonly start: number;
  readonly contentEnd: number;
  readonly end: number;
  readonly newline: "\n" | "\r\n" | "";
}

function lineAt(source: string, start: number): Line {
  const lineFeed = source.indexOf("\n", start);
  if (lineFeed < 0) {
    return {
      start,
      contentEnd: source.length,
      end: source.length,
      newline: "",
    };
  }

  const hasCarriageReturn = lineFeed > start && source[lineFeed - 1] === "\r";
  return {
    start,
    contentEnd: hasCarriageReturn ? lineFeed - 1 : lineFeed,
    end: lineFeed + 1,
    newline: hasCarriageReturn ? "\r\n" : "\n",
  };
}

function lineContent(source: string, line: Line): string {
  return source.slice(line.start, line.contentEnd);
}

export function findFrontMatter(source: string): FrontMatterResult {
  const bomLength = source.startsWith("\uFEFF") ? 1 : 0;
  const first = lineAt(source, bomLength);
  if (lineContent(source, first).trim() !== "---") return { kind: "absent" };

  const newline = first.newline || "\n";
  let cursor = first.end;
  while (cursor < source.length) {
    const line = lineAt(source, cursor);
    if (lineContent(source, line).trim() === "---") {
      return {
        kind: "present",
        block: {
          opening: { start: bomLength, end: first.end },
          content: { start: first.end, end: line.start },
          closing: { start: line.start, end: line.end },
          newline,
        },
      };
    }
    cursor = line.end;
  }

  return {
    kind: "malformed",
    diagnostic: {
      code: "frontmatter.unclosed",
      message: "The Mermaid front matter has no closing delimiter.",
      severity: "error",
      range: { start: bomLength, end: first.end },
      path: "frontmatter",
    },
  };
}
