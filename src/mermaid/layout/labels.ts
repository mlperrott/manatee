import type { NotationChoice } from "../../core/document/commands";
import { measureLabel } from "./measure";
import { PROCESS_CONTAINER_HEADER } from "./geometry";
import type {
  Bounds,
  LayoutGroup,
  LayoutNode,
  LayoutRelationship,
  Point,
} from "./types";

export function hasExternalLabel(
  notation: NotationChoice | undefined,
): boolean {
  return (
    notation === "boundary-timer" ||
    notation === "start-event" ||
    notation === "end-event" ||
    notation === "timer-event" ||
    notation === "exclusive-gateway" ||
    notation === "parallel-gateway"
  );
}

export function nodeLabelBounds(node: LayoutNode): Bounds {
  const external = hasExternalLabel(node.notation);
  const measured = measureLabel(
    node.label,
    node.style.text.size,
    external ? 240 : Math.max(40, node.width - 32),
  );
  return {
    x: node.x + (node.width - measured.width) / 2,
    y: external
      ? node.y + node.height + 8
      : node.y + (node.height - measured.height) / 2,
    width: measured.width,
    height: measured.height,
  };
}

export function processNodeVisualBounds(node: LayoutNode): Bounds {
  if (!hasExternalLabel(node.notation)) return node;
  const label = nodeLabelBounds(node);
  return unionBounds([node, label]);
}

export function unionBounds(items: readonly Bounds[]): Bounds {
  const x = Math.min(...items.map((item) => item.x));
  const y = Math.min(...items.map((item) => item.y));
  return {
    x,
    y,
    width: Math.max(...items.map((item) => item.x + item.width)) - x,
    height: Math.max(...items.map((item) => item.y + item.height)) - y,
  };
}

export function groupLabelBounds(group: LayoutGroup): Bounds {
  const measured = measureLabel(group.label, group.style.text.size);
  return group.notation === "pool" || group.notation === "lane"
    ? {
        x: group.x + (PROCESS_CONTAINER_HEADER - measured.height) / 2,
        y: group.y + (group.height - measured.width) / 2,
        width: measured.height,
        height: measured.width,
      }
    : {
        x: group.x + (group.width - measured.width) / 2,
        y: group.y + 8,
        width: measured.width,
        height: measured.height,
      };
}

export function intersects(a: Bounds, b: Bounds, gap = 4): boolean {
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  );
}

export function segmentIntersects(
  a: Point,
  b: Point,
  bounds: Bounds,
  gap = 3,
): boolean {
  return intersects(
    {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x),
      height: Math.abs(a.y - b.y),
    },
    bounds,
    gap,
  );
}

/** Place labels in free space next to an actual route segment. This is scene
 * geometry, so dragging, preview and export all use the same placement. */
export function placeRelationshipLabels(
  relationships: readonly LayoutRelationship[],
  nodes: readonly LayoutNode[],
  groups: readonly LayoutGroup[],
): LayoutRelationship[] {
  const obstacles: Bounds[] = [
    ...nodes,
    ...nodes.map(nodeLabelBounds),
    ...groups.map(groupLabelBounds),
  ];
  return relationships.map((relationship) => {
    if (!relationship.label) return relationship;
    const measured = measureLabel(
      relationship.label,
      relationship.style.text.size,
    );
    const candidates: Bounds[] = [];
    const points = relationship.points;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!,
        b = points[i]!;
      if (a.x === b.x && a.y === b.y) continue;
      for (const fraction of [0.5, 0.25, 0.75]) {
        const center = {
          x: a.x + (b.x - a.x) * fraction,
          y: a.y + (b.y - a.y) * fraction,
        };
        for (const offset of [8, 24, 40, 64]) {
          for (const side of [-1, 1])
            candidates.push({
              x:
                a.y === b.y
                  ? center.x - measured.width / 2
                  : center.x + (side < 0 ? -measured.width - offset : offset),
              y:
                a.y === b.y
                  ? center.y + (side < 0 ? -measured.height - offset : offset)
                  : center.y - measured.height / 2,
              width: measured.width,
              height: measured.height,
            });
        }
      }
    }
    const score = (candidate: Bounds) => {
      const blocked = obstacles.filter((obstacle) =>
        intersects(candidate, obstacle),
      ).length;
      const crossing = relationships.reduce(
        (count, edge) =>
          count +
          edge.points
            .slice(1)
            .filter((point, i) =>
              segmentIntersects(edge.points[i]!, point, candidate),
            ).length,
        0,
      );
      return (
        blocked * 1000 +
        crossing * 100 +
        (candidate.x < 0 || candidate.y < 0 ? 10000 : 0)
      );
    };
    let best = candidates[0];
    let bestScore = Infinity;
    for (const candidate of candidates) {
      const value = score(candidate);
      if (value < bestScore) {
        best = candidate;
        bestScore = value;
      }
      if (value === 0) break;
    }
    if (!best) return relationship;
    obstacles.push(best);
    return { ...relationship, labelBounds: best };
  });
}
