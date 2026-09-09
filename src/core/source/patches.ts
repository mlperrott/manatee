import type { SourcePatch } from "../document/types";

export class UnsafeSourcePatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeSourcePatchError";
  }
}

export function applySourcePatches(
  source: string,
  patches: readonly SourcePatch[],
): string {
  const ordered = [...patches].sort(
    (left, right) => left.range.start - right.range.start,
  );

  let previousEnd = 0;
  for (const patch of ordered) {
    const { start, end } = patch.range;
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end < start ||
      end > source.length
    ) {
      throw new UnsafeSourcePatchError(
        `Patch range ${start}:${end} is outside the source.`,
      );
    }

    if (start < previousEnd) {
      throw new UnsafeSourcePatchError("Source patches must not overlap.");
    }
    previousEnd = end;
  }

  let result = source;
  for (const patch of ordered.reverse()) {
    result =
      result.slice(0, patch.range.start) +
      patch.replacement +
      result.slice(patch.range.end);
  }
  return result;
}

export function minimalSourcePatch(
  before: string,
  after: string,
): SourcePatch | undefined {
  if (before === after) return;

  let prefix = 0;
  const sharedLength = Math.min(before.length, after.length);
  while (prefix < sharedLength && before[prefix] === after[prefix]) prefix += 1;

  let suffix = 0;
  while (
    suffix < sharedLength - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  return {
    range: { start: prefix, end: before.length - suffix },
    replacement: after.slice(prefix, after.length - suffix),
  };
}
