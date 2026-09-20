import { parseDocument } from "yaml";
import { findFrontMatter } from "../core/metadata/frontMatter";

/** Everything except the Manatee mapping belongs to the protected Mermaid source. */
export function protectedSource(source: string): string | undefined {
  const front = findFrontMatter(source);
  if (front.kind === "malformed") return undefined;
  if (front.kind === "absent")
    return JSON.stringify([null, source.replace(/^\uFEFF/u, "")]);
  const yaml = parseDocument(
    source.slice(front.block.content.start, front.block.content.end),
  );
  if (yaml.errors.length) return undefined;
  yaml.delete("manatee");
  const rest = yaml.toJS() as unknown;
  return JSON.stringify([
    rest && Object.keys(rest as object).length ? rest : null,
    source.slice(front.block.closing.end),
  ]);
}

export function changesMermaid(before: string, after: string): boolean {
  if (before === after) return false;
  const left = protectedSource(before);
  const right = protectedSource(after);
  return left === undefined || right === undefined || left !== right;
}
