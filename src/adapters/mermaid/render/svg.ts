import type {
  ComputedNodeStyle,
  LayoutNode,
  MermaidScene,
  Point,
} from "../layout/types";

export interface MermaidSvgOptions {
  readonly selectedElementId?: string;
  readonly outdated?: boolean;
  readonly title?: string;
}

function escapeText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function paint(value: string, fallback: string): string {
  return /^(?:#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([\d.%+, /-]+\)|[a-z]+)$/iu.test(
    value.trim(),
  )
    ? value.trim()
    : fallback;
}

function dash(style: "solid" | "dashed" | "dotted"): string {
  if (style === "dashed") return ' stroke-dasharray="8 5"';
  if (style === "dotted")
    return ' stroke-dasharray="2 5" stroke-linecap="round"';
  return "";
}

function nodeShape(node: LayoutNode, style: ComputedNodeStyle): string {
  const fill = paint(style.fill, "#ffffff");
  const stroke = paint(style.outline.color, "#64748b");
  const attributes = `fill="${fill}" stroke="${stroke}" stroke-width="${style.outline.width}"${dash(style.outline.style)}`;
  const { x, y, width, height } = node;
  const lowerKind = node.kind.toLowerCase();
  if (lowerKind.includes("diamond") || lowerKind.includes("question")) {
    return `<polygon points="${x + width / 2},${y} ${x + width},${y + height / 2} ${x + width / 2},${y + height} ${x},${y + height / 2}" ${attributes}/>`;
  }
  if (lowerKind.includes("circle") || lowerKind.includes("event")) {
    return `<ellipse cx="${x + width / 2}" cy="${y + height / 2}" rx="${width / 2}" ry="${height / 2}" ${attributes}/>`;
  }
  if (lowerKind.includes("hexagon")) {
    const inset = Math.min(18, width / 5);
    return `<polygon points="${x + inset},${y} ${x + width - inset},${y} ${x + width},${y + height / 2} ${x + width - inset},${y + height} ${x + inset},${y + height} ${x},${y + height / 2}" ${attributes}/>`;
  }
  if (lowerKind.includes("lean_right") || lowerKind.includes("parallelogram")) {
    const inset = Math.min(16, width / 5);
    return `<polygon points="${x + inset},${y} ${x + width},${y} ${x + width - inset},${y + height} ${x},${y + height}" ${attributes}/>`;
  }
  if (lowerKind.includes("lean_left")) {
    const inset = Math.min(16, width / 5);
    return `<polygon points="${x},${y} ${x + width - inset},${y} ${x + width},${y + height} ${x + inset},${y + height}" ${attributes}/>`;
  }
  if (lowerKind.includes("inv_trapezoid")) {
    const inset = Math.min(16, width / 5);
    return `<polygon points="${x},${y} ${x + width},${y} ${x + width - inset},${y + height} ${x + inset},${y + height}" ${attributes}/>`;
  }
  if (lowerKind.includes("trapezoid")) {
    const inset = Math.min(16, width / 5);
    return `<polygon points="${x + inset},${y} ${x + width - inset},${y} ${x + width},${y + height} ${x},${y + height}" ${attributes}/>`;
  }
  if (lowerKind.includes("asymmetric")) {
    const inset = Math.min(18, width / 5);
    return `<polygon points="${x},${y} ${x + width},${y} ${x + width - inset},${y + height / 2} ${x + width},${y + height} ${x},${y + height}" ${attributes}/>`;
  }
  if (lowerKind.includes("database") || lowerKind.endsWith("_db")) {
    const radius = Math.min(12, height / 5);
    return `<path d="M ${x} ${y + radius} A ${width / 2} ${radius} 0 0 1 ${x + width} ${y + radius} V ${y + height - radius} A ${width / 2} ${radius} 0 0 1 ${x} ${y + height - radius} Z M ${x} ${y + radius} A ${width / 2} ${radius} 0 0 0 ${x + width} ${y + radius}" ${attributes}/>`;
  }
  if (lowerKind.includes("subroutine")) {
    const inset = Math.min(10, width / 8);
    return `<g><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="3" ${attributes}/><path d="M ${x + inset} ${y} V ${y + height} M ${x + width - inset} ${y} V ${y + height}" fill="none" stroke="${stroke}" stroke-width="${style.outline.width}"/></g>`;
  }
  const radius =
    lowerKind.includes("round") ||
    lowerKind.includes("stadium") ||
    lowerKind.includes("person") ||
    lowerKind.includes("system") ||
    lowerKind.includes("container")
      ? lowerKind.includes("stadium")
        ? height / 2
        : 12
      : 3;
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" ${attributes}/>`;
}

interface TextRun {
  readonly text: string;
  readonly bold: boolean;
  readonly italic: boolean;
}

function textRuns(value: string): TextRun[] {
  const normalized = value
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<\/?b>/giu, "**")
    .replace(/<\/?(?:i|em)>/giu, "_");
  const result: TextRun[] = [];
  let cursor = 0;
  const token = /\*\*([^*]+)\*\*|_([^_]+)_/gu;
  for (const match of normalized.matchAll(token)) {
    const index = match.index;
    if (index > cursor)
      result.push({
        text: normalized.slice(cursor, index),
        bold: false,
        italic: false,
      });
    result.push({
      text: match[1] ?? match[2] ?? "",
      bold: match[1] !== undefined,
      italic: match[2] !== undefined,
    });
    cursor = index + match[0].length;
  }
  if (cursor < normalized.length) {
    result.push({
      text: normalized.slice(cursor),
      bold: false,
      italic: false,
    });
  }
  return result.length > 0
    ? result
    : [{ text: "", bold: false, italic: false }];
}

