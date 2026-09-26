import { createMemo, createSignal, For, onSettled } from "solid-js";
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
    dialog?.showModal();
    return () => dialog?.close();
  });
  return (
    <dialog
      class="examples-gallery"
      ref={dialog}
      onCancel={props.close}
      aria-label="Example gallery"
    >
      <div class="gallery-heading">
        <div>
          <span class="eyebrow">Learn Manatee</span>
          <h2>Explore what Studio can do</h2>
          <p>
            Each example opens in its own editable document. Your other work
            stays open.
          </p>
        </div>
        <button
          type="button"
          aria-label="Close example gallery"
          onClick={props.close}
        >
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
      </div>
    </dialog>
  );
}
