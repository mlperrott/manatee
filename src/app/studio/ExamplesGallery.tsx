import { createMemo, createSignal, For, onSettled, Show } from "solid-js";
import { studioExamples, type StudioExample } from "./examples";
export function ExamplesGallery(props: {
  open: (example: StudioExample) => void;
  close: () => void;
}) {
  // Assigned by Solid's bare-ref transform from ref={dialog}.
  // oxlint-disable-next-line no-unassigned-vars
  let dialog: HTMLDialogElement | undefined;
  const [filter, setFilter] = createSignal("");
  const examples = createMemo(() => {
    const query = filter().trim().toLowerCase();
    return studioExamples.filter((example) =>
      `${example.title} ${example.category} ${example.description} ${example.notice}`
        .toLowerCase()
        .includes(query),
    );
  });
  onSettled(() => {
    // Open after the new dialog's DOM has settled, so focus and modal layout
    // do not force a synchronous layout during the reactive render.
    const frame = requestAnimationFrame(() => dialog?.showModal());
    return () => {
      cancelAnimationFrame(frame);
      dialog?.close();
    };
  });
  return (
    <dialog
      class="examples-gallery"
      ref={dialog}
      onCancel={props.close}
      aria-label="Examples"
    >
      <div class="gallery-heading">
        <div>
          <span class="eyebrow">Learn Manatee</span>
          <h2>Explore what Manatee can do</h2>
          <p>
            Examples open as editable documents. An untouched blank is reused;
            other work stays open.
          </p>
        </div>
        <button type="button" aria-label="Close examples" onClick={props.close}>
          ×
        </button>
      </div>
      <label>
        Find an example
        <input
          type="search"
          aria-label="Find an example"
          value={filter()}
          onInput={(event) => setFilter(event.currentTarget.value)}
          placeholder="BPMN, C4, typography, rules…"
        />
      </label>
      <p class="gallery-result-count" role="status" aria-live="polite">
        {examples().length} {examples().length === 1 ? "example" : "examples"}
      </p>
      <div class="example-grid">
        <For each={examples()}>
          {(example) => (
            <article class={["example-card", `example-card--${example.id}`]}>
              <span class="eyebrow">{example.category}</span>
              <h3>{example.title}</h3>
              <p>{example.description}</p>
              <button type="button" onClick={() => props.open(example)}>
                Open {example.title}
              </button>
            </article>
          )}
        </For>
        <Show when={examples().length === 0}>
          <div class="gallery-empty">
            <strong>No examples match “{filter().trim()}”</strong>
            <p>Try a broader term or show every example again.</p>
            <button type="button" onClick={() => setFilter("")}>
              Clear search
            </button>
          </div>
        </Show>
      </div>
    </dialog>
  );
}
