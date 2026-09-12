import {
  createMemo,
  createSignal,
  lazy,
  Loading,
  onSettled,
  Show,
} from "solid-js";
import { createStore } from "solid-js";

import type { BpmnCanvas } from "./adapters/bpmn/BpmnCanvas";
import type {
  BpmnDocumentAdapter,
  BpmnDocumentSnapshot,
} from "./adapters/bpmn/BpmnDocumentAdapter";
import {
  MermaidDocumentAdapter,
  renderMermaidSvg,
  type MermaidDocumentSnapshot,
} from "./adapters/mermaid";
import { initialEditorUiState, sourceToggleLabel } from "./app/editorUiState";
import { MermaidSurface } from "./app/MermaidSurface";
import { StatusNotice } from "./app/StatusNotice";
import type {
  DocumentCommand,
  PresentationCommandType,
} from "./core/document/DocumentEngine";
import { DocumentSession } from "./core/document/DocumentSession";
import {
  copyPngOrDownload,
  downloadBlob,
  portableFilename,
  rasterizeSvg,
} from "./export/DiagramExporter";
import { IndexedDbDocumentRepository } from "./persistence/DocumentRepository";
import "./app.css";

const BpmnSurface = lazy(async () => {
  const module = await import("./adapters/bpmn/BpmnSurface");
  return { default: module.BpmnSurface };
});

const mermaidExample = `flowchart LR
  request[Request received] --> review{Approved?}
  review -->|Yes| fulfil[Fulfil request]
  review -->|No| revise[Request changes]
  revise --> review
  fulfil --> done([Complete])
`;

type ActiveSnapshot = MermaidDocumentSnapshot | BpmnDocumentSnapshot;

function selectedLabel(current: ActiveSnapshot | undefined): string {
  return current?.selectedElementLabel ?? "No selection";
}

