import type { NotationChoice } from "../core/document/commands";
import type { DocumentDiagnostic } from "../core/document/types";
import type { MermaidRelationship, RelationshipIdentity } from "./model";
import type { MermaidSemanticModel } from "./model";

type RecordValue = Record<string, unknown>;

const choices = new Set<NotationChoice>([
  "task",
  "start-event",
  "end-event",
  "exclusive-gateway",
  "parallel-gateway",
  "timer-event",
  "boundary-timer",
  "collapsed-subprocess",
  "pool",
  "lane",
  "sequence-flow",
  "message-flow",
]);

function record(value: unknown): RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
}

function choice(entry: unknown): NotationChoice | undefined {
  const type = record(record(entry).notation).type;
  return typeof type === "string" && choices.has(type as NotationChoice)
    ? (type as NotationChoice)
    : undefined;
}

export interface BoundaryTimerNotation {
  readonly type: "boundary-timer";
  readonly host: string;
  readonly attachment: string;
  readonly anchor: {
    readonly side: "top" | "right" | "bottom" | "left";
    readonly offset: number;
  };
}

export function boundaryTimerNotation(
  metadata: Readonly<Record<string, unknown>> | undefined,
  id: string,
): BoundaryTimerNotation | undefined {
  const notation = record(
    record(record(record(metadata).elements).nodes)[id],
  ).notation;
  const value = record(notation);
  if (
    value.type !== "boundary-timer" ||
    typeof value.host !== "string" ||
    typeof value.attachment !== "string"
  ) {
    return undefined;
  }
  const anchor = record(value.anchor);
  const side = ["top", "right", "bottom", "left"].includes(String(anchor.side))
    ? (anchor.side as BoundaryTimerNotation["anchor"]["side"])
    : "bottom";
  const offset =
    typeof anchor.offset === "number" &&
    Number.isFinite(anchor.offset) &&
    anchor.offset >= 0 &&
    anchor.offset <= 1
      ? anchor.offset
      : 0.8;
  return {
    type: "boundary-timer",
    host: value.host,
    attachment: value.attachment,
    anchor: { side, offset },
  };
}

export function nodeNotation(
  metadata: Readonly<Record<string, unknown>> | undefined,
  id: string,
): NotationChoice | undefined {
  return choice(record(record(record(metadata).elements).nodes)[id]);
}

export function groupNotation(
  metadata: Readonly<Record<string, unknown>> | undefined,
  category: "groups" | "lanes",
  id: string,
): NotationChoice | undefined {
  return choice(record(record(record(metadata).elements)[category])[id]);
}

function relationshipEntry(
  metadata: Readonly<Record<string, unknown>> | undefined,
  relationship: MermaidRelationship,
): unknown {
  const relationships = record(record(record(metadata).elements).relationships);
  const identity: RelationshipIdentity = relationship.identity;
  if (identity.kind === "authored") {
    return record(relationships.byId)[identity.id];
  }
  if (identity.kind === "matcher" && Array.isArray(relationships.byEndpoints)) {
    return relationships.byEndpoints.find((candidate) => {
      const match = record(record(candidate).match);
      return (
        match.source === identity.source &&
        match.target === identity.target &&
        match.kind === identity.relationshipKind
      );
    });
  }
  return undefined;
}

export function relationshipNotation(
  metadata: Readonly<Record<string, unknown>> | undefined,
  relationship: MermaidRelationship,
): NotationChoice | undefined {
  return choice(relationshipEntry(metadata, relationship));
}

export function notationDiagnostics(
  model: MermaidSemanticModel,
  metadata: Readonly<Record<string, unknown>> | undefined,
): DocumentDiagnostic[] {
  const diagnostics: DocumentDiagnostic[] = [];
  const boundaryTimers = model.nodes.flatMap((node) => {
    const notation = boundaryTimerNotation(metadata, node.id);
    return notation ? [{ node, notation }] : [];
  });
  const byTimer = new Map(
    boundaryTimers.map(({ node, notation }) => [node.id, notation]),
  );
  for (const { node, notation } of boundaryTimers) {
    const host = model.nodes.find(({ id }) => id === notation.host);
    const attachment = model.relationships.find(
      ({ identity }) =>
        identity.kind === "authored" && identity.id === notation.attachment,
    );
    const problem = !host
      ? `Host task ${notation.host} does not exist.`
      : host.id === node.id
        ? "A boundary timer cannot attach to itself."
        : !attachment
          ? `Fallback attachment ${notation.attachment} must be an authored Mermaid relationship.`
          : attachment.source !== host.id || attachment.target !== node.id
            ? `Fallback attachment ${notation.attachment} must connect ${host.id} to ${node.id}.`
            : undefined;
    if (problem) {
      diagnostics.push({
        code: "manatee.notation.boundary-timer-reference",
        message: problem,
        severity: "warning",
        path: `manatee.elements.nodes.${node.id}.notation`,
      });
    }
  }
  for (const { node } of boundaryTimers) {
    const visited = new Set<string>([node.id]);
    let host = byTimer.get(node.id)?.host;
    while (host && byTimer.has(host)) {
      if (visited.has(host)) {
        diagnostics.push({
          code: "manatee.notation.boundary-timer-cycle",
          message: `Boundary timer attachment for ${node.id} forms a cycle.`,
          severity: "warning",
          path: `manatee.elements.nodes.${node.id}.notation.host`,
        });
        break;
      }
      visited.add(host);
      host = byTimer.get(host)?.host;
    }
  }
  return diagnostics;
}
