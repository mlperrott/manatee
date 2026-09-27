import {
  createEffect,
  createMemo,
  createSignal,
  createStore,
  Errored,
  For,
  onSettled,
  Show,
} from "solid-js";

import {
  boundaryTimerNotation,
  MermaidDocument,
  renderMermaidSvg,
  type MermaidDocumentSnapshot,
} from "./mermaid";
import { canHostBoundaryTimer } from "./mermaid/notation";
import { initialEditorUiState, sourceToggleLabel } from "./app/editorUiState";
import { MermaidSurface } from "./app/MermaidSurface";
import { StatusNotice } from "./app/StatusNotice";
import type {
  DocumentCommand,
  NotationChoice,
  PresentationCommandType,
} from "./core/document/commands";
import { DocumentWorkspace } from "./core/document/DocumentWorkspace";
import { PresentationPanel } from "./app/studio/PresentationPanel";
import { StructurePanel } from "./app/studio/StructurePanel";
import { SelectionEssentials } from "./app/studio/SelectionEssentials";
import { ExamplesGallery } from "./app/studio/ExamplesGallery";
import {
  studioExamples,
  newDocumentSources,
  type StudioExample,
} from "./app/studio/examples";
import type { MermaidFamily } from "./mermaid/model";
import {
  copyPngOrDownload,
  downloadBlob,
  portableFilename,
  rasterizeSvg,
} from "./export/DiagramExporter";
import { IndexedDbDocumentRepository } from "./persistence/DocumentRepository";
import type { RetiredSource } from "./persistence/DocumentRepository";
import "./app.css";

function selectedLabel(current: MermaidDocumentSnapshot | undefined): string {
  return current?.selectedElementLabel ?? "No selection";
}

const nodeNotations: readonly [NotationChoice, string][] = [
  ["task", "Task"],
  ["start-event", "Start event"],
  ["end-event", "End event"],
  ["exclusive-gateway", "Exclusive gateway"],
  ["parallel-gateway", "Parallel gateway"],
  ["timer-event", "Timer wait"],
  ["boundary-timer", "Interrupting timeout"],
  ["collapsed-subprocess", "Collapsed subprocess"],
];

function selectedNotation(current: MermaidDocumentSnapshot | undefined) {
  const id = current?.selectedElementId;
  const scene = current?.scene;
  if (!id || !scene) return undefined;
  return (
    scene.nodes.find((item) => item.id === id)?.notation ??
    scene.groups.find((item) => item.id === id)?.notation ??
    scene.relationships.find((item) => item.id === id)?.notation
  );
}

function notationOptions(
  current: MermaidDocumentSnapshot | undefined,
): readonly [NotationChoice, string][] {
  const id = current?.selectedElementId;
  const model = current?.model;
  if (
    !id ||
    !model ||
    (model.family !== "flowchart" && model.family !== "swimlane")
  ) {
    return [];
  }
  if (model.nodes.some((item) => item.id === id)) return nodeNotations;
  const group = model.groups.find((item) => item.id === id);
  if (group)
    return [
      ["pool", "Pool"],
      ["lane", "Lane"],
    ];
  return model.relationships.some((item) => item.id === id)
    ? [
        ["sequence-flow", "Sequence flow"],
        ["message-flow", "Message flow"],
      ]
    : [];
}

function boundaryAttachmentOptions(
  current: MermaidDocumentSnapshot | undefined,
) {
  const timerId = current?.selectedElementId;
  if (!timerId || !current?.model) return [];
  return current.model.relationships.flatMap((relationship) =>
    relationship.target === timerId &&
    relationship.source !== timerId &&
    relationship.identity.kind === "authored" &&
    canHostBoundaryTimer(current.model!, current.metadata, relationship.source)
      ? [
          {
            id: relationship.identity.id,
            hostId: relationship.source,
            label: (() => {
              const host = current.model!.nodes.find(
                ({ id }) => id === relationship.source,
              )!;
              const sameHost = current.model!.relationships.filter(
                (edge) =>
                  edge.source === host.id &&
                  edge.target === timerId &&
                  edge.identity.kind === "authored",
              );
              return sameHost.length > 1
                ? `${host.label} — ${relationship.label || `connection ${sameHost.indexOf(relationship) + 1}`}`
                : host.label;
            })(),
          },
        ]
      : [],
  );
}

