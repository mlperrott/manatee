import type { Arrangement } from "../../core/document/commands";
import { contentOrigin } from "./geometry";
import type { MermaidScene, Point } from "./types";

export interface ElementMovement {
  readonly id: string;
  readonly dx: number;
  readonly dy: number;
}

/** Ancestors and timer hosts own movement of their selected dependents. */
export function selectionRoots(
  scene: MermaidScene,
  ids: readonly string[],
  timerHosts: ReadonlyMap<string, string> = new Map(),
) {
  const items = new Map(
    [...scene.groups, ...scene.nodes].map((item) => [item.id, item]),
  );
  const selected = new Set(ids);
  return [...selected].flatMap((id) => {
    const item = items.get(id);
    if (!item) return [];
    let parentId = timerHosts.get(id) ?? item.parentId;
    const visited = new Set<string>();
    while (parentId && !visited.has(parentId)) {
      if (selected.has(parentId)) return [];
      visited.add(parentId);
      parentId = items.get(parentId)?.parentId;
    }
    return [item];
  });
}

export function selectionMovements(
  scene: MermaidScene,
  ids: readonly string[],
  operation: Arrangement | Point,
  timerHosts: ReadonlyMap<string, string> = new Map(),
): ElementMovement[] {
  const roots = selectionRoots(scene, ids, timerHosts);
  if (
    roots.length === 0 ||
    ids.some(
      (id) => ![...scene.nodes, ...scene.groups].some((item) => item.id === id),
    )
  )
    throw new Error("Select nodes or containers to arrange.");
  if (roots.some((item) => item.notation === "boundary-timer"))
    throw new Error(
      "Move a boundary timer with its host, or select it alone to adjust its anchor.",
    );
  const distribution = operation === "horizontal" || operation === "vertical";
  if (typeof operation === "string" && roots.length < (distribution ? 3 : 2))
    throw new Error(
      distribution
        ? "Select at least three independent elements to distribute."
        : "Select at least two independent elements to align.",
    );
  const horizontal =
    typeof operation !== "string" ||
    ["left", "center", "right", "horizontal"].includes(operation);
  const axis = horizontal ? "x" : "y";
  const extent = horizontal ? "width" : "height";
  const start = Math.min(...roots.map((item) => item[axis]));
  const end = Math.max(...roots.map((item) => item[axis] + item[extent]));
  const sorted = [...roots].sort(
    (a, b) => a[axis] - b[axis] || a.id.localeCompare(b.id),
  );
  const first = sorted[0]!;
  const last = sorted.at(-1)!;
  const gap =
    (last[axis] +
      last[extent] -
      first[axis] -
      sorted.reduce((sum, item) => sum + item[extent], 0)) /
    (sorted.length - 1);
  let cursor = first[axis];
  let movements = (distribution ? sorted : roots).map((item) => {
    if (typeof operation !== "string")
      return { id: item.id, dx: operation.x, dy: operation.y };
    const target = distribution
      ? cursor
      : operation === "left" || operation === "top"
        ? start
        : operation === "right" || operation === "bottom"
          ? end - item[extent]
          : (start + end - item[extent]) / 2;
    cursor += item[extent] + gap;
    return {
      id: item.id,
      dx: horizontal ? target - item.x : 0,
      dy: horizontal ? 0 : target - item.y,
    };
  });
  const minimums = roots.map((item) => {
    const parent = scene.groups.find((group) => group.id === item.parentId);
    const origin = contentOrigin(
      parent,
      scene.nodes.some((node) => node.id === item.id),
    );
    return { id: item.id, x: origin.x - item.x, y: origin.y - item.y };
  });
  // Clamp a collective move as a unit so it never distorts relative spacing.
  if (typeof operation !== "string") {
    const dx = Math.max(operation.x, ...minimums.map((item) => item.x));
    const dy = Math.max(operation.y, ...minimums.map((item) => item.y));
    movements = movements.map((item) => ({ ...item, dx, dy }));
  }
  for (const movement of movements) {
    const minimum = minimums.find((item) => item.id === movement.id)!;
    if (!Number.isFinite(movement.dx) || !Number.isFinite(movement.dy))
      throw new Error("Movement must use finite coordinates.");
    if (movement.dx < minimum.x - 0.001 || movement.dy < minimum.y - 0.001)
      throw new Error(
        "This alignment would place an element outside its container. Move the container or choose another alignment.",
      );
  }
  return movements;
}

export function expandedMovements(
  scene: MermaidScene,
  movements: readonly ElementMovement[],
  timerHosts: ReadonlyMap<string, string> = new Map(),
): ReadonlyMap<string, ElementMovement> {
  const result = new Map(movements.map((item) => [item.id, item]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of [...scene.groups, ...scene.nodes]) {
      const parent = timerHosts.get(item.id) ?? item.parentId;
      const movement = parent ? result.get(parent) : undefined;
      if (movement && !result.has(item.id)) {
        result.set(item.id, { ...movement, id: item.id });
        changed = true;
      }
    }
  }
  return result;
}
