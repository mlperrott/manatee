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

/** Only task-like nodes can host an interrupting timer. Ordinary Mermaid boxes
 * remain eligible so choosing a timeout does not require restyling the host. */
export function canHostBoundaryTimer(
  model: MermaidSemanticModel,
  metadata: Readonly<Record<string, unknown>> | undefined,
  id: string,
): boolean {
  const node = model.nodes.find((node) => node.id === id);
  if (!node) return false;
  const notation = nodeNotation(metadata, id);
  return (
    notation === "task" ||
    notation === "collapsed-subprocess" ||
    (!notation &&
      [
        "square",
        "rect",
        "rectangle",
        "round",
        "rounded",
        "subroutine",
      ].includes(node.kind))
  );
}

function boundaryTimerProblem(
  model: MermaidSemanticModel,
  metadata: Readonly<Record<string, unknown>> | undefined,
  id: string,
  notation: BoundaryTimerNotation,
): string | undefined {
  const host = model.nodes.find((node) => node.id === notation.host);
  const attachment = model.relationships.find(
    ({ identity }) =>
      identity.kind === "authored" && identity.id === notation.attachment,
  );
  if (!host)
    return `Host task ${notation.host} does not exist. Restore it or remove this timeout notation.`;
  if (host.id === id)
    return "A timeout cannot attach to itself. Choose another task.";
  if (!canHostBoundaryTimer(model, metadata, host.id))
    return `${host.label} is not a task. Choose a task or collapsed subprocess for this timeout.`;
  if (!attachment)
    return `Fallback attachment ${notation.attachment} must be an authored Mermaid relationship. Restore it or remove this timeout notation.`;
  if (attachment.source !== host.id || attachment.target !== id)
    return `Fallback attachment ${notation.attachment} must connect ${host.id} to ${id}.`;
  return undefined;
}

export function attachedBoundaryTimer(
  model: MermaidSemanticModel,
  metadata: Readonly<Record<string, unknown>> | undefined,
  id: string,
): BoundaryTimerNotation | undefined {
  const notation = boundaryTimerNotation(metadata, id);
  return notation && !boundaryTimerProblem(model, metadata, id, notation)
    ? notation
    : undefined;
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
    const problem = boundaryTimerProblem(model, metadata, node.id, notation);
    if (problem)
      diagnostics.push({
        code: "manatee.notation.boundary-timer-reference",
        message: problem,
        severity: "warning",
        path: `manatee.elements.nodes.${node.id}.notation`,
      });
    const visited = new Set<string>([node.id]);
    let host = notation.host;
    while (byTimer.has(host)) {
      if (visited.has(host)) {
        diagnostics.push({
          code: "manatee.notation.boundary-timer-cycle",
          message: `Timeout attachments for ${node.label} form a cycle. Attach each timeout to a task instead.`,
          severity: "warning",
          path: `manatee.elements.nodes.${node.id}.notation.host`,
        });
        break;
      }
      visited.add(host);
      host = byTimer.get(host)!.host;
    }
  }
  return diagnostics;
}
