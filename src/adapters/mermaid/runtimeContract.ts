import mermaid from "mermaid";

interface RawText {
  readonly text?: unknown;
}

export interface RawFlowVertex {
  readonly id?: unknown;
  readonly text?: unknown;
  readonly type?: unknown;
  readonly classes?: unknown;
  readonly styles?: unknown;
  readonly labelType?: unknown;
  readonly icon?: unknown;
  readonly img?: unknown;
  readonly haveCallback?: unknown;
  readonly link?: unknown;
}

export interface RawFlowEdge {
  readonly id?: unknown;
  readonly start?: unknown;
  readonly end?: unknown;
  readonly type?: unknown;
  readonly text?: unknown;
  readonly classes?: unknown;
  readonly style?: unknown;
  readonly stroke?: unknown;
  readonly isUserDefinedId?: unknown;
  readonly animation?: unknown;
  readonly animate?: unknown;
}

export interface RawFlowGroup {
  readonly id?: unknown;
  readonly title?: unknown;
  readonly nodes?: unknown;
  readonly dir?: unknown;
  readonly classes?: unknown;
  readonly metadata?: unknown;
}

export interface RawFlowClass {
  readonly id?: unknown;
  readonly styles?: unknown;
  readonly textStyles?: unknown;
}

export interface RawC4Shape {
  readonly alias?: unknown;
  readonly label?: RawText;
  readonly typeC4Shape?: RawText;
  readonly parentBoundary?: unknown;
  readonly descr?: RawText;
  readonly techn?: RawText;
  readonly bgColor?: unknown;
  readonly fontColor?: unknown;
  readonly borderColor?: unknown;
  readonly shape?: unknown;
  readonly sprite?: unknown;
  readonly tags?: unknown;
  readonly link?: unknown;
}

export interface RawC4Boundary {
  readonly alias?: unknown;
  readonly label?: RawText;
  readonly type?: RawText;
  readonly parentBoundary?: unknown;
  readonly bgColor?: unknown;
  readonly fontColor?: unknown;
  readonly borderColor?: unknown;
  readonly sprite?: unknown;
  readonly tags?: unknown;
  readonly link?: unknown;
}

export interface RawC4Relationship {
  readonly type?: unknown;
  readonly from?: unknown;
  readonly to?: unknown;
  readonly label?: RawText;
  readonly techn?: RawText;
  readonly descr?: RawText;
  readonly textColor?: unknown;
  readonly lineColor?: unknown;
  readonly sprite?: unknown;
  readonly tags?: unknown;
  readonly link?: unknown;
}

export interface RawFlowDatabase {
  getVertices(): Map<string, RawFlowVertex>;
  getEdges(): RawFlowEdge[];
  getSubGraphs(): RawFlowGroup[];
  getClasses(): Map<string, RawFlowClass>;
  getDirection(): string | undefined;
}

export interface RawC4Database {
  getC4Type(): string | undefined;
  getC4ShapeArray(): RawC4Shape[];
  getBoundaries(): RawC4Boundary[];
  getRels(): RawC4Relationship[];
}

export interface ParsedMermaidRuntime {
  readonly type: string;
  readonly database: RawFlowDatabase | RawC4Database;
}

let initialized = false;
let parsingQueue: Promise<void> = Promise.resolve();

function initialize(): void {
  if (initialized) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    htmlLabels: false,
  });
  initialized = true;
}

function isFunction(value: unknown): value is (...args: never[]) => unknown {
  return typeof value === "function";
}

function flowDatabase(value: unknown): value is RawFlowDatabase {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isFunction(candidate.getVertices) &&
    isFunction(candidate.getEdges) &&
    isFunction(candidate.getSubGraphs) &&
    isFunction(candidate.getClasses) &&
    isFunction(candidate.getDirection)
  );
}

function c4Database(value: unknown): value is RawC4Database {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isFunction(candidate.getC4Type) &&
    isFunction(candidate.getC4ShapeArray) &&
    isFunction(candidate.getBoundaries) &&
    isFunction(candidate.getRels)
  );
}

async function parseUnqueued(source: string): Promise<ParsedMermaidRuntime> {
  initialize();
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(source);
  if (!flowDatabase(diagram.db) && !c4Database(diagram.db)) {
    throw new Error(
      `Mermaid 11.17.2 returned an unsupported database contract for ${diagram.type}.`,
    );
  }
  return { type: diagram.type, database: diagram.db };
}

export function parseMermaidDiagram(
  source: string,
): Promise<ParsedMermaidRuntime> {
  const result = parsingQueue.then(() => parseUnqueued(source));
  parsingQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function isRawFlowDatabase(
  database: ParsedMermaidRuntime["database"],
): database is RawFlowDatabase {
  return flowDatabase(database);
}

export function isRawC4Database(
  database: ParsedMermaidRuntime["database"],
): database is RawC4Database {
  return c4Database(database);
}
