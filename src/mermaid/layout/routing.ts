import type { Bounds, Point } from "./types";
import { segmentIntersects } from "./labels";

function directRoute(source: Bounds, target: Bounds): Point[] {
  const sourceCenter = {
    x: source.x + source.width / 2,
    y: source.y + source.height / 2,
  };
  const targetCenter = {
    x: target.x + target.width / 2,
    y: target.y + target.height / 2,
  };
  if (
    Math.abs(targetCenter.x - sourceCenter.x) >=
    Math.abs(targetCenter.y - sourceCenter.y)
  ) {
    const forward = targetCenter.x >= sourceCenter.x;
    const start = {
      x: forward ? source.x + source.width : source.x,
      y: sourceCenter.y,
    };
    const end = {
      x: forward ? target.x : target.x + target.width,
      y: targetCenter.y,
    };
    const middleX = (start.x + end.x) / 2;
    return [start, { x: middleX, y: start.y }, { x: middleX, y: end.y }, end];
  }
  const forward = targetCenter.y >= sourceCenter.y;
  const start = {
    x: sourceCenter.x,
    y: forward ? source.y + source.height : source.y,
  };
  const end = {
    x: targetCenter.x,
    y: forward ? target.y : target.y + target.height,
  };
  const middleY = (start.y + end.y) / 2;
  return [start, { x: start.x, y: middleY }, { x: end.x, y: middleY }, end];
}

function ports(bounds: Bounds): { point: Point; outside: Point }[] {
  return [
    {
      point: { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2 },
      outside: {
        x: bounds.x + bounds.width + 4,
        y: bounds.y + bounds.height / 2,
      },
    },
    {
      point: { x: bounds.x, y: bounds.y + bounds.height / 2 },
      outside: { x: bounds.x - 4, y: bounds.y + bounds.height / 2 },
    },
    {
      point: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height },
      outside: {
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height + 4,
      },
    },
    {
      point: { x: bounds.x + bounds.width / 2, y: bounds.y },
      outside: { x: bounds.x + bounds.width / 2, y: bounds.y - 4 },
    },
  ];
}

function simplify(points: readonly Point[]): Point[] {
  const result: Point[] = [];
  for (const point of points) {
    const b = result.at(-1),
      a = result.at(-2);
    if (b && b.x === point.x && b.y === point.y) continue;
    if (
      a &&
      b &&
      ((a.x === b.x && b.x === point.x) || (a.y === b.y && b.y === point.y))
    )
      result.pop();
    result.push(point);
  }
  return result;
}

/** Keep the short route when clear, otherwise choose an orthogonal detour
 * around process symbols and labels, docking on the actual symbol boundary. */
export function route(
  source: Bounds,
  target: Bounds,
  obstacles: readonly Bounds[],
): Point[] {
  const direct = directRoute(source, target);
  const blocked = obstacles.length
    ? [
        ...obstacles.filter((item) => item !== source && item !== target),
        ...[source, target].map((item) => ({
          x: item.x + 4,
          y: item.y + 4,
          width: Math.max(0, item.width - 8),
          height: Math.max(0, item.height - 8),
        })),
      ]
    : [];
  const crossings = (points: readonly Point[]) =>
    points
      .slice(1)
      .reduce(
        (total, point, i) =>
          total +
          blocked.filter((bounds) =>
            segmentIntersects(points[i]!, point, bounds, 2),
          ).length,
        0,
      );
  if (crossings(direct) === 0) return direct;
  const score = (points: readonly Point[]) =>
    crossings(points) * 10000 +
    points
      .slice(1)
      .reduce(
        (length, point, i) =>
          length +
          Math.abs(point.x - points[i]!.x) +
          Math.abs(point.y - points[i]!.y),
        0,
      ) +
    points.length * 8 +
    (points.some((point) => point.x < 0 || point.y < 0) ? 100000 : 0);
  let best = direct,
    bestScore = score(direct);
  const consider = (points: Point[]) => {
    const candidate = simplify(points),
      value = score(candidate);
    if (value < bestScore) {
      best = candidate;
      bestScore = value;
    }
  };
  for (const a of ports(source))
    for (const b of ports(target)) {
      const x = (a.outside.x + b.outside.x) / 2,
        y = (a.outside.y + b.outside.y) / 2;
      for (const middle of [
        [{ x: a.outside.x, y: b.outside.y }],
        [{ x: b.outside.x, y: a.outside.y }],
        [
          { x, y: a.outside.y },
          { x, y: b.outside.y },
        ],
        [
          { x: a.outside.x, y },
          { x: b.outside.x, y },
        ],
      ])
        consider([a.point, a.outside, ...middle, b.outside, b.point]);
    }
  // Unusual manual placement may need a corridor beside another obstacle.
  if (crossings(best) > 0) {
    for (const a of ports(source))
      for (const b of ports(target))
        for (const obstacle of blocked) {
          for (const x of [obstacle.x - 12, obstacle.x + obstacle.width + 12])
            consider([
              a.point,
              a.outside,
              { x, y: a.outside.y },
              { x, y: b.outside.y },
              b.outside,
              b.point,
            ]);
          for (const y of [obstacle.y - 12, obstacle.y + obstacle.height + 12])
            consider([
              a.point,
              a.outside,
              { x: a.outside.x, y },
              { x: b.outside.x, y },
              b.outside,
              b.point,
            ]);
        }
  }
  return best;
}