export default function App() {
  const [ui, setUi] = createStore(initialEditorUiState());
  const [zoom, setZoom] = createSignal(1);
  const [fill, setFill] = createSignal("#e0f0ec");
  const [stroke, setStroke] = createSignal("#2d817c");
  const [attributeName, setAttributeName] = createSignal("owner");
  const [attributeValue, setAttributeValue] = createSignal("operations");
  const [pngScale, setPngScale] = createSignal(2);
  const [pngBackground, setPngBackground] = createSignal<
    "#ffffff" | "transparent"
  >("#ffffff");
  const [exportMessage, setExportMessage] = createSignal("");
  const repository = new IndexedDbDocumentRepository();
  let bpmnCanvas: BpmnCanvas | undefined;
  let stage: HTMLElement | undefined;
  let fileInput: HTMLInputElement | undefined;
  let fileHandle: FileSystemFileHandle | undefined;

  const documentSession = new DocumentSession({
    adapters: {
      mermaid: { create: () => new MermaidDocumentAdapter() },
      bpmn: {
        create: async () => {
          const { BpmnDocumentAdapter } =
            await import("./adapters/bpmn/BpmnDocumentAdapter");
          return new BpmnDocumentAdapter();
        },
        prepare: async (adapter) =>
          await (adapter as unknown as BpmnDocumentAdapter).recoverMissingDi(),
      },
    },
    store: repository,
    initialFilename: "request-flow.mmd",
    initialSource: mermaidExample,
    present: async (next) => {
      if (
        next.kind === "bpmn" &&
        next.valid &&
        bpmnCanvas?.source() !== next.source
      ) {
        const bpmn = next as BpmnDocumentSnapshot;
        await bpmnCanvas?.importSource(next.source, bpmn.presentationModel);
      }
    },
  });
  const [documentState, setDocumentState] = createSignal(
    documentSession.state(),
  );
  const unsubscribeDocument = documentSession.subscribe(setDocumentState);
  const snapshot = createMemo(
    () => documentState().snapshot as ActiveSnapshot | undefined,
  );
  const source = createMemo(() => documentState().source);
  const filename = createMemo(() => documentState().filename);
  const recovery = createMemo(() => documentState().recovery);

  const svg = createMemo(() => {
    const current = snapshot();
    const currentScene =
      current?.kind === "mermaid"
        ? (current as MermaidDocumentSnapshot).view?.scene
        : undefined;
    return current?.kind === "mermaid" && currentScene
      ? renderMermaidSvg(currentScene, {
          ...(current.selectedElementId
            ? { selectedElementId: current.selectedElementId }
            : {}),
          outdated: current.previewOutdated,
          title: "Manatee Mermaid diagram",
        })
      : "";
  });

  const fail = (error: unknown) => documentSession.reportError(error);
  const execute = (command: DocumentCommand) =>
    documentSession.execute(command);

  const action = (type: PresentationCommandType) =>
    snapshot()?.commands.presentation[type] ??
    ({ state: "inapplicable" } as const);

  const actionTitle = (type: PresentationCommandType): string | undefined => {
    const availability = action(type);
    return availability.state === "disabled" ? availability.reason : undefined;
  };

  const applicable = (type: PresentationCommandType): boolean =>
    action(type).state !== "inapplicable";

  const openMermaid = async () => {
    bpmnCanvas = undefined;
    setZoom(1);
    fileHandle = undefined;
    await documentSession.open({
      kind: "mermaid",
      filename: "request-flow.mmd",
      source: mermaidExample,
    });
  };

  const openBpmn = async () => {
    bpmnCanvas = undefined;
    setZoom(1);
    fileHandle = undefined;
    await documentSession.open(
      {
        kind: "bpmn",
        filename: "review-process.bpmn",
        source:
          import("./adapters/bpmn/fixtures/process-missing-di.bpmn?raw").then(
            (fixture) => fixture.default,
          ),
      },
      "Opening BPMN example…",
    );
  };

  const openFile = async (file: File) => {
    bpmnCanvas = undefined;
    setZoom(1);
    await documentSession.open(
      file.text().then((documentSource) => ({
        kind:
          file.name.toLowerCase().endsWith(".bpmn") ||
          /<(?:\w+:)?definitions\b/u.test(documentSource)
            ? ("bpmn" as const)
            : ("mermaid" as const),
        filename: file.name,
        source: documentSource,
      })),
      `Opening ${file.name}…`,
    );
  };

  const chooseFile = async () => {
    const picker = (
      window as typeof window & {
        showOpenFilePicker?: (
          options: unknown,
        ) => Promise<FileSystemFileHandle[]>;
      }
    ).showOpenFilePicker;
    if (!picker) {
      fileInput?.click();
      return;
    }
    try {
      const [handle] = await picker({
        multiple: false,
        types: [
          {
            description: "Mermaid or BPMN diagram",
            accept: {
              "text/plain": [".mmd", ".mermaid"],
              "application/xml": [".bpmn"],
            },
          },
        ],
      });
      if (!handle) return;
      fileHandle = handle;
      await openFile(await handle.getFile());
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      fail(error);
    }
  };

  const savePortableDocument = async () => {
    const current = snapshot();
    if (!current) return;
    try {
      if (fileHandle?.createWritable) {
        const writable = await fileHandle.createWritable();
        await writable.write(current.source);
        await writable.close();
        setExportMessage("Document saved to its original file.");
      } else {
        const type =
          current.kind === "bpmn"
            ? "application/xml;charset=utf-8"
            : "text/plain;charset=utf-8";
        downloadBlob(new Blob([current.source], { type }), filename());
        setExportMessage("Portable document downloaded.");
      }
    } catch (error) {
      fail(error);
    }
  };

  const activeSvg = async () => {
    const current = snapshot();
    if (!current?.commands.imageExport || current.previewOutdated) {
      throw new Error("Fix source errors before exporting this diagram.");
    }
    if (current.kind === "bpmn") {
      if (!bpmnCanvas) throw new Error("The BPMN canvas is still loading.");
      return await bpmnCanvas.exportSvg();
    }
    return svg();
  };

  const exportSvg = async () => {
    try {
      downloadBlob(
        new Blob([await activeSvg()], { type: "image/svg+xml;charset=utf-8" }),
        portableFilename(filename(), "svg"),
      );
      setExportMessage("SVG downloaded.");
    } catch (error) {
      fail(error);
    }
  };

  const makePng = async () =>
    await rasterizeSvg(await activeSvg(), {
      scale: pngScale(),
      background: pngBackground(),
    });

  const exportPng = async () => {
    try {
      downloadBlob(await makePng(), portableFilename(filename(), "png"));
      setExportMessage("PNG downloaded.");
    } catch (error) {
      fail(error);
    }
  };

  const copyPng = async () => {
    try {
      const result = await copyPngOrDownload(
        await makePng(),
        portableFilename(filename(), "png"),
      );
      setExportMessage(
        result === "copied"
          ? "PNG copied to the clipboard."
          : "Clipboard unavailable; PNG downloaded instead.",
      );
    } catch (error) {
      fail(error);
    }
  };

  const styleSelection = async () => {
    const current = snapshot();
    const id = current?.selectedElementId;
    if (!current || !id) return;
    await execute({
      type: "set-appearance",
      elementId: id,
      appearance: { fill: fill(), stroke: stroke() },
    });
  };

  onSettled(() => {
    void documentSession.initialize({
      kind: "mermaid",
      filename: "request-flow.mmd",
      source: mermaidExample,
    });
    if (!stage) return;
    const measure = () =>
      setUi((draft) => {
        draft.stageWidth = Math.round(
          stage?.getBoundingClientRect().width ?? 0,
        );
      });
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    measure();
    return () => {
      observer.disconnect();
      unsubscribeDocument();
      documentSession.dispose();
    };
  });

  return (
    <div class="app-shell">
      <a class="skip-link" href="#workspace">
        Skip to workspace
      </a>
      <header class="topbar">
        <div class="brand" aria-label="Manatee home">
          <span class="brand__mark" aria-hidden="true">
            M
          </span>
          <span>
            <strong>Manatee</strong>
            <small>Diagram studio</small>
          </span>
        </div>
        <div class="document-title" aria-label="Current document">
          <span
            class={{
              "document-title__dot": true,
              "document-title__dot--error": snapshot()?.valid === false,
            }}
            aria-hidden="true"
          />
          {filename()}
          <Show when={snapshot()?.dirty}>
            <span class="dirty-badge">Edited</span>
          </Show>
        </div>
        <nav class="topbar__actions" aria-label="Document actions">
          <input
            class="file-input"
            type="file"
            accept=".mmd,.mermaid,.bpmn,.xml,text/plain,application/xml"
            aria-label="Choose diagram file"
            ref={(element) => {
              fileInput = element;
            }}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) {
                fileHandle = undefined;
                void openFile(file);
              }
              event.currentTarget.value = "";
            }}
          />
          <button
            class="button button--quiet"
            type="button"
            onClick={() => void chooseFile()}
          >
            Open
          </button>
          <button
            class="button button--quiet"
            type="button"
            onClick={() => void openMermaid()}
          >
            Mermaid example
          </button>
          <button
            class="button button--quiet"
            type="button"
            onClick={() => void openBpmn()}
          >
            BPMN example
          </button>
          <button
            class="button button--quiet"
            type="button"
            onClick={() => void savePortableDocument()}
          >
            Save
          </button>
          <details class="export-menu">
            <summary class="button button--quiet">Export</summary>
            <div class="export-menu__panel">
              <strong>Slide-ready export</strong>
              <label>
                PNG scale
                <select
                  aria-label="PNG scale"
                  value={pngScale()}
                  onChange={(event) =>
                    setPngScale(Number(event.currentTarget.value))
                  }
                >
                  <option value="2">2×</option>
                  <option value="3">3×</option>
                  <option value="4">4×</option>
                </select>
              </label>
              <label class="checkbox-label">
                <input
                  type="checkbox"
                  checked={pngBackground() === "transparent"}
                  onChange={(event) =>
                    setPngBackground(
                      event.currentTarget.checked ? "transparent" : "#ffffff",
                    )
                  }
                />
                Transparent background
              </label>
              <button
                type="button"
                onClick={() => void exportSvg()}
                disabled={!snapshot()?.commands.imageExport}
              >
                Download SVG
              </button>
              <button
                type="button"
                onClick={() => void exportPng()}
                disabled={!snapshot()?.commands.imageExport}
              >
                Download PNG
              </button>
              <button
                type="button"
                onClick={() => void copyPng()}
                disabled={!snapshot()?.commands.imageExport}
              >
                Copy PNG
              </button>
              <Show when={exportMessage()}>
                <span role="status">{exportMessage()}</span>
              </Show>
            </div>
          </details>
          <button
            class="button button--primary"
            type="button"
            aria-expanded={ui.sourceOpen ? "true" : "false"}
            aria-controls="source-panel"
            onClick={() =>
              setUi((draft) => {
                draft.sourceOpen = !draft.sourceOpen;
              })
            }
          >
            {sourceToggleLabel(ui.sourceOpen)}
          </button>
        </nav>
      </header>
      <StatusNotice status={documentState().status} />
      <Show when={recovery()}>
        {(readSaved) => (
          <section class="recovery-banner" aria-label="Autosave recovery">
            <span>
              <strong>Recover autosaved work?</strong>
              {readSaved().filename} was edited in this browser.
            </span>
            <button
              type="button"
              onClick={() => void documentSession.recoverAutosave()}
            >
              Recover
            </button>
            <button
              type="button"
              onClick={() => void documentSession.discardAutosave()}
            >
              Discard
            </button>
          </section>
        )}
      </Show>
      <main
        id="workspace"
        class={{ workspace: true, "workspace--source-open": ui.sourceOpen }}
      >
        <Show when={ui.sourceOpen}>
          <aside class="source-panel" id="source-panel" aria-label="Source">
            <div class="panel-heading">
              <span>
                <span class="eyebrow">Source</span>
                <strong>Diagram text</strong>
              </span>
              <span class="file-badge">{snapshot()?.kind?.toUpperCase()}</span>
            </div>
            <textarea
              aria-label="Diagram source"
              value={source()}
              spellcheck={false}
              onInput={(event) =>
                documentSession.editSource(event.currentTarget.value)
              }
            />
            <div
              class="source-status"
              role="status"
              data-valid={snapshot()?.valid ? "true" : "false"}
            >
              <strong>
                {snapshot()?.valid ? "Preview current" : "Source has errors"}
              </strong>
              <span>
                {snapshot()?.valid
                  ? "Visual edits are available."
                  : "The canvas keeps the last valid preview."}
              </span>
            </div>
            <Show when={(snapshot()?.diagnostics.length ?? 0) > 0}>
              <ul class="diagnostics" aria-label="Document diagnostics">
                {snapshot()?.diagnostics.map((item) => (
                  <li data-severity={item.severity}>
                    <strong>{item.severity}</strong>
                    {item.message}
                  </li>
                ))}
              </ul>
            </Show>
          </aside>
        </Show>
        <section
          class="stage"
          aria-label="Diagram canvas"
          ref={(element) => {
            stage = element;
          }}
        >
          <div class="stage-toolbar" aria-label="Canvas controls">
            <span class="stage-toolbar__label">
              Canvas{" "}
              <Show when={ui.stageWidth > 0}>
                <span class="stage-toolbar__measure">{ui.stageWidth}px</span>
              </Show>
            </span>
            <div class="command-bar" aria-label="Edit controls">
              <button
                type="button"
                onClick={() => void execute({ type: "undo" })}
                disabled={!snapshot()?.commands.undo}
                title={
                  snapshot()?.commands.undo
                    ? "Undo last edit"
                    : "Nothing to undo"
                }
              >
                Undo
              </button>
              <button
                type="button"
                onClick={() => void execute({ type: "redo" })}
                disabled={!snapshot()?.commands.redo}
                title={
                  snapshot()?.commands.redo
                    ? "Redo last edit"
                    : "Nothing to redo"
                }
              >
                Redo
              </button>
              <button
                type="button"
                onClick={() => void execute({ type: "reset-layout" })}
                disabled={action("reset-layout").state !== "available"}
                title={actionTitle("reset-layout")}
              >
                Reset layout
              </button>
            </div>
            <div class="segmented" aria-label="Zoom controls">
              <button
                type="button"
                aria-label="Zoom out"
                onClick={() => {
                  const next = Math.max(0.5, zoom() - 0.1);
                  setZoom(next);
                  bpmnCanvas?.setZoom(next);
                }}
              >
                −
              </button>
              <span>{Math.round(zoom() * 100)}%</span>
              <button
                type="button"
                aria-label="Zoom in"
                onClick={() => {
                  const next = Math.min(2, zoom() + 0.1);
                  setZoom(next);
                  bpmnCanvas?.setZoom(next);
                }}
              >
                +
              </button>
            </div>
          </div>
          <Show
            when={snapshot()}
            fallback={<div class="canvas-loading">Opening diagram…</div>}
          >
            <Show
              when={snapshot()?.kind === "mermaid"}
              fallback={
                <Loading
                  fallback={
                    <div class="canvas-loading">Loading BPMN canvas…</div>
                  }
                >
                  <BpmnSurface
                    source={source()}
                    {...((snapshot() as BpmnDocumentSnapshot | undefined)
                      ?.presentationModel
                      ? {
                          presentation: (snapshot() as BpmnDocumentSnapshot)
                            .presentationModel!,
                        }
                      : {})}
                    onSelectionChange={(id) =>
                      void execute({ type: "select", elementId: id })
                    }
                    onCommand={(command) => execute(command)}
                    onReady={(canvas) => {
                      bpmnCanvas = canvas;
                    }}
                    onError={fail}
                  />
                </Loading>
              }
            >
              <MermaidSurface
                svg={svg()}
                zoom={zoom()}
                disabled={!snapshot()?.commands.visualEditing}
                selectedElementId={snapshot()?.selectedElementId}
                onSelect={(id) =>
                  void execute({ type: "select", elementId: id })
                }
                onNudge={(elementId, dx, dy) =>
                  void execute({ type: "move", elementId, dx, dy })
                }
              />
            </Show>
          </Show>
          <div class="stage-footer">
            <span>
              {snapshot()?.previewOutdated
                ? "Last valid preview"
                : "Canvas current"}
            </span>
            <span>{snapshot()?.kind === "bpmn" ? "BPMN 2.0" : "Mermaid"}</span>
          </div>
        </section>
        <Show
          when={ui.inspectorOpen}
          fallback={
            <button
              class="inspector-restore"
              type="button"
              onClick={() =>
                setUi((draft) => {
                  draft.inspectorOpen = true;
                })
              }
            >
              Show inspector
            </button>
          }
        >
          <aside class="inspector" aria-label="Inspector">
            <div class="panel-heading">
              <span>
                <span class="eyebrow">Inspector</span>
                <strong>Presentation</strong>
              </span>
              <button
                class="icon-button"
                type="button"
                aria-label="Close inspector"
                onClick={() =>
                  setUi((draft) => {
                    draft.inspectorOpen = false;
                  })
                }
              >
                ×
              </button>
            </div>
            <Show
              when={snapshot()?.selectedElementId}
              fallback={
                <div class="inspector-empty">
                  <span class="inspector-empty__icon" aria-hidden="true" />
                  <strong>No selection</strong>
                  <p>Select an element. Arrow keys move Mermaid elements.</p>
                </div>
              }
            >
              <div class="selection-summary">
                <span class="eyebrow">Selected</span>
                <strong>{selectedLabel(snapshot())}</strong>
                <code>{snapshot()?.selectedElementId}</code>
              </div>
              <fieldset
                disabled={action("set-appearance").state !== "available"}
                title={actionTitle("set-appearance")}
              >
                <legend>Appearance</legend>
                <label>
                  Fill{" "}
                  <input
                    aria-label="Fill colour"
                    type="color"
                    value={fill()}
                    onInput={(event) => setFill(event.currentTarget.value)}
                  />
                </label>
                <label>
                  Outline{" "}
                  <input
                    aria-label="Outline colour"
                    type="color"
                    value={stroke()}
                    onInput={(event) => setStroke(event.currentTarget.value)}
                  />
                </label>
                <button
                  class="button button--secondary"
                  type="button"
                  onClick={() => void styleSelection()}
                >
                  Apply appearance
                </button>
              </fieldset>
              <Show
                when={
                  applicable("set-attribute") ||
                  applicable("create-styling-rule")
                }
              >
                <fieldset
                  disabled={
                    action("set-attribute").state !== "available" &&
                    action("create-styling-rule").state !== "available"
                  }
                >
                  <legend>Attributes & rules</legend>
                  <label>
                    Attribute name{" "}
                    <input
                      type="text"
                      value={attributeName()}
                      onInput={(event) =>
                        setAttributeName(event.currentTarget.value)
                      }
                    />
                  </label>
                  <label>
                    Attribute value{" "}
                    <input
                      type="text"
                      value={attributeValue()}
                      onInput={(event) =>
                        setAttributeValue(event.currentTarget.value)
                      }
                    />
                  </label>
                  <button
                    class="button button--secondary"
                    type="button"
                    onClick={() => {
                      const id = snapshot()?.selectedElementId;
                      if (id && attributeName())
                        void execute({
                          type: "set-attribute",
                          elementId: id,
                          name: attributeName(),
                          value: attributeValue(),
                        });
                    }}
                    disabled={action("set-attribute").state !== "available"}
                    title={actionTitle("set-attribute")}
                  >
                    Set attribute
                  </button>
                  <button
                    class="button button--quiet-dark"
                    type="button"
                    onClick={() => {
                      const name = attributeName();
                      if (name)
                        void execute({
                          type: "create-styling-rule",
                          attribute: name,
                          value: attributeValue(),
                          appearance: { fill: fill(), stroke: stroke() },
                        });
                    }}
                    disabled={
                      action("create-styling-rule").state !== "available"
                    }
                    title={actionTitle("create-styling-rule")}
                  >
                    Create matching rule
                  </button>
                </fieldset>
                <fieldset>
                  <legend>Layout settings</legend>
                  <label>
                    Node spacing{" "}
                    <input
                      type="range"
                      min="24"
                      max="96"
                      value="48"
                      onChange={(event) =>
                        void execute({
                          type: "set-spacing",
                          spacing: "node",
                          value: Number(event.currentTarget.value),
                        })
                      }
                      disabled={action("set-spacing").state !== "available"}
                      title={actionTitle("set-spacing")}
                    />
                  </label>
                  <label>
                    Layer spacing{" "}
                    <input
                      type="range"
                      min="32"
                      max="128"
                      value="72"
                      onChange={(event) =>
                        void execute({
                          type: "set-spacing",
                          spacing: "layer",
                          value: Number(event.currentTarget.value),
                        })
                      }
                      disabled={action("set-spacing").state !== "available"}
                      title={actionTitle("set-spacing")}
                    />
                  </label>
                  <button
                    class="button button--secondary"
                    type="button"
                    onClick={() => {
                      const elementId = snapshot()?.selectedElementId;
                      if (elementId) {
                        void execute({
                          type: "use-automatic-position",
                          elementId,
                        });
                      }
                    }}
                    disabled={
                      action("use-automatic-position").state !== "available"
                    }
                    title={actionTitle("use-automatic-position")}
                  >
                    Use automatic position
                  </button>
                  <button
                    class="button button--quiet-dark"
                    type="button"
                    onClick={() => void execute({ type: "cleanup-unmatched" })}
                    disabled={action("cleanup-unmatched").state !== "available"}
                    title={actionTitle("cleanup-unmatched")}
                  >
                    Clean up unused settings
                  </button>
                </fieldset>
              </Show>
            </Show>
          </aside>
        </Show>
      </main>
    </div>
  );
}
