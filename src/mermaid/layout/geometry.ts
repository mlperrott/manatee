import type { NotationChoice } from "../../core/document/commands";
import type { Point } from "./types";

export const PROCESS_CONTAINER_HEADER = 36;
export const CONTAINER_TOP_HEADER = 28;

export function processContainerHeader(
  notation: NotationChoice | undefined,
): number {
  return notation === "pool" || notation === "lane"
    ? PROCESS_CONTAINER_HEADER
    : 0;
}

/** Origin of saved child positions, shared by layout and interactive movement. */
export function contentOrigin(
  parent:
    | (Point & {
        readonly padding: number;
        readonly notation: NotationChoice | undefined;
      })
    | undefined,
  isNode: boolean,
): Point {
  return parent
    ? {
        x:
          parent.x +
          parent.padding +
          (isNode ? processContainerHeader(parent.notation) : 0),
        y: parent.y + parent.padding + CONTAINER_TOP_HEADER,
      }
    : { x: 0, y: 0 };
}
