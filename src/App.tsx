import {
  createMemo,
  createSignal,
  lazy,
  Loading,
  onSettled,
  Show,
} from "solid-js";
import { createStore } from "solid-js";

import type {
  BpmnCanvas,
  BpmnGeometryChange,
} from "./adapters/bpmn/BpmnCanvas";
import type {
  BpmnDocumentAdapter,
  BpmnDocumentSnapshot,
} from "./adapters/bpmn/BpmnDocumentAdapter";
import {
  MermaidDocumentAdapter,
  MermaidLayout,
  renderMermaidSvg,
  type MermaidDocumentSnapshot,
  type MermaidScene,
} from "./adapters/mermaid";
import { initialEditorUiState, sourceToggleLabel } from "./app/editorUiState";
import { MermaidSurface } from "./app/MermaidSurface";
import { StatusNotice } from "./app/StatusNotice";
import {
  findUnmatchedMetadata,
  patchManateeMetadata,
} from "./core/metadata/manateeMetadata";
import type { MetadataEdit, MetadataValue } from "./core/metadata/types";
import {
  copyPngOrDownload,
  downloadBlob,
  portableFilename,
  rasterizeSvg,
} from "./export/DiagramExporter";
import {
  IndexedDbDocumentRepository,
  type SavedDocument,
} from "./persistence/DocumentRepository";
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

type ActiveAdapter = MermaidDocumentAdapter | BpmnDocumentAdapter;
type ActiveSnapshot = MermaidDocumentSnapshot | BpmnDocumentSnapshot;

function selectedLabel(current: ActiveSnapshot | undefined): string {
  const id = current?.selectedElementId;
  if (!current || !id) return "No selection";
  if (current.kind === "bpmn") {
    const bpmn = current as BpmnDocumentSnapshot;
    return (
      bpmn.semanticModel?.elements.find((item) => item.id === id)?.name || id
    );
  }
  const mermaid = current as MermaidDocumentSnapshot;
  return (
    mermaid.semanticModel?.nodes.find((item) => item.id === id)?.label ??
    mermaid.semanticModel?.groups.find((item) => item.id === id)?.label ??
    mermaid.semanticModel?.relationships.find((item) => item.id === id)
      ?.label ??
    id
  );
}

