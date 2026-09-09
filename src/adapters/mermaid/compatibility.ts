import type {
  DocumentDiagnostic,
  SourceRange,
} from "../../core/document/types";
import { findFrontMatter } from "../../core/metadata/frontMatter";
import { parseDocument, type Node } from "yaml";
import type { MermaidFamily } from "./model";

interface CompatibilityResult {
  readonly family: MermaidFamily | undefined;
  readonly diagnostics: readonly DocumentDiagnostic[];
  readonly unsupported: boolean;
}

interface DeferredPattern {
  readonly code: string;
  readonly message: string;
  readonly pattern: RegExp;
}

const deferredPatterns: readonly DeferredPattern[] = [
  {
    code: "mermaid.unsupported.icon",
    message: "Icon nodes are not supported in this release.",
    pattern: /@\{[^}]*\bicon\s*:/giu,
  },
  {
    code: "mermaid.unsupported.image",
    message:
      "Image nodes and embedded images are not supported in this release.",
    pattern: /@\{[^}]*\b(?:img|image)\s*:/giu,
  },
  {
    code: "mermaid.unsupported.animation",
    message: "Animated relationships are not supported in this release.",
    pattern: /@\{[^}]*\b(?:animate|animation)\s*:/giu,
  },
  {
    code: "mermaid.unsupported.collapsed",
    message:
      "Collapsed or expandable subgraphs are not supported in this release.",
    pattern: /@\{[^}]*\bview\s*:\s*["']?collapsed\b/giu,
  },
  {
    code: "mermaid.unsupported.click",
    message: "Clickable links and callbacks are not supported in this release.",
    pattern: /^\s*click\s+\S+/gimu,
  },
  {
    code: "mermaid.unsupported.extended-shape",
    message: "Extended flowchart shapes are not supported in this release.",
    pattern: /@\{[^}]*\bshape\s*:/giu,
  },
  {
    code: "mermaid.unsupported.c4-component",
    message: "C4 component and deployment constructs are outside this release.",
    pattern: /^\s*(?:Component\w*|Deployment_Node)\s*\(/gimu,
  },
];

function semanticStart(source: string): number {
  const frontMatter = findFrontMatter(source);
  return frontMatter.kind === "present" ? frontMatter.block.closing.end : 0;
}

function familyFromHeader(source: string): MermaidFamily | undefined {
  const semantic = source.slice(semanticStart(source));
  const header = /^\s*(?:%%[^\n\r]*(?:\r?\n|$)\s*)*(\S+)/mu.exec(semantic)?.[1];
  if (!header) return;
  const normalized = header.toLowerCase();
  if (normalized === "flowchart" || normalized === "graph") return "flowchart";
  if (normalized === "swimlane-beta" || normalized === "swimlane") {
    return "swimlane";
  }
  if (normalized === "c4context") return "c4-context";
  if (normalized === "c4container") return "c4-container";
  return;
}

function rangeForMatch(match: RegExpExecArray, offset = 0): SourceRange {
  return {
    start: offset + match.index,
    end: offset + match.index + match[0].length,
  };
}

function diagnosticForMatches(
  source: string,
  deferred: DeferredPattern,
  offset: number,
): DocumentDiagnostic[] {
  const diagnostics: DocumentDiagnostic[] = [];
  const pattern = new RegExp(deferred.pattern.source, deferred.pattern.flags);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    diagnostics.push({
      code: deferred.code,
      message: deferred.message,
      severity: "error",
      range: rangeForMatch(match, offset),
      path: "semantic",
    });
  }
  return diagnostics;
}

function htmlDiagnostics(source: string, offset: number): DocumentDiagnostic[] {
  const diagnostics: DocumentDiagnostic[] = [];
  for (const match of source.matchAll(/<\/?([A-Za-z][\w-]*)\b[^>]*>/gu)) {
    const tag = match[1]?.toLowerCase();
    if (tag === "br") continue;
    diagnostics.push({
      code: "mermaid.unsupported.html",
      message: `HTML <${tag ?? "element"}> labels are not supported in this release.`,
      severity: "error",
      range: rangeForMatch(match, offset),
      path: "semantic.label",
    });
  }
  return diagnostics;
}

function rendererSettingDiagnostics(
  source: string,
  offset: number,
): DocumentDiagnostic[] {
  const diagnostics: DocumentDiagnostic[] = [];
  for (const match of source.matchAll(
    /(?:defaultRenderer|curve|nodeSpacing|rankSpacing|useMaxWidth|constraint)\s*:/giu,
  )) {
    diagnostics.push({
      code: "mermaid.presentation.unhonoured",
      message: `The Mermaid setting ${match[0].replace(/\s*:/u, "")} is preserved but is not applied by Manatee.`,
      severity: "warning",
      range: rangeForMatch(match, offset),
      path: "presentation.mermaid",
    });
  }
  return diagnostics;
}

function rendererDirectiveDiagnostics(source: string): DocumentDiagnostic[] {
  const diagnostics: DocumentDiagnostic[] = [];
  const frontMatter = findFrontMatter(source);
  if (frontMatter.kind === "present") {
    const content = source.slice(
      frontMatter.block.content.start,
      frontMatter.block.content.end,
    );
    const yaml = parseDocument(content, { keepSourceTokens: true });
    const config = yaml.get("config", true) as Node | undefined;
    const range = config && "range" in config ? config.range : undefined;
    if (range) {
      const start = range[0] ?? 0;
      const end = range[2] ?? range[1] ?? start;
      diagnostics.push(
        ...rendererSettingDiagnostics(
          content.slice(start, end),
          frontMatter.block.content.start + start,
        ),
      );
    }
  }
  for (const directive of source.matchAll(
    /%%\{(?:init|config):[\s\S]*?\}%%/giu,
  )) {
    diagnostics.push(
      ...rendererSettingDiagnostics(directive[0], directive.index),
    );
  }
  for (const match of source.matchAll(/^\s*UpdateLayoutConfig\s*\(/gimu)) {
    diagnostics.push({
      code: "mermaid.presentation.unhonoured",
      message:
        "The C4 renderer layout configuration is preserved but is not applied by Manatee.",
      severity: "warning",
      range: rangeForMatch(match),
      path: "presentation.mermaid",
    });
  }
  return diagnostics;
}

export function inspectMermaidCompatibility(
  source: string,
): CompatibilityResult {
  const family = familyFromHeader(source);
  const start = semanticStart(source);
  const semantic = source.slice(start);
  const diagnostics = [
    ...deferredPatterns.flatMap((pattern) =>
      diagnosticForMatches(semantic, pattern, start),
    ),
    ...htmlDiagnostics(semantic, start),
    ...rendererDirectiveDiagnostics(source),
  ];
  if (!family) {
    diagnostics.push({
      code: "mermaid.unsupported.family",
      message:
        "This release supports flowcharts, native swimlanes, C4 context, and C4 container diagrams.",
      severity: "error",
      range: { start, end: Math.min(source.length, start + 32) },
      path: "semantic.family",
    });
  }
  return {
    family,
    diagnostics,
    unsupported: diagnostics.some(({ severity }) => severity === "error"),
  };
}

export function mermaidFamily(source: string): MermaidFamily | undefined {
  return familyFromHeader(source);
}