function label(
  value: string,
  center: Point,
  style: ComputedNodeStyle["text"],
  className: string,
): string {
  const lines: TextRun[][] = [[]];
  for (const run of textRuns(value)) {
    const parts = run.text.split("\n");
    parts.forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (part) lines.at(-1)?.push({ ...run, text: part });
    });
  }
  const firstY = center.y - ((lines.length - 1) * style.size * 1.25) / 2;
  const tspans = lines
    .map(
      (line, lineIndex) =>
        `<tspan x="${center.x}" y="${firstY + lineIndex * style.size * 1.25}">${line
          .map(
            (run) =>
              `<tspan${run.bold ? ' font-weight="700"' : ""}${run.italic ? ' font-style="italic"' : ""}>${escapeText(run.text)}</tspan>`,
          )
          .join("")}</tspan>`,
    )
    .join("");
  return `<text class="${className}" text-anchor="middle" dominant-baseline="middle" fill="${paint(style.color, "#172033")}" font-size="${style.size}" font-weight="${style.weight}"${style.italic ? ' font-style="italic"' : ""}>${tspans}</text>`;
}

function path(points: readonly Point[]): string {
  return points
    .map(({ x, y }, index) => `${index === 0 ? "M" : "L"} ${x} ${y}`)
    .join(" ");
}

function midpoint(points: readonly Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  const index = Math.max(0, Math.floor((points.length - 1) / 2));
  const left = points[index] ?? points[0]!;
  const right = points[index + 1] ?? left;
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 - 8 };
}

export function renderMermaidSvg(
  scene: MermaidScene,
  options: MermaidSvgOptions = {},
): string {
  const selection = options.selectedElementId;
  const groups = scene.groups
    .map((group) => {
      const selected = group.id === selection ? " selected" : "";
      const fill = paint(group.style.fill, "#f1f5f9");
      const stroke = paint(group.style.outline.color, "#94a3b8");
      return `<g class="group${selected}" data-element-id="${escapeAttribute(group.id)}"><rect x="${group.x}" y="${group.y}" width="${group.width}" height="${group.height}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="${group.style.outline.width}"${dash(group.style.outline.style)}/>${label(group.label, { x: group.x + group.width / 2, y: group.y + 18 }, group.style.text, "group-label")}</g>`;
    })
    .join("");
  const relationships = scene.relationships
    .map((relationship, index) => {
      const selected = relationship.id === selection ? " selected" : "";
      const color = paint(relationship.style.color, "#64748b");
      const markerId = `arrow-${index}`;
      const open =
        relationship.kind.includes("open") ||
        relationship.kind === "arrow_open";
      const marker = relationship.kind.includes("circle")
        ? `<circle cx="5" cy="5" r="3.5" fill="none" stroke="${color}" stroke-width="1.5"/>`
        : relationship.kind.includes("cross")
          ? `<path d="M 2 2 L 8 8 M 8 2 L 2 8" fill="none" stroke="${color}" stroke-width="1.75"/>`
          : `<path d="M 0 0 L 10 5 L 0 10 z" fill="${open ? "none" : color}" stroke="${color}"/>`;
      const startMarker = relationship.kind.includes("double")
        ? ` marker-start="url(#${markerId})"`
        : "";
      return `<g class="relationship${selected}" data-element-id="${escapeAttribute(relationship.id)}"><defs><marker id="${markerId}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">${marker}</marker></defs><path d="${path(relationship.points)}" fill="none" stroke="${color}" stroke-width="${relationship.style.width}"${dash(relationship.style.style)}${startMarker} marker-end="url(#${markerId})"/>${relationship.label ? label(relationship.label, midpoint(relationship.points), relationship.style.text, "relationship-label") : ""}</g>`;
    })
    .join("");
  const nodes = scene.nodes
    .map((node) => {
      const selected = node.id === selection ? " selected" : "";
      return `<g class="node${selected}" data-element-id="${escapeAttribute(node.id)}">${nodeShape(node, node.style)}${label(node.label, { x: node.x + node.width / 2, y: node.y + node.height / 2 }, node.style.text, "node-label")}</g>`;
    })
    .join("");
  const outdated = options.outdated
    ? `<g class="outdated"><rect x="12" y="12" width="142" height="30" rx="15"/><text x="83" y="32" text-anchor="middle">Preview out of date</text></g>`
    : "";
  const title = options.title
    ? `<title>${escapeText(options.title)}</title>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${scene.width} ${scene.height}" width="${scene.width}" height="${scene.height}" role="img" data-manatee-renderer="mermaid"${options.outdated ? ' data-outdated="true"' : ""}>${title}<style>text{font-family:Inter,ui-sans-serif,system-ui,sans-serif}.selected>rect,.selected>ellipse,.selected>polygon,.selected>path{filter:drop-shadow(0 0 3px #2563eb);stroke:#2563eb!important}.outdated rect{fill:#fff7ed;stroke:#f97316}.outdated text{font-size:12px;fill:#9a3412}</style>${groups}${relationships}${nodes}${outdated}</svg>`;
}

export const renderMermaidPreviewSvg = renderMermaidSvg;
export const renderMermaidExportSvg = renderMermaidSvg;
