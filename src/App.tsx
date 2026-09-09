import { createEffect, createMemo, onSettled, Show } from "solid-js";
import { createStore } from "solid-js";

import { initialEditorUiState, sourceToggleLabel } from "./app/editorUiState";
import { StatusNotice } from "./app/StatusNotice";
import "./app.css";

export default function App() {
  const [ui, setUi] = createStore(initialEditorUiState());
  const toggleLabel = createMemo(() => sourceToggleLabel(ui.sourceOpen));
  let stage: HTMLElement | undefined;

  const toggleSource = () => {
    setUi((draft) => {
      draft.sourceOpen = !draft.sourceOpen;
    });
  };

  const toggleInspector = () => {
    setUi((draft) => {
      draft.inspectorOpen = !draft.inspectorOpen;
    });
  };

  createEffect(
    () => ui.sourceOpen,
    (sourceOpen) => {
      document.documentElement.dataset.sourcePanel = sourceOpen
        ? "open"
        : "closed";

      return () => {
        delete document.documentElement.dataset.sourcePanel;
      };
    },
  );

  onSettled(() => {
    if (!stage) return;

    const updateStageWidth = () => {
      const width = Math.round(stage?.getBoundingClientRect().width ?? 0);
      setUi((draft) => {
        draft.stageWidth = width;
      });
    };
    const observer = new ResizeObserver(updateStageWidth);
    observer.observe(stage);
    updateStageWidth();

    return () => observer.disconnect();
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
          <span class="document-title__dot" aria-hidden="true" />
          Untitled diagram
        </div>

        <nav class="topbar__actions" aria-label="Document actions">
          <button class="button button--quiet" type="button" disabled>
            Open
          </button>
          <button class="button button--quiet" type="button" disabled>
            Export
          </button>
          <button
            class="button button--primary"
            type="button"
            aria-expanded={ui.sourceOpen ? "true" : "false"}
            aria-controls="source-panel"
            onClick={toggleSource}
          >
            {toggleLabel()}
          </button>
        </nav>
      </header>

      <StatusNotice status={ui.status} />

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
              <span class="file-badge">MERMAID / BPMN</span>
            </div>
            <textarea
              aria-label="Diagram source"
              disabled
              placeholder="The document engine will attach here."
            />
            <p class="panel-note">
              Source editing becomes available when a document is open.
            </p>
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
              Canvas
              <Show when={ui.stageWidth > 0}>
                <span class="stage-toolbar__measure">
                  {ui.stageWidth}px workspace
                </span>
              </Show>
            </span>
            <div class="segmented" aria-label="Zoom controls">
              <button type="button" disabled aria-label="Zoom out">
                −
              </button>
              <span>100%</span>
              <button type="button" disabled aria-label="Zoom in">
                +
              </button>
            </div>
          </div>

          <div class="canvas-empty">
            <div class="canvas-empty__glyph" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <p class="eyebrow">Ready for a document</p>
            <h1>Turn diagram source into a clear story.</h1>
            <p>
              Open a Mermaid or BPMN file to begin. Your source stays portable
              while Manatee manages its presentation.
            </p>
            <button class="button button--primary" type="button" disabled>
              Open a diagram
            </button>
          </div>

          <div class="stage-footer">
            <span>Canvas ready</span>
            <span>Local browser workspace</span>
          </div>
        </section>

        <Show when={ui.inspectorOpen}>
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
                onClick={toggleInspector}
              >
                ×
              </button>
            </div>

            <div class="inspector-empty">
              <span class="inspector-empty__icon" aria-hidden="true" />
              <strong>No selection</strong>
              <p>Select an element to adjust its position and appearance.</p>
            </div>

            <fieldset disabled>
              <legend>Layout</legend>
              <label>
                Node spacing
                <input type="range" min="24" max="96" value="48" />
              </label>
              <label>
                Layer spacing
                <input type="range" min="32" max="128" value="72" />
              </label>
            </fieldset>

            <fieldset disabled>
              <legend>Appearance</legend>
              <div class="swatch-row">
                <span>Fill</span>
                <span class="swatch swatch--fill" />
              </div>
              <div class="swatch-row">
                <span>Outline</span>
                <span class="swatch swatch--outline" />
              </div>
            </fieldset>
          </aside>
        </Show>

        <Show when={!ui.inspectorOpen}>
          <button
            class="inspector-restore"
            type="button"
            onClick={toggleInspector}
          >
            Show inspector
          </button>
        </Show>
      </main>
    </div>
  );
}
