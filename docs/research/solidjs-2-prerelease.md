# SolidJS 2 prerelease practices for Manatee

Research date: 2026-09-10. Sources are the Solid project, its release artifacts, and first-party package metadata.

## Version decision input

The Solid 2 prerelease has advanced from beta to release candidate. The current compatible core pair is `solid-js@2.0.0-rc.7` and `@solidjs/web@2.0.0-rc.7`. The npm `next` tag selects that line; the npm `beta` tag for `solid-js` now points to `1.10.0-beta.0`, so installing `solid-js@beta` would not install Solid 2. The final published Solid 2 beta pair is `2.0.0-beta.34`, but it has been superseded by the RC line. The Solid team describes the RC interface as frozen while still subject to prerelease bugs. Manatee should therefore pin exact versions and upgrade the Solid packages as one tested set. [Solid 2 RC announcement](https://github.com/solidjs/solid/discussions/2995) · [solid-js versions](https://www.npmjs.com/package/solid-js?activeTab=versions) · [@solidjs/web versions](https://www.npmjs.com/package/%40solidjs/web?activeTab=versions)

The aligned browser build stack on the research date is:

| Package | Pin | Role |
| --- | --- | --- |
| `solid-js` | `2.0.0-rc.7` | Reactive core, stores, and control flow |
| `@solidjs/web` | `2.0.0-rc.7` | DOM runtime and JSX types |
| `@solidjs/vite-plugin` | `3.0.0-next.40` | Solid 2 compiler and Vite integration |
| `vite` | `8.2.2` | Development and production build |
| `typescript` | `7.0.2` | Type checking |

`@solidjs/vite-plugin@3.0.0-next.40` requires the RC.7 core/web pair and Vite 8 or 9. It uses Solid's OXC-based compiler by default. The package has been renamed from `vite-plugin-solid` to `@solidjs/vite-plugin`. [Plugin package at the researched revision](https://github.com/solidjs/solid-vite-plugin/blob/09d73a9d6dcacdf1d778a4972cf1efb43b6c6513/package.json) · [Plugin documentation](https://github.com/solidjs/solid-vite-plugin/tree/09d73a9d6dcacdf1d778a4972cf1efb43b6c6513)

## Build shape for Manatee

Use a client-only Solid application with the Vite plugin's start mode:

```ts
import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";

export default defineConfig({
  base: "/manatee/",
  plugins: [solid({ start: true })],
});
```

Start mode owns the entries and document shell. In client mode it produces a static `dist/client/index.html` and client assets suitable for GitHub Pages; no application server is needed. Manatee does not need SolidStart, SSR, server functions, or a router for its single editor screen. [Solid 2 RC start-mode description](https://github.com/solidjs/solid/discussions/2995) · [Vite plugin start-mode documentation](https://github.com/solidjs/solid-vite-plugin/tree/09d73a9d6dcacdf1d778a4972cf1efb43b6c6513#optionsstart)

Configure TypeScript's web JSX owner explicitly:

```json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "@solidjs/web"
  }
}
```

Import reactive primitives, stores, and renderer-neutral component types from `solid-js`. Import `render`, DOM helpers, `JSX`, and DOM component-prop types from `@solidjs/web`. Old `solid-js/web` and `solid-js/store` subpaths are removed. [Solid 2 migration guide at RC.7](https://github.com/solidjs/solid/blob/b1c4399ef726397581374bd9378d9e4596c83dba/documentation/solid-2.0/MIGRATION.md) · [TypeScript and JSX RFC](https://github.com/solidjs/solid/blob/b1c4399ef726397581374bd9378d9e4596c83dba/documentation/solid-2.0/09-typescript-jsx.md)

### Local verification

A throwaway RC.7 application was type-checked and built with the pins above, `solid({ start: true })`, and `base: "/manatee/"`. It emitted `dist/client/index.html` whose asset URL carried the `/manatee/` prefix. The sample exercised `createSignal`/`createMemo`, draft-first `createStore`, a split effect, `onSettled`, `<For>`, and object/array classes. This verifies toolchain compatibility, not Manatee's production behavior.

## Idiomatic Solid 2 rules

The [RC.7 cheatsheet](https://github.com/solidjs/solid/blob/b1c4399ef726397581374bd9378d9e4596c83dba/packages/solid/CHEATSHEET.md) explicitly warns that React and Solid 1.x patterns are common code-generation errors. Manatee should use the following rules in code and review.

### State and derivation

- Keep the framework-neutral document engine as the source of semantic truth. Represent its immutable UI snapshot with a signal. Use a store for genuinely fine-grained, mutable editor UI state such as panel state and selection.
- Derive values with `createMemo`; do not mirror derived values into writable signals.
- Store setters are draft-first: mutate the supplied draft. Use `snapshot(store)` when a plain non-reactive value is needed for persistence or a worker message.
- Updates are automatically microtask-batched. A read immediately after a setter sees the previous committed value. Use the value returned by the document-engine command in application code; reserve `flush()` for tests or rare imperative synchronization.
- Pass signal values into components and read reactive props through `props.name`. Do not pass accessors accidentally and do not destructure reactive props at component scope.

[Signals and ownership RFC](https://github.com/solidjs/solid/blob/b1c4399ef726397581374bd9378d9e4596c83dba/documentation/solid-2.0/02-signals-derived-ownership.md) · [Stores RFC](https://github.com/solidjs/solid/blob/b1c4399ef726397581374bd9378d9e4596c83dba/documentation/solid-2.0/04-stores.md)

### Effects, lifecycle, and asynchronous work

- Use the two-phase `createEffect(compute, apply)` form. The compute function performs tracked reads and returns a plain value; the apply function performs external synchronization and may return cleanup.
- Use `onSettled` for component setup and teardown, returning cleanup from its callback. `onMount` is removed.
- Keep document commands in event handlers or the apply phase of a split effect. Avoid writes while deriving state; Solid 2 development mode reports owned writes as errors.
- Manatee's debounced source-to-worker synchronization should compute the source text, then schedule/cancel the worker request in the effect's apply phase.
- If future UI data is naturally a Promise, use an async `createMemo` with `<Loading>` and `<Errored>`. `createResource`, `Suspense`, and `ErrorBoundary` are Solid 1 APIs.

[Reactivity, batching, and effects RFC](https://github.com/solidjs/solid/blob/b1c4399ef726397581374bd9378d9e4596c83dba/documentation/solid-2.0/01-reactivity-batching-effects.md) · [Async data RFC](https://github.com/solidjs/solid/blob/b1c4399ef726397581374bd9378d9e4596c83dba/documentation/solid-2.0/05-async-data.md)

### Components, lists, DOM, and SVG

- Use `<For>` for identity-preserving lists. Its default form passes an item value and index accessor. With a custom key or `keyed={false}`, read the documented accessor form inside JSX or a memo rather than freezing it in the callback body.
- Use `<Show>`, `<Switch>/<Match>`, `<Loading>`, `<Errored>`, and `<Repeat>` rather than JavaScript map/conditional patterns that discard Solid's granular ownership.
- Use lowercase HTML attributes, camelCase event handlers, and `class` arrays/objects. `classList`, `class:`/`style:` namespaces, and `use:` directives are removed.
- Use `ref` callbacks or two-phase ref directive factories for canvas/SVG measurement, dragging, ResizeObserver, pointer capture, and native listener options. Create reactive primitives in the owned setup phase and perform DOM mutation in the returned unowned callback.
- Keep diagram geometry and SVG scene data outside JSX. Solid components should render the scene declaratively; direct DOM manipulation is limited to interaction mechanics and measurement at refs.

[Control-flow RFC](https://github.com/solidjs/solid/blob/b1c4399ef726397581374bd9378d9e4596c83dba/documentation/solid-2.0/03-control-flow.md) · [DOM RFC](https://github.com/solidjs/solid/blob/b1c4399ef726397581374bd9378d9e4596c83dba/documentation/solid-2.0/07-dom.md)

### Context and module state

- Use a default-less context only for values scoped to a component subtree. In Solid 2, the context itself is the provider; a missing provider already throws.
- Do not add React-style `useX` wrappers solely to repeat a missing-provider check.
- Module-scope signals/stores are the idiomatic form for truly application-wide reactive state. For Manatee, prefer a root-owned editor model passed to the few modules that need it, keeping the document engine free of Solid dependencies.

## Testing and prerelease controls

- Test the document engine through its framework-neutral interface with Vitest. These tests cover source preservation, parsing adapters, metadata reconciliation, layout constraints, routing, and scene generation without mounting Solid.
- Use `@solidjs/testing-library` only for meaningful editor interactions and accessibility behavior. Use Playwright for browser behavior, worker integration, SVG/PNG export, clipboard fallback, file workflows, and the deployed Pages smoke test.
- In tests that intentionally inspect a just-written reactive value, call `flush()` rather than relying on Solid 1's synchronous setter behavior.
- Run Solid development diagnostics in component tests and fail on unexpected diagnostics. The RC adds codes for top-level reactive reads, writes under owned scopes, untracked reads, and multiple Solid copies. [Dev diagnostics RFC](https://github.com/solidjs/solid/blob/b1c4399ef726397581374bd9378d9e4596c83dba/documentation/solid-2.0/08-dev-diagnostics.md)
- Pin the entire prerelease tuple exactly in the lockfile. Upgrade `solid-js`, `@solidjs/web`, and the Vite plugin together only when typecheck, unit, component, browser, export, and deployed smoke checks all pass.

Recommended test pins on the research date are `vitest@5.0.0`, `@solidjs/testing-library@0.8.10`, and `playwright@1.63.0`. These versions were obtained from first-party npm package metadata; they should be rechecked when implementation begins.

## Architecture consequence

Replace React in the proposed architecture with Solid 2 RC.7 and its aligned web/compiler packages. This changes the UI adapter and reactive orchestration, not the deeper rendering architecture: the framework-neutral document engine, version-pinned Mermaid family adapters, YAML source preservation, ELK worker, manual-position reconciliation, orthogonal routing, SVG scene, exports, IndexedDB storage, and GitHub Pages deployment remain valid.

Use Solid as a thin reactive view over document-engine snapshots and commands. Keeping Mermaid, layout, routing, persistence, and export rules outside Solid components prevents prerelease framework churn from reaching the core and makes the most consequential behavior testable without a browser component tree.
