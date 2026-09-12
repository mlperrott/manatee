# Manatee

Manatee is a browser-based presentation editor for portable Mermaid and BPMN diagrams. Use the public Studio at [mlperrott.github.io/manatee](https://mlperrott.github.io/manatee/); editing and autosave stay in the browser and require no account.

Supported syntax, portability rules, browser targets, and release evidence are documented in [the release guide](docs/release.md).

## Development

Requires Node.js 24 LTS or Node.js 26 and newer, plus pnpm 11.19.0. Node.js 25
is outside Vitest's declared support range.

```sh
pnpm install
pnpm dev
```

The local development application is served at `http://127.0.0.1:4173/`.

Run the complete source and production-build verification with:

```sh
pnpm verify
```

Install Chromium once and run the browser smoke test with:

```sh
pnpm exec playwright install chromium
pnpm test:browser
```

The production build uses Solid's client start mode and is emitted to
`dist/client` for GitHub Pages. Local development uses the equivalent Vite SPA
entry as a temporary workaround for a 404 in the RC client-start development
middleware.

## Structure

- `src/core` — framework-neutral document engine and source-preserving metadata codecs.
- `src/adapters` — Mermaid and BPMN document adapter boundaries.
- `src/workers` — layout worker contracts and implementations.
- `src/persistence` — browser document storage.
- `src/export` — SVG, PNG, and clipboard export.
- `src/app` — Solid UI state and components.

See [ADR-0001](docs/adr/0001-client-document-engine-and-format-adapters.md) for the accepted first-release architecture.
