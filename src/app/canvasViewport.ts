import { groupLabelBounds, nodeLabelBounds } from "../mermaid/layout/labels";
import type { Bounds, MermaidScene, Point } from "../mermaid/layout/types";

const DEFAULT_PADDING = 72;

function includePoint(
  point: Point,
  extent: { minX: number; minY: number; maxX: number; maxY: number },
) {
  extent.minX = Math.min(extent.minX, point.x);
  extent.minY = Math.min(extent.minY, point.y);
  extent.maxX = Math.max(extent.maxX, point.x);
  extent.maxY = Math.max(extent.maxY, point.y);
}

function includeBounds(
  bounds: Bounds,
  extent: { minX: number; minY: number; maxX: number; maxY: number },
) {
  includePoint(bounds, extent);
  includePoint(
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    extent,
  );
}

export function canvasViewport(
  scene: MermaidScene,
  padding = DEFAULT_PADDING,
): Bounds {
  const extent = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };

  for (const group of scene.groups) {
    includeBounds(group, extent);
    includeBounds(groupLabelBounds(group), extent);
  }
  for (const node of scene.nodes) {
    includeBounds(node, extent);
    includeBounds(nodeLabelBounds(node), extent);
  }
  for (const relationship of scene.relationships) {
    for (const point of relationship.points) includePoint(point, extent);
    if (relationship.labelBounds)
      includeBounds(relationship.labelBounds, extent);
  }

  if (!Number.isFinite(extent.minX))
    return { x: 0, y: 0, width: scene.width, height: scene.height };

  const x = extent.minX - padding;
  const y = extent.minY - padding;
  const right = extent.maxX + padding;
  const bottom = extent.maxY + padding;
  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
  };
}