function Studio() {
  const [ui, setUi] = createStore(initialEditorUiState());
  const [zoom, setZoom] = createSignal(1);
  const [fitView, setFitView] = createSignal(false);
  const [mobileView, setMobileView] = createSignal("canvas");
  const [galleryOpen, setGalleryOpen] = createSignal(false);
  const [boundaryAttachmentDraft, setBoundaryAttachmentDraft] =
    createSignal("");
  const [pngScale, setPngScale] = createSignal(2);
  const [pngBackground, setPngBackground] = createSignal<
    "#ffffff" | "transparent"
  >("#ffffff");
  const [exportMessage, setExportMessage] = createSignal("");
  const [gettingStartedComplete, setGettingStartedComplete] = createSignal(
    typeof window !== "undefined" &&
      window.localStorage.getItem("manatee:getting-started-complete") ===
        "true",
  );
  const [inlineLabel, setInlineLabel] = createSignal<{
    id: string;
    value: string;
  }>();
  const [retiredSource, setRetiredSource] = createSignal<RetiredSource>();
  const repository = new IndexedDbDocumentRepository();
  // Solid's bare-ref transform assigns these from ref={variable}.
  // oxlint-disable-next-line no-unassigned-vars
  let stage: HTMLElement | undefined;
  // oxlint-disable-next-line no-unassigned-vars
  let fileInput: HTMLInputElement | undefined;
  // oxlint-disable-next-line no-unassigned-vars
  let sourceEditor: HTMLTextAreaElement | undefined;
  // oxlint-disable-next-line no-unassigned-vars
  let inlineLabelInput: HTMLInputElement | undefined;
  const fileHandles = new Map<string, FileSystemFileHandle>();
  const viewStates = new Map<string, { zoom: number; fit: boolean }>();

  const documentSession = new DocumentWorkspace({
    createDocument: () => new MermaidDocument(),
    store: repository,
    initialFilename: "untitled-flowchart.mmd",
    initialSource: newDocumentSources.flowchart,
  });
  const [documentState, setDocumentState] = createSignal(
    documentSession.state(),
  );
  const unsubscribeDocument = documentSession.subscribe(setDocumentState);
  const tabs = createMemo(() => {
    documentState();
    return documentSession.tabs();
  });
  const activeId = createMemo(() => {
    documentState();
    return documentSession.activeId();
  });
  const currentExample = createMemo(() => {
    documentState();
    return studioExamples.find(
      (example) => example.id === documentSession.activeTab()?.exampleId,
    );
  });
  const snapshot = createMemo(() => documentState().snapshot);
  const source = createMemo(() => documentState().source);
  const filename = createMemo(() => documentState().filename);
  const recovery = createMemo(() => documentState().recovery);
  const emptyFlowchart = createMemo(() => {
    const model = snapshot()?.model;
    return (
      model?.family === "flowchart" &&
      model.nodes.length === 0 &&
      model.groups.length === 0 &&
      model.relationships.length === 0
    );
  });
  const gettingStartedStep = createMemo<
    "first" | "second" | "connection" | undefined
  >(() => {
    if (gettingStartedComplete()) return;
    const model = snapshot()?.model;
    if (model?.family !== "flowchart" || model.relationships.length > 0) return;
    if (model.nodes.length === 0) return "first";
    if (model.nodes.length === 1) return "second";
    return "connection";
  });
  const boundaryAttachments = createMemo(() =>
    boundaryAttachmentOptions(snapshot()),
  );
  const currentBoundaryTimer = createMemo(() => {
    const current = snapshot();
    const id = current?.selectedElementId;
    return id ? boundaryTimerNotation(current?.metadata, id) : undefined;
  });
  const boundaryAttachment = createMemo(() => {
    const options = boundaryAttachments();
    const draft = boundaryAttachmentDraft();
    if (options.some(({ id }) => id === draft)) return draft;
    const saved = currentBoundaryTimer()?.attachment;
    if (saved && options.some(({ id }) => id === saved)) return saved;
    return options[0]?.id ?? "";
  });

  const svg = createMemo(() => {
    const current = snapshot();
    const currentScene = current?.scene;
    return currentScene
      ? renderMermaidSvg(currentScene, {
          ...(current.selectedElementId
            ? { selectedElementId: current.selectedElementId }
            : {}),
          outdated: current.previewOutdated,
          title: "Manatee Mermaid diagram",
          interactive: true,
        })
      : "";
  });

  const fail = (error: unknown) => documentSession.reportError(error);
  const execute = (command: DocumentCommand) =>
    documentSession.execute(command);

  const executeStudio = async (command: DocumentCommand) => {
    await execute(command);
    return documentSession.state().status.kind !== "error";
  };

  const action = (type: PresentationCommandType) =>
    snapshot()?.commands.presentation[type] ??
    ({ state: "inapplicable" } as const);

  const actionTitle = (type: PresentationCommandType): string | undefined => {
    const availability = action(type);
    return availability.state === "disabled" ? availability.reason : undefined;
  };

  const applicable = (type: PresentationCommandType): boolean =>
    action(type).state !== "inapplicable";

  const applyView = (id: string, fit: boolean) => {
    const saved = viewStates.get(id) ?? { zoom: 1, fit };
    viewStates.set(id, saved);
    setZoom(saved.zoom);
    setFitView(saved.fit);
    setMobileView("canvas");
  };
  const updateZoom = (value: number) => {
    setZoom(value);
    const id = documentSession.activeId();
    const current = viewStates.get(id);
    if (id) viewStates.set(id, { zoom: value, fit: current?.fit ?? false });
  };
  const updateFit = (value: boolean) => {
    setFitView(value);
    const id = documentSession.activeId();
    const current = viewStates.get(id);
    if (id) viewStates.set(id, { zoom: current?.zoom ?? 1, fit: value });
  };
  const selectDocument = (id: string) => {
    documentSession.select(id);
    applyView(id, true);
  };
  const isUntouchedGuidedBlank = () => {
    const current = snapshot();
    const tab = documentSession.activeTab();
    return (
      current?.model?.family === "flowchart" &&
      current.model.nodes.length === 0 &&
      current.model.relationships.length === 0 &&
      tab?.source === newDocumentSources.flowchart &&
      tab.savedSource === newDocumentSources.flowchart
    );
  };
  const finishGettingStarted = () => {
    window.localStorage.setItem("manatee:getting-started-complete", "true");
    setGettingStartedComplete(true);
  };
  const nextElementId = (prefix: string) => {
    const ids = new Set(
      [
        ...(snapshot()?.model?.nodes ?? []),
        ...(snapshot()?.model?.groups ?? []),
        ...(snapshot()?.model?.relationships ?? []),
      ].map(({ id }) => id),
    );
    let number = 1;
    while (ids.has(`${prefix}_${number}`)) number += 1;
    return `${prefix}_${number}`;
  };
  const editLabelInline = (id: string, value: string) => {
    setInlineLabel({ id, value });
    requestAnimationFrame(() => {
      inlineLabelInput?.focus();
      inlineLabelInput?.select();
    });
  };
  const addGuidedNode = async () => {
    const id = nextElementId("node");
    const success = await executeStudio({
      type: "edit-structure",
      edit: {
        action: "node",
        id,
        label: "New node",
        kind: "rectangle",
        classes: [],
      },
    });
    if (!success) return;
    await execute({ type: "select", elementId: id });
    editLabelInline(id, "New node");
  };
  const commitInlineLabel = async () => {
    const draft = inlineLabel();
    const node = snapshot()?.model?.nodes.find(({ id }) => id === draft?.id);
    if (!draft || !node) {
      setInlineLabel(undefined);
      return;
    }
    const value = draft.value.trim() || "New node";
    const success = await executeStudio({
      type: "edit-structure",
      edit: {
        action: "node",
        id: node.id,
        label: value,
        kind: node.kind,
        ...(node.parentId ? { parentId: node.parentId } : {}),
        technology: node.technology,
        description: node.description,
        classes: node.classes,
      },
    });
    if (success) setInlineLabel(undefined);
  };
  const connectGuidedNodes = async () => {
    const nodes = snapshot()?.model?.nodes ?? [];
    if (nodes.length < 2) return;
    const id = nextElementId("connection");
    const success = await executeStudio({
      type: "edit-structure",
      edit: {
        action: "relationship",
        id,
        authoredId: id,
        source: nodes[0]!.id,
        target: nodes[1]!.id,
        label: "",
        kind: "arrow_point",
        technology: "",
        description: "",
      },
    });
    if (success) finishGettingStarted();
  };
  const focusSourceForPaste = async () => {
    if (snapshot()?.sourceEditing === false)
      await execute({ type: "set-source-editing", allowed: true });
    setUi((draft) => {
      draft.sourceOpen = true;
    });
    setMobileView("source");
    requestAnimationFrame(() => {
      sourceEditor?.focus();
      sourceEditor?.select();
    });
  };
  const showSourceRange = (range: { start: number; end: number }) => {
    setUi((draft) => {
      draft.sourceOpen = true;
    });
    setMobileView("source");
    requestAnimationFrame(() => {
      sourceEditor?.focus();
      sourceEditor?.setSelectionRange(range.start, range.end);
    });
  };
  const openExample = async (example: StudioExample) => {
    setGalleryOpen(false);
    const replacedId = isUntouchedGuidedBlank() ? activeId() : undefined;
    const portrait = Math.min(window.innerWidth, window.screen.width) <= 600;
    const id = await documentSession.open(
      {
        filename: `${example.id}.mmd`,
        source: portrait
          ? example.source.replace(/(flowchart|swimlane-beta) LR/u, "$1 TD")
          : example.source,
      },
      true,
      example.id,
    );
    viewStates.set(id, { zoom: 1, fit: true });
    applyView(id, true);
    if (replacedId && replacedId !== id) {
      documentSession.close(replacedId);
      fileHandles.delete(replacedId);
      viewStates.delete(replacedId);
    }
  };
  const openFile = async (file: File, handle?: FileSystemFileHandle) => {
    try {
      const documentSource = await file.text();
      if (/^\s*<\?xml|<(?:\w+:)?definitions\b/u.test(documentSource))
        throw new Error(
          "BPMN XML is no longer supported. Open a Mermaid document instead.",
        );
      const id = await documentSession.open(
        { filename: file.name, source: documentSource },
        false,
      );
      viewStates.set(id, { zoom: 1, fit: true });
      applyView(id, true);
      if (handle) fileHandles.set(id, handle);
    } catch (error) {
      fail(error);
    }
  };
  const newDocument = async (family: MermaidFamily) => {
    const id = await documentSession.open(
      {
        filename: `untitled-${family}.mmd`,
        source: newDocumentSources[family],
      },
      true,
    );
    const fit = family !== "flowchart";
    viewStates.set(id, { zoom: 1, fit });
    applyView(id, fit);
  };
  const closeDocument = (id: string) => {
    if (
      documentSession.dirty(id) &&
      !window.confirm("Close this document and discard its unsaved changes?")
    )
      return;
    documentSession.close(id);
    fileHandles.delete(id);
    viewStates.delete(id);
    const next = documentSession.activeId();
    if (next) applyView(next, true);
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
            description: "Mermaid diagram",
            accept: {
              "text/plain": [".mmd", ".mermaid"],
            },
          },
        ],
      });
      if (!handle) return;
      await openFile(await handle.getFile(), handle);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      fail(error);
    }
  };

  const savePortableDocument = async () => {
    const current = snapshot();
    if (!current) return;
    const id = activeId();
    const savedSource = source();
    try {
      downloadBlob(
        new Blob([savedSource], { type: "text/plain;charset=utf-8" }),
        filename(),
      );
      setExportMessage("Portable .mmd downloaded.");
      documentSession.markSaved(id, savedSource);
    } catch (error) {
      fail(error);
    }
  };

  const imageExportReady = createMemo(() =>
    Boolean(
      snapshot()?.commands.imageExport && source() === snapshot()?.source,
    ),
  );

  const activeSvg = async () => {
    const current = snapshot();
    if (!imageExportReady() || !current || current.previewOutdated) {
      throw new Error("Fix source errors before exporting this diagram.");
    }
    return renderMermaidSvg(current.scene!, {
      title: "Manatee Mermaid diagram",
    });
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

  createEffect(exportMessage, (message) => {
    if (!message) return;
    const timeout = window.setTimeout(() => setExportMessage(""), 4500);
    return () => window.clearTimeout(timeout);
  });

  createEffect(
    () => ({
      relationships: snapshot()?.model?.relationships.length ?? 0,
      complete: gettingStartedComplete(),
    }),
    ({ relationships, complete }) => {
      if (relationships > 0 && !complete) finishGettingStarted();
    },
  );

  createEffect(
    () => ({ id: activeId(), current: snapshot() }),
    ({ id, current }) => {
      if (!id || !current?.scene || viewStates.has(id)) return;
      const fit =
        current.model !== undefined &&
        current.model.nodes.length + current.model.groups.length > 2;
      viewStates.set(id, { zoom: 1, fit });
      setZoom(1);
      setFitView(fit);
    },
  );

  onSettled(() => {
    void documentSession
      .initialize({
        filename: "untitled-flowchart.mmd",
        source: newDocumentSources.flowchart,
      })
      .then(async () => setRetiredSource(await repository.loadRetiredSource()))
      .catch(fail);
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
    const dismissMenus = (event: Event) => {
      const target = event.target;
      const escape = event instanceof KeyboardEvent && event.key === "Escape";
      if (event instanceof KeyboardEvent && !escape) return;
      for (const menu of document.querySelectorAll<HTMLDetailsElement>(
        ".export-menu[open]",
      )) {
        if (escape || (target instanceof Node && !menu.contains(target))) {
          menu.open = false;
          if (escape) menu.querySelector("summary")?.focus();
        }
      }
    };
    const protectUnsaved = (event: BeforeUnloadEvent) => {
      if (documentSession.tabs().some((tab) => documentSession.dirty(tab.id))) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", protectUnsaved);
    const viewport = window.visualViewport;
    const resizeViewport = () => {
      if (viewport?.scale === 1)
        document.documentElement.style.setProperty(
          "--app-height",
          `${viewport.height}px`,
        );
    };
    resizeViewport();
    viewport?.addEventListener("resize", resizeViewport);
    document.addEventListener("pointerdown", dismissMenus);
    document.addEventListener("keydown", dismissMenus);
    return () => {
      window.removeEventListener("beforeunload", protectUnsaved);
      viewport?.removeEventListener("resize", resizeViewport);
      document.documentElement.style.removeProperty("--app-height");
      document.removeEventListener("pointerdown", dismissMenus);
      document.removeEventListener("keydown", dismissMenus);
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
            <small>Diagram editor</small>
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
          <span class="document-title__filename" title={filename()}>
            {filename()}
          </span>
          <Show
            when={
              tabs().find((tab) => tab.id === activeId())?.source !==
              tabs().find((tab) => tab.id === activeId())?.savedSource
            }
          >
            <span class="dirty-badge">Changes since last download</span>
          </Show>
        </div>
        <nav class="topbar__actions" aria-label="Document actions">
          <input
            class="file-input"
            type="file"
            accept=".mmd,.mermaid,text/plain"
            aria-label="Choose diagram file"
            tabindex={-1}
            ref={fileInput}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) {
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
            class="button button--quiet desktop-only"
            type="button"
            onClick={() => setGalleryOpen(true)}
          >
            Examples
          </button>
          <button
            class="button button--quiet"
            type="button"
            disabled={!snapshot()}
            onClick={() => void savePortableDocument()}
          >
            Download .mmd
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
                disabled={!imageExportReady()}
              >
                Download SVG
              </button>
              <button
                type="button"
                onClick={() => void exportPng()}
                disabled={!imageExportReady()}
              >
                Download PNG
              </button>
              <button
                type="button"
                onClick={() => void copyPng()}
                disabled={!imageExportReady()}
              >
                Copy PNG
              </button>
            </div>
          </details>
          <button
            class="button button--quiet mobile-only"
            type="button"
            onClick={() => setGalleryOpen(true)}
          >
            Examples
          </button>
          <button
            class="button button--primary desktop-only"
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
      <div class="document-workspace-bar">
        <div class="document-tabs" role="tablist" aria-label="Open documents">
          <For each={tabs()} keyed={(tab) => tab.id}>
            {(tab) => (
              <div class="document-tab" data-active={tab().id === activeId()}>
                <button
                  type="button"
                  role="tab"
                  id={`document-tab-${tab().id}`}
                  tabindex={tab().id === activeId() ? 0 : -1}
                  aria-controls="workspace"
                  onKeyDown={(event) => {
                    if (
                      !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                        event.key,
                      )
                    )
                      return;
                    event.preventDefault();
                    const list = tabs();
                    const index = list.findIndex(
                      (item) => item.id === tab().id,
                    );
                    const nextIndex =
                      event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? list.length - 1
                          : (index +
                              (event.key === "ArrowRight" ? 1 : -1) +
                              list.length) %
                            list.length;
                    const next = list[nextIndex]!;
                    selectDocument(next.id);
                    requestAnimationFrame(() =>
                      document
                        .getElementById(`document-tab-${next.id}`)
                        ?.focus(),
                    );
                  }}
                  aria-selected={tab().id === activeId() ? "true" : "false"}
                  onClick={() => {
                    selectDocument(tab().id);
                  }}
                >
                  {tab().filename}
                  {tab().source !== tab().savedSource ? " •" : ""}
                </button>
                <button
                  type="button"
                  aria-label={`Close ${tab().filename}`}
                  disabled={tabs().length === 1}
                  onClick={() => closeDocument(tab().id)}
                >
                  ×
                </button>
              </div>
            )}
          </For>
        </div>
        <label class="open-documents-picker mobile-only">
          <span>Open documents ({tabs().length})</span>
          <select
            aria-label={`Open documents (${tabs().length})`}
            value={activeId()}
            onChange={(event) => selectDocument(event.currentTarget.value)}
          >
            <For each={tabs()} keyed={(tab) => tab.id}>
              {(tab) => (
                <option value={tab().id}>
                  {tab().filename}
                  {tab().source !== tab().savedSource
                    ? " — changes since download"
                    : ""}
                </option>
              )}
            </For>
          </select>
        </label>
        <button
          class="button mobile-only close-current-document"
          type="button"
          aria-label="Close active diagram"
          disabled={tabs().length === 1}
          onClick={() => closeDocument(activeId())}
        >
          ×
        </button>
        <details class="export-menu new-document-menu">
          <summary class="button">New</summary>
          <div
            class="export-menu__panel"
            onClick={(event) =>
              event.currentTarget.closest("details")?.removeAttribute("open")
            }
          >
            {(
              [
                ["flowchart", "Flowchart"],
                ["swimlane", "Swimlane"],
                ["c4-context", "C4 context"],
                ["c4-container", "C4 container"],
              ] as const
            ).map(([family, label]) => (
              <button type="button" onClick={() => void newDocument(family)}>
                {label}
              </button>
            ))}
          </div>
        </details>
        <button
          class="button document-workspace-examples"
          type="button"
          onClick={() => setGalleryOpen(true)}
        >
          Examples
        </button>
        <Show when={gettingStartedComplete()}>
          <button
            class="button getting-started-button"
            type="button"
            onClick={() => {
              void newDocument("flowchart").then(() => {
                window.localStorage.removeItem(
                  "manatee:getting-started-complete",
                );
                setGettingStartedComplete(false);
              });
            }}
          >
            Getting started
          </button>
        </Show>
      </div>
      <Show when={galleryOpen()}>
        <ExamplesGallery
          open={(example) => void openExample(example)}
          close={() => setGalleryOpen(false)}
        />
      </Show>
      <Show when={currentExample()}>
        {(example) => (
          <details class="example-guide">
            <summary>About this example: {example().title}</summary>
            <p>{example().notice}</p>
            <strong>Try it</strong>
            <ul>
              <For each={example().try}>
                {(suggestion) => <li>{suggestion}</li>}
              </For>
            </ul>
          </details>
        )}
      </Show>
      <Show when={exportMessage()}>
        <div class="action-feedback">
          <span role="status">{exportMessage()}</span>
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={() => setExportMessage("")}
          >
            ×
          </button>
        </div>
      </Show>
      <StatusNotice status={documentState().status} />
      <Show when={retiredSource()}>
        {(readRetired) => (
          <section class="recovery-banner" aria-label="Retired source recovery">
            <span>
              <strong>Previous BPMN source preserved</strong>
              {readRetired().filename} can be downloaded before it is removed
              from this browser.
            </span>
            <button
              type="button"
              onClick={() => {
                downloadBlob(
                  new Blob([readRetired().source], {
                    type: "application/xml;charset=utf-8",
                  }),
                  readRetired().filename,
                );
              }}
            >
              Download source
            </button>
            <button
              type="button"
              onClick={() => {
                void repository
                  .discardRetiredSource()
                  .then(() => setRetiredSource(undefined))
                  .catch(fail);
              }}
            >
              Discard
            </button>
          </section>
        )}
      </Show>
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
        tabindex={-1}
        data-mobile-view={mobileView()}
        class={{
          workspace: true,
          "workspace--source-open": ui.sourceOpen,
          "workspace--inspector-closed": !ui.inspectorOpen,
        }}
      >
        <Show when={ui.sourceOpen || mobileView() === "source"}>
          <aside
            class={{
              "source-panel": true,
              "mobile-panel-only": !ui.sourceOpen,
            }}
            id="source-panel"
            aria-label="Source"
          >
            <div class="panel-heading">
              <span>
                <span class="eyebrow">Source</span>
                <strong>Diagram text</strong>
              </span>
              <span class="file-badge">MERMAID</span>
            </div>
            <Show when={snapshot()?.sourceEditing === false}>
              <p class="source-scope-notice">
                Mermaid source is protected. Presentation controls remain
                available.{" "}
                <button
                  type="button"
                  onClick={() =>
                    void execute({ type: "set-source-editing", allowed: true })
                  }
                >
                  Enable Mermaid editing
                </button>
              </p>
            </Show>
            <textarea
              ref={sourceEditor}
              aria-label="Diagram source"
              disabled={!snapshot()}
              readonly={snapshot()?.sourceEditing === false}
              title={
                snapshot()?.sourceEditing === false
                  ? "Presentation-only mode. Enable Mermaid source edits in the inspector to edit this text."
                  : undefined
              }
              value={source()}
              spellcheck={false}
              autocapitalize="off"
              autocorrect="off"
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
                {!snapshot()
                  ? "Opening diagram…"
                  : source() !== snapshot()?.source
                    ? "Updating preview…"
                    : !snapshot()?.valid
                      ? "Source has errors"
                      : !snapshot()?.commands.visualEditing
                        ? "Presentation needs attention"
                        : "Preview current"}
              </strong>
              <span>
                {snapshot()?.commands.visualEditing
                  ? "Visual edits are available."
                  : snapshot()?.previewOutdated
                    ? "The canvas keeps the last valid preview."
                    : "Check the diagnostics below to continue editing."}
              </span>
            </div>
            <Show when={(snapshot()?.diagnostics.length ?? 0) > 0}>
              <ul class="diagnostics" aria-label="Document diagnostics">
                <For each={snapshot()?.diagnostics}>
                  {(item) => (
                    <li data-severity={item.severity}>
                      <strong>{item.severity}</strong>
                      <span>
                        {item.message}
                        <Show when={item.range}>
                          {(range) => (
                            <button
                              type="button"
                              class="diagnostic-location"
                              onClick={() => showSourceRange(range())}
                            >
                              Show in source
                            </button>
                          )}
                        </Show>
                        <Show when={item.details}>
                          {(details) => (
                            <details class="diagnostic-details">
                              <summary>Technical details</summary>
                              <code>{details()}</code>
                            </details>
                          )}
                        </Show>
                      </span>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </aside>
        </Show>
        <section class="stage" aria-label="Diagram canvas" ref={stage}>
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
                  const next = Math.max(0.1, zoom() - 0.1);
                  updateFit(false);
                  updateZoom(next);
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
                  updateFit(false);
                  updateZoom(next);
                }}
              >
                +
              </button>
              <button
                type="button"
                aria-label="Fit diagram to screen"
                onClick={() => {
                  updateFit(true);
                }}
              >
                Fit
              </button>
              <button
                type="button"
                aria-label="Show diagram at 100 percent"
                onClick={() => {
                  updateFit(false);
                  updateZoom(1);
                }}
              >
                100%
              </button>
            </div>
          </div>
          <Show
            when={snapshot()}
            fallback={<div class="canvas-loading">Opening diagram…</div>}
          >
            <Show
              when={snapshot()?.scene}
              fallback={
                <div class="canvas-loading">
                  Fix the diagram source to see its preview.
                </div>
              }
            >
              <MermaidSurface
                svg={svg()}
                scene={snapshot()?.scene}
                width={snapshot()?.scene?.width ?? 1}
                height={snapshot()?.scene?.height ?? 1}
                zoom={zoom()}
                fitView={fitView()}
                onZoom={updateZoom}
                disabled={!snapshot()?.commands.visualEditing}
                selectedElementId={snapshot()?.selectedElementId}
                onSelect={(id) =>
                  void execute({ type: "select", elementId: id })
                }
                onNudge={(elementId, dx, dy) =>
                  void execute({ type: "move", elementId, dx, dy })
                }
                sourceEditing={snapshot()?.sourceEditing !== false}
                onSetDock={(elementId, endpoint, dock) =>
                  void execute({
                    type: "set-dock",
                    elementId,
                    endpoint,
                    dock,
                  })
                }
                onReconnect={(elementId, endpoint, nodeId) => {
                  const current = snapshot();
                  const relationship = current?.model?.relationships.find(
                    (candidate) => candidate.id === elementId,
                  );
                  if (!relationship || current?.sourceEditing === false) return;
                  void execute({
                    type: "edit-structure",
                    edit: {
                      action: "relationship",
                      id: relationship.id,
                      ...(relationship.identity.kind === "authored"
                        ? { authoredId: relationship.identity.id }
                        : {}),
                      source:
                        endpoint === "source" ? nodeId : relationship.source,
                      target:
                        endpoint === "target" ? nodeId : relationship.target,
                      label: relationship.label,
                      kind: relationship.kind,
                      technology: relationship.technology,
                      description: relationship.description,
                      directionHint: relationship.directionHint,
                    },
                  });
                }}
              />
              <Show when={emptyFlowchart()}>
                <div class="canvas-empty" aria-labelledby="empty-canvas-title">
                  <div class="canvas-empty__glyph" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </div>
                  <p class="eyebrow">Start a flowchart</p>
                  <h1 id="empty-canvas-title">Turn an idea into a diagram</h1>
                  <p>
                    Add a node visually, paste Mermaid text, or begin from a
                    working example.
                  </p>
                  <div class="canvas-empty__actions">
                    <button
                      class="button button--primary"
                      type="button"
                      onClick={() => void addGuidedNode()}
                    >
                      Add your first node
                    </button>
                    <button
                      class="button"
                      type="button"
                      onClick={() => void focusSourceForPaste()}
                    >
                      Paste Mermaid
                    </button>
                    <button
                      class="button"
                      type="button"
                      onClick={() => setGalleryOpen(true)}
                    >
                      Browse examples
                    </button>
                  </div>
                </div>
              </Show>
              <Show when={inlineLabel()} keyed>
                {(draft) => (
                  <form
                    class="inline-label-editor"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void commitInlineLabel();
                    }}
                  >
                    <label>
                      Node label
                      <input
                        ref={inlineLabelInput}
                        value={draft.value}
                        onInput={(event) =>
                          setInlineLabel({
                            id: draft.id,
                            value: event.currentTarget.value,
                          })
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.preventDefault();
                            setInlineLabel(undefined);
                          }
                        }}
                      />
                    </label>
                    <button type="submit">Apply label</button>
                  </form>
                )}
              </Show>
              <Show
                when={
                  !inlineLabel() && gettingStartedStep() !== "first"
                    ? gettingStartedStep()
                    : undefined
                }
              >
                {(step) => (
                  <aside class="getting-started-card" aria-live="polite">
                    <span class="eyebrow">Getting started</span>
                    <strong>
                      {step() === "second"
                        ? "Add another node"
                        : "Connect your nodes"}
                    </strong>
                    <p>
                      {step() === "second"
                        ? "A useful flowchart needs another step."
                        : "Connect the first two nodes to complete your first flow."}
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        void (step() === "second"
                          ? addGuidedNode()
                          : connectGuidedNodes())
                      }
                    >
                      {step() === "second"
                        ? "Add another node"
                        : "Connect nodes"}
                    </button>
                  </aside>
                )}
              </Show>
            </Show>
          </Show>
          <div class="stage-footer">
            <span>
              {!snapshot()?.scene
                ? "No preview available"
                : snapshot()?.previewOutdated
                  ? "Last valid preview"
                  : source() !== snapshot()?.source
                    ? "Updating preview…"
                    : !snapshot()?.commands.visualEditing
                      ? "Check presentation settings"
                      : "Canvas current"}
            </span>
            <span title="Recovery is stored only in this browser. Download .mmd creates a portable copy.">
              {documentState().workspaceSaving
                ? "Saving browser recovery…"
                : documentState().workspaceSaveFailed
                  ? "Browser recovery failed"
                  : "Recovered locally in this browser"}
            </span>
          </div>
        </section>
        <Show
          when={ui.inspectorOpen || mobileView() === "inspector"}
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
          <aside
            class={{ inspector: true, "mobile-panel-only": !ui.inspectorOpen }}
            id="inspector-panel"
            aria-label="Inspector"
          >
            <div class="panel-heading">
              <span>
                <span class="eyebrow">Inspector</span>
                <strong>Presentation</strong>
              </span>
              <button
                class="icon-button desktop-only"
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
            <Show when={activeId()} keyed>
              {(_id) => (
                <Show when={snapshot()}>
                  {(_readSnapshot) => (
                    <>
                      <details class="document-settings">
                        <summary>Document settings</summary>
                        <label class="document-name-field">
                          Document name
                          <input
                            aria-label="Document name"
                            value={filename()}
                            onChange={(event) => {
                              if (event.currentTarget.value !== filename())
                                fileHandles.delete(activeId());
                              documentSession.rename(event.currentTarget.value);
                            }}
                          />
                        </label>
                      </details>
                    </>
                  )}
                </Show>
              )}
            </Show>
            <Show
              when={snapshot()?.selectedElementId}
              fallback={
                <div class="inspector-empty">
                  <span class="inspector-empty__icon" aria-hidden="true" />
                  <strong>No selection</strong>
                  <p>
                    Select an element on the canvas to change its appearance.
                  </p>
                  <p class="desktop-only">
                    Arrow keys select elements. Alt or Option + arrow moves a
                    selected node.
                  </p>
                </div>
              }
            >
              <div class="selection-summary">
                <span class="eyebrow">Selected</span>
                <strong>{selectedLabel(snapshot())}</strong>
                <code>{snapshot()?.selectedElementId}</code>
              </div>
              <Show when={snapshot()}>
                {(readSnapshot) => (
                  <>
                    <SelectionEssentials
                      snapshot={readSnapshot()}
                      execute={executeStudio}
                    />
                    <PresentationPanel
                      snapshot={readSnapshot()}
                      execute={executeStudio}
                    />
                  </>
                )}
              </Show>
              <Show when={notationOptions(snapshot()).length > 0}>
                <details class="advanced-controls">
                  <summary>Process notation</summary>
                  <fieldset
                    disabled={action("set-notation").state !== "available"}
                    title={actionTitle("set-notation")}
                  >
                    <legend>Notation choice</legend>
                    <label>
                      Symbol{" "}
                      <select
                        aria-label="Process notation"
                        value={selectedNotation(snapshot()) ?? ""}
                        onChange={(event) => {
                          const elementId = snapshot()?.selectedElementId;
                          if (!elementId) return;
                          const notation = event.currentTarget.value
                            ? (event.currentTarget.value as NotationChoice)
                            : undefined;
                          const attachment = boundaryAttachments().find(
                            ({ id }) => id === boundaryAttachment(),
                          );
                          void execute({
                            type: "set-notation",
                            elementId,
                            notation,
                            ...(notation === "boundary-timer" && attachment
                              ? {
                                  boundaryTimer: {
                                    hostId: attachment.hostId,
                                    attachmentRelationshipId: attachment.id,
                                  },
                                }
                              : {}),
                          });
                        }}
                      >
                        <option value="">Ordinary Mermaid</option>
                        <For
                          each={notationOptions(snapshot())}
                          keyed={(option) => option[0]}
                        >
                          {(option) => (
                            <option
                              value={option()[0]}
                              disabled={
                                option()[0] === "boundary-timer" &&
                                boundaryAttachments().length === 0
                              }
                            >
                              {option()[1]}
                            </option>
                          )}
                        </For>
                      </select>
                    </label>
                    <Show
                      when={
                        selectedNotation(snapshot()) === "boundary-timer" &&
                        boundaryAttachments().length > 0
                      }
                    >
                      <label>
                        Timeout task{" "}
                        <select
                          aria-label="Timeout task"
                          value={boundaryAttachment()}
                          onChange={(event) => {
                            const attachmentId = event.currentTarget.value;
                            setBoundaryAttachmentDraft(attachmentId);
                            const elementId = snapshot()?.selectedElementId;
                            const attachment = boundaryAttachments().find(
                              ({ id }) => id === attachmentId,
                            );
                            if (
                              elementId &&
                              attachment &&
                              selectedNotation(snapshot()) === "boundary-timer"
                            ) {
                              void execute({
                                type: "set-notation",
                                elementId,
                                notation: "boundary-timer",
                                boundaryTimer: {
                                  hostId: attachment.hostId,
                                  attachmentRelationshipId: attachment.id,
                                  ...(currentBoundaryTimer()?.anchor
                                    ? {
                                        anchor: currentBoundaryTimer()!.anchor,
                                      }
                                    : {}),
                                },
                              });
                            }
                          }}
                        >
                          <For
                            each={boundaryAttachments()}
                            keyed={(attachment) => attachment.id}
                          >
                            {(attachment) => (
                              <option value={attachment().id}>
                                {attachment().label}
                              </option>
                            )}
                          </For>
                        </select>
                      </label>
                    </Show>
                    <p class="field-help">
                      {selectedNotation(snapshot()) === "boundary-timer"
                        ? "If this task takes too long, the timeout interrupts it and follows the timeout path."
                        : selectedNotation(snapshot()) === "exclusive-gateway"
                          ? "A decision follows one outgoing path."
                          : selectedNotation(snapshot()) === "parallel-gateway"
                            ? "All outgoing paths continue together."
                            : selectedNotation(snapshot()) === "timer-event"
                              ? "The process waits here until the timer finishes."
                              : "Choose how this element communicates its role in the process."}
                    </p>
                    <p class="field-help">
                      Other Mermaid viewers show the same process as a simpler
                      diagram.
                    </p>
                    <Show
                      when={
                        notationOptions(snapshot()).some(
                          ([value]) => value === "boundary-timer",
                        ) && boundaryAttachments().length === 0
                      }
                    >
                      <p class="field-help">
                        For an interrupting timeout, open Structure and add a
                        named connection from the host task to this element,
                        then choose Interrupting timeout.
                      </p>
                    </Show>
                  </fieldset>
                </details>
              </Show>
              <Show when={applicable("move")}>
                <fieldset disabled={action("move").state !== "available"}>
                  <legend>Move selection</legend>
                  <div class="nudge-controls">
                    {(
                      [
                        ["left", -10, 0],
                        ["up", 0, -10],
                        ["down", 0, 10],
                        ["right", 10, 0],
                      ] as const
                    ).map(([direction, dx, dy]) => (
                      <button
                        type="button"
                        aria-label={`Move selection ${direction}`}
                        onClick={() => {
                          const elementId = snapshot()?.selectedElementId;
                          if (elementId)
                            void execute({ type: "move", elementId, dx, dy });
                        }}
                      >
                        {
                          { left: "←", up: "↑", down: "↓", right: "→" }[
                            direction
                          ]
                        }
                      </button>
                    ))}
                  </div>
                </fieldset>
              </Show>
            </Show>
            <Show when={activeId()} keyed>
              {(_id) => (
                <Show when={snapshot()}>
                  {(readSnapshot) => (
                    <StructurePanel
                      snapshot={readSnapshot()}
                      execute={executeStudio}
                      guided={gettingStartedStep() !== undefined}
                    />
                  )}
                </Show>
              )}
            </Show>
          </aside>
        </Show>
      </main>
      <nav
        class="mobile-workspace-nav mobile-only"
        aria-label="Workspace views"
      >
        {(["canvas", "source", "inspector"] as const).map((view) => (
          <button
            type="button"
            aria-pressed={mobileView() === view ? "true" : "false"}
            onClick={() => setMobileView(view)}
          >
            {view === "canvas"
              ? "Canvas"
              : view === "source"
                ? "Source"
                : "Inspector"}
            <Show when={view === "inspector" && snapshot()?.selectedElementId}>
              <span class="selection-indicator" aria-hidden="true" />
            </Show>
          </button>
        ))}
      </nav>
    </div>
  );
}

export default function App() {
  return (
    <Errored
      fallback={(error, reset) => (
        <main class="app-failure" role="alert">
          <span class="eyebrow">Manatee stopped unexpectedly</span>
          <h1>The diagram studio could not continue.</h1>
          <p>{String(error())}</p>
          <button class="button button--primary" type="button" onClick={reset}>
            Try again
          </button>
        </main>
      )}
    >
      <Studio />
    </Errored>
  );
}
