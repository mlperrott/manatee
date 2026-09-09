import { describe, expect, it } from "vitest";

import {
  applySourcePatches,
  minimalSourcePatch,
  UnsafeSourcePatchError,
} from "./patches";

describe("source patches", () => {
  it("applies disjoint patches without requiring caller ordering", () => {
    expect(
      applySourcePatches("one two three", [
        { range: { start: 8, end: 13 }, replacement: "THREE" },
        { range: { start: 0, end: 3 }, replacement: "ONE" },
      ]),
    ).toBe("ONE two THREE");
  });

  it("rejects overlapping and out-of-bounds changes", () => {
    expect(() =>
      applySourcePatches("abcd", [
        { range: { start: 0, end: 2 }, replacement: "x" },
        { range: { start: 1, end: 3 }, replacement: "y" },
      ]),
    ).toThrow(UnsafeSourcePatchError);
    expect(() =>
      applySourcePatches("abcd", [
        { range: { start: 2, end: 5 }, replacement: "x" },
      ]),
    ).toThrow(UnsafeSourcePatchError);
  });

  it("finds the smallest single replacement", () => {
    expect(minimalSourcePatch("abcde", "abXYde")).toEqual({
      range: { start: 2, end: 3 },
      replacement: "XY",
    });
    expect(minimalSourcePatch("same", "same")).toBeUndefined();
  });
});
