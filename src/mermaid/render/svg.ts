import { hasExternalLabel, nodeLabelBounds } from "../layout/labels";
import { PROCESS_CONTAINER_HEADER } from "../layout/geometry";
import type {
  Bounds,
  ComputedNodeStyle,
  LayoutNode,
  MermaidScene,
  Point,
} from "../layout/types";

export interface MermaidSvgOptions {
  readonly selectedElementId?: string;
  readonly outdated?: boolean;
  readonly title?: string;
  readonly interactive?: boolean;
  readonly quickAdd?: boolean;
  readonly interactionScale?: number;
  readonly viewport?: Bounds;
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
  const attributes = `fill="${fill}" stroke="${stroke}" stroke-width="${style.outline.width}"${node.notation ? "" : dash(style.outline.style)}`;
  const { x, y, width, height } = node;
  const cx = x + width / 2;
  const cy = y + height / 2;
  if (node.notation === "start-event") {
    const radius = Math.min(width, height) / 2;
    return `<circle cx="${cx}" cy="${cy}" r="${radius}" ${attributes}/>`;
  }
  if (node.notation === "end-event") {
    const radius = Math.min(width, height) / 2;
    return `<g><circle cx="${cx}" cy="${cy}" r="${radius}" ${attributes}/><circle cx="${cx}" cy="${cy}" r="${Math.max(2, radius - 4)}" fill="none" stroke="${stroke}" stroke-width="2.5"/></g>`;
  }
  if (node.notation === "timer-event" || node.notation === "boundary-timer") {
    const radius = Math.min(width, height) / 2;
    return `<g><circle cx="${cx}" cy="${cy}" r="${radius}" ${attributes}/><circle cx="${cx}" cy="${cy}" r="${Math.max(3, radius - 4)}" fill="none" stroke="${stroke}"/><path d="M ${cx} ${cy - radius + 8} V ${cy + radius - 8} M ${cx - radius + 8} ${cy} H ${cx + radius - 8} M ${cx} ${cy} L ${cx + radius * 0.42} ${cy - radius * 0.3}" fill="none" stroke="${stroke}" stroke-width="1.5"/></g>`;
  }
  if (
    node.notation === "exclusive-gateway" ||
    node.notation === "parallel-gateway"
  ) {
    const marker =
      node.notation === "exclusive-gateway"
        ? `<path d="M ${cx - 10} ${cy - 10} L ${cx + 10} ${cy + 10} M ${cx + 10} ${cy - 10} L ${cx - 10} ${cy + 10}"/>`
        : `<path d="M ${cx} ${cy - 13} V ${cy + 13} M ${cx - 13} ${cy} H ${cx + 13}"/>`;
    return `<g><polygon points="${cx},${y} ${x + width},${cy} ${cx},${y + height} ${x},${cy}" ${attributes}/><g fill="none" stroke="${stroke}" stroke-width="2.5">${marker}</g></g>`;
  }
  if (node.notation === "collapsed-subprocess") {
    return `<g><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="10" ${attributes}/><rect x="${cx - 7}" y="${y + height - 17}" width="14" height="14" fill="${fill}" stroke="${stroke}"/><path d="M ${cx} ${y + height - 14} V ${y + height - 6} M ${cx - 4} ${y + height - 10} H ${cx + 4}" stroke="${stroke}"/></g>`;
  }
  if (node.notation === "task") {
    return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="10" ${attributes}/>`;
  }
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
  maxWidth = Infinity,
): string {
  const lines: TextRun[][] = [[]];
  const maxCharacters = Math.max(8, Math.floor(maxWidth / (style.size * 0.56)));
  let lineLength = 0;
  for (const run of textRuns(value)) {
    const parts = run.text.split("\n");
    parts.forEach((part, index) => {
      if (index > 0) {
        lines.push([]);
        lineLength = 0;
      }
      for (const token of part.split(/(\s+)/u).filter(Boolean)) {
        if (!token.trim() && lineLength === 0) continue;
        if (
          token.trim() &&
          lineLength > 0 &&
          lineLength + token.length > maxCharacters
        ) {
          const last = lines.at(-1)!.at(-1);
          if (last)
            lines.at(-1)![lines.at(-1)!.length - 1] = {
              ...last,
              text: last.text.trimEnd(),
            };
          lines.push([]);
          lineLength = 0;
        }
        lines.at(-1)!.push({ ...run, text: token });
        lineLength += token.length;
      }
    });
  }
  const firstY =
    center.y + style.size * 0.35 - ((lines.length - 1) * style.size * 1.25) / 2;
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
  return `<text class="${className}" text-anchor="middle" fill="${paint(style.color, "#172033")}" font-size="${style.size}" font-weight="${style.weight}"${style.italic ? ' font-style="italic"' : ""}>${tspans}</text>`;
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
  const groupById = new Map(scene.groups.map((group) => [group.id, group]));
  const depth = (id: string): number => {
    let parent = groupById.get(id)?.parentId;
    const visited = new Set([id]);
    while (parent && !visited.has(parent)) {
      visited.add(parent);
      parent = groupById.get(parent)?.parentId;
    }
    return visited.size;
  };
  const groups = [...scene.groups]
    .sort((a, b) => depth(a.id) - depth(b.id))
    .map((group) => {
      const selected = group.id === selection ? " selected" : "";
      const fill = paint(group.style.fill, "#f1f5f9");
      const stroke = paint(group.style.outline.color, "#94a3b8");
      const processContainer =
        group.notation === "pool" || group.notation === "lane";
      const header = processContainer
        ? `<path d="M ${group.x + PROCESS_CONTAINER_HEADER} ${group.y} V ${group.y + group.height}" fill="none" stroke="${stroke}" stroke-width="${group.style.outline.width}"/><g transform="translate(${group.x + PROCESS_CONTAINER_HEADER / 2} ${group.y + group.height / 2}) rotate(-90)">${label(group.label, { x: 0, y: 0 }, group.style.text, "group-label")}</g>`
        : label(
            group.label,
            { x: group.x + group.width / 2, y: group.y + 18 },
            group.style.text,
            "group-label",
          );
      return `<g class="group${selected}" data-element-id="${escapeAttribute(group.id)}"${group.notation ? ` data-notation="${group.notation}"` : ""}><rect x="${group.x}" y="${group.y}" width="${group.width}" height="${group.height}" rx="${processContainer ? 2 : 8}" fill="${fill}" stroke="${stroke}" stroke-width="${group.style.outline.width}"${dash(group.style.outline.style)}/>${header}</g>`;
    })
    .join("");
  const relationships = scene.relationships
    .map((relationship, index) => {
      const selected = relationship.id === selection ? " selected" : "";
      const color = paint(relationship.style.color, "#64748b");
      const markerId = `arrow-${index}`;
      const messageFlow = relationship.notation === "message-flow";
      const sequenceFlow = relationship.notation === "sequence-flow";
      const open =
        !sequenceFlow &&
        (messageFlow ||
          relationship.kind.includes("open") ||
          relationship.kind === "arrow_open");
      const marker =
        !relationship.notation && relationship.kind.includes("circle")
          ? `<circle cx="5" cy="5" r="3.5" fill="none" stroke="${color}" stroke-width="1.5"/>`
          : !relationship.notation && relationship.kind.includes("cross")
            ? `<path d="M 2 2 L 8 8 M 8 2 L 2 8" fill="none" stroke="${color}" stroke-width="1.75"/>`
            : `<path d="M 0 0 L 10 5 L 0 10 z" fill="${open ? "none" : color}" stroke="${color}"/>`;
      const startMarker =
        !relationship.notation &&
        (relationship.kind.includes("double") ||
          relationship.kind === "birel" ||
          relationship.kind === "rel_b")
          ? ` marker-start="url(#${markerId})"`
          : "";
      const endMarker =
        !relationship.notation &&
        (relationship.kind === "arrow_open" || relationship.kind === "rel_b")
          ? ""
          : ` marker-end="url(#${markerId})"`;
      const lineDash = messageFlow
        ? ' stroke-dasharray="7 5"'
        : sequenceFlow
          ? ""
          : dash(relationship.style.style);
      const start = relationship.points[0];
      const messageStart =
        messageFlow && start
          ? `<circle class="message-flow-start" cx="${start.x}" cy="${start.y}" r="4" fill="#ffffff" stroke="${color}" stroke-width="1.5"/>`
          : "";
      const hitArea = options.interactive
        ? `<path class="relationship-hit-area" d="${path(relationship.points)}" fill="none" stroke="transparent" stroke-width="24" vector-effect="non-scaling-stroke" pointer-events="stroke"/>`
        : "";
      return `<g class="relationship${selected}" data-element-id="${escapeAttribute(relationship.id)}"${relationship.notation ? ` data-notation="${relationship.notation}"` : ""}><defs><marker id="${markerId}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">${marker}</marker></defs>${hitArea}<path d="${path(relationship.points)}" fill="none" stroke="${color}" stroke-width="${relationship.style.width}"${lineDash}${startMarker}${endMarker}/>${messageStart}${relationship.label ? label(relationship.label, relationship.labelBounds ? { x: relationship.labelBounds.x + relationship.labelBounds.width / 2, y: relationship.labelBounds.y + relationship.labelBounds.height / 2 } : midpoint(relationship.points), relationship.style.text, "relationship-label", 240) : ""}</g>`;
    })
    .join("");
  const nodes = scene.nodes
    .map((node) => {
      const selected = node.id === selection ? " selected" : "";
      const externalLabel = hasExternalLabel(node.notation);
      const bounds = nodeLabelBounds(node);
      const nodeLabel = label(
        node.label,
        { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
        node.style.text,
        externalLabel ? "node-label process-symbol-label" : "node-label",
        externalLabel ? 240 : Math.max(40, node.width - 32),
      );
      return `<g class="node${selected}" data-element-id="${escapeAttribute(node.id)}"${node.notation ? ` data-notation="${node.notation}"` : ""}>${nodeShape(node, node.style)}${nodeLabel}</g>`;
    })
    .join("");
  const selectedNode = scene.nodes.find((node) => node.id === selection);
  const interactionScale = options.interactionScale ?? 1;
  const quickAddHandles =
    options.interactive && options.quickAdd && selectedNode
      ? (["top", "right", "bottom", "left"] as const)
          .map((direction) => {
            const offset = 18 * interactionScale;
            const radius = 11 * interactionScale;
            const half = 4 * interactionScale;
            const point =
              direction === "top"
                ? {
                    x: selectedNode.x + selectedNode.width / 2,
                    y: selectedNode.y - offset,
                  }
                : direction === "right"
                  ? {
                      x: selectedNode.x + selectedNode.width + offset,
                      y: selectedNode.y + selectedNode.height / 2,
                    }
                  : direction === "bottom"
                    ? {
                        x: selectedNode.x + selectedNode.width / 2,
                        y: selectedNode.y + selectedNode.height + offset,
                      }
                    : {
                        x: selectedNode.x - offset,
                        y: selectedNode.y + selectedNode.height / 2,
                      };
            return `<g class="node-quick-add" data-source-id="${escapeAttribute(selectedNode.id)}" data-direction="${direction}" role="button" aria-label="Quick add ${direction}"><circle cx="${point.x}" cy="${point.y}" r="${radius}"/><path d="M ${point.x - half} ${point.y} H ${point.x + half} M ${point.x} ${point.y - half} V ${point.y + half}"/></g>`;
          })
          .join("")
      : "";
  const selectedRelationship = scene.relationships.find(
    (relationship) => relationship.id === selection,
  );
  const selectedStart = selectedRelationship?.points[0];
  const selectedEnd = selectedRelationship?.points.at(-1);
  const endpointHandles =
    options.interactive && selectedRelationship && selectedStart && selectedEnd
      ? `<g class="connection-endpoints" data-element-id="${escapeAttribute(selectedRelationship.id)}"><circle class="connection-endpoint-handle" data-endpoint="source" aria-label="Move source endpoint" cx="${selectedStart.x}" cy="${selectedStart.y}" r="8" fill="#ffffff" stroke="#2563eb" stroke-width="2" vector-effect="non-scaling-stroke"/><circle class="connection-endpoint-handle" data-endpoint="target" aria-label="Move target endpoint" cx="${selectedEnd.x}" cy="${selectedEnd.y}" r="8" fill="#ffffff" stroke="#2563eb" stroke-width="2" vector-effect="non-scaling-stroke"/></g>`
      : "";
  const routeHandles =
    options.interactive && selectedRelationship
      ? `<g class="connection-route-handles" data-element-id="${escapeAttribute(selectedRelationship.id)}">${selectedRelationship.points
          .slice(1)
          .map((point, index) => {
            const previous = selectedRelationship.points[index]!;
            const x = (previous.x + point.x) / 2;
            const y = (previous.y + point.y) / 2;
            const half = 4 * interactionScale;
            return `<g class="route-segment-handle" data-segment-index="${index}" role="button" tabindex="0" aria-label="Move route segment ${index + 1}"><circle class="route-handle-hit" cx="${x}" cy="${y}" r="${22 * interactionScale}"/><rect x="${x - half}" y="${y - half}" width="${half * 2}" height="${half * 2}" rx="${2 * interactionScale}"/></g>`;
          })
          .join("")}${selectedRelationship.points
          .slice(1, -1)
          .map(
            (point, index) =>
              `<g class="route-waypoint-handle" data-point-index="${index + 1}" role="button" tabindex="0" aria-label="Move route waypoint ${index + 1}"><circle class="route-handle-hit" cx="${point.x}" cy="${point.y}" r="${22 * interactionScale}"/><circle cx="${point.x}" cy="${point.y}" r="${6 * interactionScale}"/></g>`,
          )
          .join("")}</g>`
      : "";
  const outdated = options.outdated
    ? `<g class="outdated"><rect x="12" y="12" width="142" height="30" rx="15"/><text x="83" y="32" text-anchor="middle">Preview out of date</text></g>`
    : "";
  const title = options.title
    ? `<title>${escapeText(options.title)}</title>`
    : "";
  const selectedPath = options.interactive
    ? ".selected>path:not(.relationship-hit-area)"
    : ".selected>path";
  const routePoints = scene.relationships.flatMap(({ points }) => points);
  const routeMinX = Math.min(0, ...routePoints.map(({ x }) => x));
  const routeMinY = Math.min(0, ...routePoints.map(({ y }) => y));
  const routeMaxX = Math.max(
    scene.width,
    ...routePoints.map(({ x }) => x + 24),
  );
  const routeMaxY = Math.max(
    scene.height,
    ...routePoints.map(({ y }) => y + 24),
  );
  const viewport = options.viewport ?? {
    x: routeMinX < 0 ? routeMinX - 24 : 0,
    y: routeMinY < 0 ? routeMinY - 24 : 0,
    width: routeMaxX - (routeMinX < 0 ? routeMinX - 24 : 0),
    height: routeMaxY - (routeMinY < 0 ? routeMinY - 24 : 0),
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}" width="${viewport.width}" height="${viewport.height}" role="img" data-manatee-renderer="mermaid"${options.outdated ? ' data-outdated="true"' : ""}>${title}<style>text{font-family:Inter,ui-sans-serif,system-ui,sans-serif}.selected>rect,.selected>circle,.selected>ellipse,.selected>polygon,${selectedPath}{filter:drop-shadow(0 0 3px #2563eb);stroke:#2563eb!important}.outdated rect{fill:#fff7ed;stroke:#f97316}.outdated text{font-size:12px;fill:#9a3412}.node-quick-add circle{fill:#fff;stroke:#2563eb;stroke-width:2;vector-effect:non-scaling-stroke}.node-quick-add path{fill:none;stroke:#2563eb;stroke-width:2;stroke-linecap:round;vector-effect:non-scaling-stroke}.route-handle-hit{fill:transparent;stroke:none}.route-segment-handle>rect{fill:#fff;stroke:#2563eb;stroke-width:1.5;vector-effect:non-scaling-stroke}.route-waypoint-handle>circle:last-child{fill:#2563eb;stroke:#fff;stroke-width:2;vector-effect:non-scaling-stroke}</style>${groups}${relationships}${nodes}${quickAddHandles}${routeHandles}${endpointHandles}${outdated}</svg>`;
}

export const renderMermaidPreviewSvg = renderMermaidSvg;
export const renderMermaidExportSvg = renderMermaidSvg;