export default function App() {
  const [ui, setUi] = createStore(initialEditorUiState());
  const [snapshot, setSnapshot] = createSignal<ActiveSnapshot>();
  const [source, setSource] = createSignal(mermaidExample);
  const [scene, setScene] = createSignal<MermaidScene>();
  const [zoom, setZoom] = createSignal(1);
  const [fill, setFill] = createSignal("#e0f0ec");
  const [stroke, setStroke] = createSignal("#2d817c");
  const [attributeName, setAttributeName] = createSignal("owner");
  const [attributeValue, setAttributeValue] = createSignal("operations");
  const [filename, setFilename] = createSignal("request-flow.mmd");
  const [recovery, setRecovery] = createSignal<SavedDocument>();
  const [pngScale, setPngScale] = createSignal(2);
  const [pngBackground, setPngBackground] = createSignal<
    "#ffffff" | "transparent"
  >("#ffffff");
  const [exportMessage, setExportMessage] = createSignal("");
  const layout = new MermaidLayout();
  const repository = new IndexedDbDocumentRepository();
  let adapter: ActiveAdapter = new MermaidDocumentAdapter();
  let bpmnCanvas: BpmnCanvas | undefined;
  let stage: HTMLElement | undefined;
  let sourceTimer: ReturnType<typeof setTimeout> | undefined;
  let fileInput: HTMLInputElement | undefined;
  let fileHandle: FileSystemFileHandle | undefined;
  let lastValidSource = mermaidExample;
  let persistenceReady = false;
  let revision = 0;
  let ignoreBpmnGeometry = true;

  const svg = createMemo(() => {
    const current = snapshot();
    const currentScene = scene();
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

  const fail = (error: unknown) => {
    setUi((draft) => {
      draft.status = {
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      };
    });
  };

  const present = async (next: ActiveSnapshot) => {
    const currentRevision = ++revision;
    setSnapshot(next);
    setSource(next.source);
    if (next.valid) lastValidSource = next.source;
    if (next.kind === "mermaid" && next.semanticModel) {
      const mermaid = next as MermaidDocumentSnapshot;
      const nextScene = await layout.layout({
        model: mermaid.semanticModel!,
        metadata: mermaid.presentationModel?.metadata,
      });
      if (revision === currentRevision) setScene(nextScene);
    } else if (
      next.kind === "bpmn" &&
      next.valid &&
      bpmnCanvas?.source() !== next.source
    ) {
      const bpmn = next as BpmnDocumentSnapshot;
      ignoreBpmnGeometry = true;
      await bpmnCanvas?.importSource(next.source, bpmn.presentationModel);
      queueMicrotask(() => {
        ignoreBpmnGeometry = false;
      });
    }
    setUi((draft) => {
      draft.status = { kind: "ready" };
    });
    if (persistenceReady) {
      void repository
        .save({
          filename: filename(),
          kind: next.kind,
          source: next.source,
          lastValidSource,
          savedAt: Date.now(),
        })
        .catch(fail);
    }
  };

  const execute = async (command: Parameters<ActiveAdapter["execute"]>[0]) => {
    try {
      const result = await adapter.execute(command);
      await present(result.snapshot as ActiveSnapshot);
    } catch (error) {
      fail(error);
    }
  };

  const openMermaid = async () => {
    if ("dispose" in adapter) adapter.dispose();
    adapter = new MermaidDocumentAdapter();
    bpmnCanvas = undefined;
    setZoom(1);
    setFilename("request-flow.mmd");
    fileHandle = undefined;
    setUi((draft) => {
      draft.status = { kind: "loading", message: "Opening Mermaid example…" };
    });
    await present(await adapter.open(mermaidExample, { kind: "mermaid" }));
  };

  const openBpmn = async () => {
    if ("dispose" in adapter) adapter.dispose();
    setScene(undefined);
    bpmnCanvas = undefined;
    setZoom(1);
    setFilename("review-process.bpmn");
    fileHandle = undefined;
    setUi((draft) => {
      draft.status = { kind: "loading", message: "Opening BPMN example…" };
    });
    try {
      const [{ BpmnDocumentAdapter }, fixture] = await Promise.all([
        import("./adapters/bpmn/BpmnDocumentAdapter"),
        import("./adapters/bpmn/fixtures/process-missing-di.bpmn?raw"),
      ]);
      const bpmn = new BpmnDocumentAdapter();
      adapter = bpmn;
      await bpmn.open(fixture.default, { kind: "bpmn" });
      await present(await bpmn.recoverMissingDi());
    } catch (error) {
      fail(error);
    }
  };

  const openPortableDocument = async (
    documentSource: string,
    documentFilename: string,
    kind: "mermaid" | "bpmn",
    recoverySource?: string,
  ) => {
    if ("dispose" in adapter) adapter.dispose();
    bpmnCanvas = undefined;
    setScene(undefined);
    setFilename(documentFilename);
    setZoom(1);
    setUi((draft) => {
      draft.status = {
        kind: "loading",
        message: `Opening ${documentFilename}…`,
      };
    });
    try {
      if (kind === "mermaid") {
        const mermaid = new MermaidDocumentAdapter();
        adapter = mermaid;
        const opened = await mermaid.open(recoverySource ?? documentSource, {
          kind,
          filename: documentFilename,
        });
        await present(
          recoverySource && recoverySource !== documentSource
            ? await mermaid.replaceSource(documentSource)
            : opened,
        );
      } else {
        const { BpmnDocumentAdapter } =
          await import("./adapters/bpmn/BpmnDocumentAdapter");
        const bpmn = new BpmnDocumentAdapter();
        adapter = bpmn;
        await bpmn.open(recoverySource ?? documentSource, {
          kind,
          filename: documentFilename,
        });
        const opened =
          recoverySource && recoverySource !== documentSource
            ? await bpmn.replaceSource(documentSource)
            : await bpmn.recoverMissingDi();
        await present(opened);
      }
    } catch (error) {
      fail(error);
    }
  };

  const openFile = async (file: File) => {
    const documentSource = await file.text();
    const kind =
      file.name.toLowerCase().endsWith(".bpmn") ||
      /<(?:\w+:)?definitions\b/u.test(documentSource)
        ? "bpmn"
        : "mermaid";
    await openPortableDocument(documentSource, file.name, kind);
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
      fileHandle = handle;
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

  const recoverAutosave = async () => {
    const saved = recovery();
    if (!saved) return;
    persistenceReady = true;
    setRecovery(undefined);
    lastValidSource = saved.lastValidSource ?? saved.source;
    await openPortableDocument(
      saved.source,
      saved.filename,
      saved.kind,
      saved.lastValidSource,
    );
  };

  const discardAutosave = async () => {
    await repository.clear();
    setRecovery(undefined);
    persistenceReady = true;
    await openMermaid();
  };

  const replaceSource = (value: string) => {
    setSource(value);
    if (sourceTimer) clearTimeout(sourceTimer);
    sourceTimer = setTimeout(() => {
      void adapter
        .replaceSource(value)
        .then((next) => present(next as ActiveSnapshot))
        .catch(fail);
    }, 180);
  };

  const editMermaid = async (edits: readonly MetadataEdit[]) => {
    if (!(adapter instanceof MermaidDocumentAdapter)) return;
    const patched = patchManateeMetadata(adapter.snapshot().source, edits);
    await execute({
      type: "apply-patches",
      patches: patched.patches,
      reason: "visual",
    });
  };

  const nudge = async (id: string, dx: number, dy: number) => {
    const currentScene = scene();
    if (!currentScene) return;
    const node = currentScene.nodes.find((item) => item.id === id);
    const group = currentScene.groups.find((item) => item.id === id);
    const item = node ?? group;
    if (!item) return;
    await editMermaid([
      {
        type: "set",
        path: ["elements", node ? "nodes" : "groups", id, "position"],
        value: {
          x: Math.max(0, Math.round(item.x + dx)),
          y: Math.max(0, Math.round(item.y + dy)),
        },
      },
    ]);
  };

  const styleSelection = async () => {
    const current = snapshot();
    const id = current?.selectedElementId;
    if (!current || !id || !current.commands.visualEditing) return;
    if (current.kind === "bpmn" && "style" in adapter) {
      try {
        await present(
          (await adapter.style(id, { fill: fill(), stroke: stroke() }))
            .snapshot,
        );
      } catch (error) {
        fail(error);
      }
      return;
    }
    if (current.kind !== "mermaid") return;
    const mermaid = current as MermaidDocumentSnapshot;
    const node = mermaid.semanticModel?.nodes.some((item) => item.id === id);
    const group = mermaid.semanticModel?.groups.some((item) => item.id === id);
    if (node || group) {
      await editMermaid([
        {
          type: "set",
          path: ["elements", node ? "nodes" : "groups", id, "style", "fill"],
          value: fill(),
        },
        {
          type: "set",
          path: [
            "elements",
            node ? "nodes" : "groups",
            id,
            "style",
            "outline",
            "color",
          ],
          value: stroke(),
        },
      ]);
    } else {
      await editMermaid([
        {
          type: "set",
          path: ["elements", "relationships", "byId", id, "style", "color"],
          value: stroke(),
        },
      ]);
    }
  };

  const resetLayout = async () => {
    const current = snapshot();
    if (!current?.commands.visualEditing) return;
    if (current.kind === "bpmn" && "resetLayout" in adapter) {
      try {
        await present((await adapter.resetLayout()).snapshot);
      } catch (error) {
        fail(error);
      }
      return;
    }
    if (current.kind === "mermaid" && current.semanticModel) {
      const mermaid = current as MermaidDocumentSnapshot;
      await editMermaid([
        ...mermaid.semanticModel!.nodes.map(({ id }) => ({
          type: "remove" as const,
          path: ["elements", "nodes", id, "position"] as const,
        })),
        ...mermaid.semanticModel!.groups.map(({ id }) => ({
          type: "remove" as const,
          path: ["elements", "groups", id, "position"] as const,
        })),
      ]);
    }
  };

  const cleanUnused = async () => {
    const current = snapshot();
    if (current?.kind !== "mermaid" || !current.semanticModel) return;
    const mermaid = current as MermaidDocumentSnapshot;
    const model = mermaid.semanticModel!;
    const unused = findUnmatchedMetadata(mermaid.presentationModel?.metadata, {
      nodes: new Set(model.nodes.map(({ id }) => id)),
      groups: new Set(
        model.groups.filter(({ kind }) => kind !== "lane").map(({ id }) => id),
      ),
      lanes: new Set(
        model.groups.filter(({ kind }) => kind === "lane").map(({ id }) => id),
      ),
      relationships: new Set(model.relationships.map(({ id }) => id)),
      relationshipMatchers: new Set(),
    });
    if (unused.edits.length > 0) await editMermaid(unused.edits);
  };

  const useAutomaticPosition = async () => {
    const current = snapshot();
    const id = current?.selectedElementId;
    if (current?.kind !== "mermaid" || !id) return;
    const mermaid = current as MermaidDocumentSnapshot;
    const category = mermaid.semanticModel?.nodes.some((item) => item.id === id)
      ? "nodes"
      : "groups";
    await editMermaid([
      { type: "remove", path: ["elements", category, id, "position"] },
    ]);
  };

  const geometryChanged = (changes: readonly BpmnGeometryChange[]) => {
    const current = snapshot() as BpmnDocumentSnapshot | undefined;
    const id = current?.selectedElementId;
    if (
      ignoreBpmnGeometry ||
      current?.kind !== "bpmn" ||
      !id ||
      !("moveOrResize" in adapter)
    )
      return;
    const change = changes.find((item) => item.elementId === id);
    const shapeBefore = current.presentationModel?.shapes[id]?.bounds;
    const edgeBefore = current.presentationModel?.edges[id]?.waypoints;
    const operation = change?.bounds
      ? shapeBefore &&
        shapeBefore.x === change.bounds.x &&
        shapeBefore.y === change.bounds.y &&
        shapeBefore.width === change.bounds.width &&
        shapeBefore.height === change.bounds.height
        ? undefined
        : adapter.moveOrResize(id, change.bounds)
      : change?.waypoints &&
          JSON.stringify(edgeBefore) !== JSON.stringify(change.waypoints)
        ? adapter.route(id, change.waypoints)
        : undefined;
    if (!operation) return;
    ignoreBpmnGeometry = true;
    void operation
      .then(({ snapshot: next }) => present(next))
      .catch(fail)
      .finally(() => {
        ignoreBpmnGeometry = false;
      });
  };

  onSettled(() => {
    void repository
      .load()
      .then(async (saved) => {
        if (saved) {
          setRecovery(saved);
          await openMermaid();
        } else {
          persistenceReady = true;
          await openMermaid();
        }
      })
      .catch((error) => {
        persistenceReady = true;
        fail(error);
        void openMermaid();
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
      if (sourceTimer) clearTimeout(sourceTimer);
      layout.dispose();
      if ("dispose" in adapter) adapter.dispose();
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
      <StatusNotice status={ui.status} />
      <Show when={recovery()}>
        {(readSaved) => (
          <section class="recovery-banner" aria-label="Autosave recovery">
            <span>
              <strong>Recover autosaved work?</strong>
              {readSaved().filename} was edited in this browser.
            </span>
            <button type="button" onClick={() => void recoverAutosave()}>
              Recover
            </button>
            <button type="button" onClick={() => void discardAutosave()}>
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
              onInput={(event) => replaceSource(event.currentTarget.value)}
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
                onClick={() => void resetLayout()}
                disabled={!snapshot()?.commands.visualEditing}
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
                    onGeometryChange={geometryChanged}
                    onReady={(canvas) => {
                      bpmnCanvas = canvas;
                      ignoreBpmnGeometry = false;
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
                onNudge={(id, dx, dy) => void nudge(id, dx, dy)}
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
              <fieldset disabled={!snapshot()?.commands.visualEditing}>
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
              <Show when={snapshot()?.kind === "mermaid"}>
                <fieldset disabled={!snapshot()?.commands.visualEditing}>
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
                        void editMermaid([
                          {
                            type: "set",
                            path: [
                              "elements",
                              "nodes",
                              id,
                              "attributes",
                              attributeName(),
                            ],
                            value: attributeValue() as MetadataValue,
                          },
                        ]);
                    }}
                  >
                    Set attribute
                  </button>
                  <button
                    class="button button--quiet-dark"
                    type="button"
                    onClick={() => {
                      const name = attributeName();
                      if (name)
                        void editMermaid([
                          {
                            type: "set",
                            path: ["rules"],
                            value: [
                              {
                                match: {
                                  attributes: {
                                    [name]: { eq: attributeValue() },
                                  },
                                },
                                style: {
                                  fill: fill(),
                                  outline: { color: stroke() },
                                },
                              },
                            ],
                          },
                        ]);
                    }}
                  >
                    Create matching rule
                  </button>
                </fieldset>
                <fieldset disabled={!snapshot()?.commands.visualEditing}>
                  <legend>Layout settings</legend>
                  <label>
                    Node spacing{" "}
                    <input
                      type="range"
                      min="24"
                      max="96"
                      value="48"
                      onChange={(event) =>
                        void editMermaid([
                          {
                            type: "set",
                            path: ["layout", "spacing", "node"],
                            value: Number(event.currentTarget.value),
                          },
                        ])
                      }
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
                        void editMermaid([
                          {
                            type: "set",
                            path: ["layout", "spacing", "layer"],
                            value: Number(event.currentTarget.value),
                          },
                        ])
                      }
                    />
                  </label>
                  <button
                    class="button button--secondary"
                    type="button"
                    onClick={() => void useAutomaticPosition()}
                  >
                    Use automatic position
                  </button>
                  <button
                    class="button button--quiet-dark"
                    type="button"
                    onClick={() => void cleanUnused()}
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
