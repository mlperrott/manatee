import type { Bounds } from "./types";
import type { NotationChoice } from "../../core/document/commands";

export interface MeasuredLabel {
  readonly width: number;
  readonly height: number;
  readonly lines: readonly string[];
}

export function plainLabel(label: string): string {
  return label
    .replaceAll(/<br\s*\/?>/giu, "\n")
    .replaceAll(/[`*_]/gu, "")
    .replaceAll(/&lt;/gu, "<")
    .replaceAll(/&gt;/gu, ">")
    .replaceAll(/&amp;/gu, "&");
}

export function measureLabel(
  label: string,
  fontSize = 15,
  maxWidth = 240,
): MeasuredLabel {
  const authoredLines = plainLabel(label).split("\n");
  const lines: string[] = [];
  const averageCharacterWidth = fontSize * 0.56;
  const maxCharacters = Math.max(
    8,
    Math.floor(maxWidth / averageCharacterWidth),
  );
  for (const authored of authoredLines) {
    const words = authored.split(/\s+/u).filter(Boolean);
    let line = "";
    for (const word of words.length > 0 ? words : [""]) {
      if (line && `${line} ${word}`.length > maxCharacters) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    lines.push(line);
  }
  const longest = Math.max(1, ...lines.map((line) => line.length));
  return {
    width: Math.min(maxWidth, Math.ceil(longest * averageCharacterWidth)),
    height: Math.ceil(lines.length * fontSize * 1.35),
    lines: Object.freeze(lines),
  };
}

export function nodeSize(
  label: string,
  kind: string,
  notation?: NotationChoice,
  fontSize = 15,
): Pick<Bounds, "width" | "height"> {
  const measured = measureLabel(label, fontSize);
  if (notation === "boundary-timer") return { width: 44, height: 44 };
  if (
    notation === "start-event" ||
    notation === "end-event" ||
    notation === "timer-event"
  ) {
    return { width: 56, height: 56 };
  }
  if (notation === "exclusive-gateway" || notation === "parallel-gateway") {
    return { width: 64, height: 64 };
  }
  const roundShape =
    kind.includes("circle") ||
    kind.includes("diamond") ||
    notation?.includes("event") ||
    notation?.includes("gateway");
  const width = Math.max(roundShape ? 86 : 112, measured.width + 40);
  const height = Math.max(roundShape ? 72 : 54, measured.height + 28);
  return roundShape
    ? { width: Math.max(width, height), height: Math.max(width, height) }
    : { width, height };
}
