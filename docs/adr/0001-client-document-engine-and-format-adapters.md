# ADR-0001: Use a client document engine with format adapters

- Status: Accepted
- Date: 2026-09-10
- Decision owners: Manatee maintainers

## Context

Manatee must edit and render four Mermaid 11.17.2 families and BPMN 2.0 process/collaboration diagrams in a static browser application. It must preserve portable text, retain manual presentation after source changes, export slide-ready SVG/PNG, and remain deployable on GitHub Pages. Mermaid and BPMN have different source and rendering models: Mermaid is a text DSL with Manatee YAML front matter, while BPMN XML includes stable model IDs and standard Diagram Interchange geometry.

The UI will use the Solid 2 release candidate. Framework churn must not own parsing, document preservation, layout, routing, persistence, or export behavior.

## Decision

Build one client-only Vite application with a framework-neutral `DocumentEngine` and two document-kind adapters:

- `MermaidDocumentAdapter` delegates family extraction to version-pinned flowchart, swimlane, C4 context, and C4 container adapters. It uses `mermaid@11.17.2` for parsing, `yaml@2.9.x` for source-preserving front matter, `elkjs@0.12.x` in a Web Worker for automatic placement, Manatee routing/reconciliation, and a Manatee SVG scene.
- `BpmnDocumentAdapter` is lazy loaded for `.bpmn`/BPMN XML. It uses `bpmn-js@18.28.0` and `bpmn-moddle@10.2.0`, standard BPMN DI for shared geometry, and a Manatee XML extension for richer presentation. `bpmn-auto-layout@2.0.0-alpha.2` is isolated behind a worker interface for Reset layout and missing-DI recovery, subject to the release corpus.

The UI is a thin Solid adapter over immutable engine snapshots and commands. Pin `solid-js@2.0.0-rc.7`, `@solidjs/web@2.0.0-rc.7`, `@solidjs/vite-plugin@3.0.0-next.40`, `vite@8.2.2`, and `typescript@7.0.2`. Follow the practices recorded in [`docs/research/solidjs-2-prerelease.md`](../research/solidjs-2-prerelease.md).

### Engine boundary

The engine accepts source text and a document hint and returns a snapshot containing document kind, validity, semantic model, presentation model, scene/adapter handle, diagnostics, selected element, dirty state, and command availability. Commands return the next snapshot plus source patches; they do not mutate Solid state or DOM.

The public command set covers source replacement, selection, move, resize, spacing, style/attribute updates, automatic-position removal, Reset layout, cleanup of unmatched settings, undo, and redo. One command transaction owns one undo step. Invalid source retains the last valid preview, marks it outdated, and disables visual commands and image export.

Semantic models use stable authored IDs. Mermaid relationship overrides without IDs use the approved unique `{ source, target, kind }` matcher. BPMN uses standard element IDs and DI references. Adapters map their models into common selection, inspector, persistence, and export capabilities without forcing BPMN into Mermaid's scene model.

### Document session lifetime

A framework-neutral `DocumentSession` owns the active adapter and the ordering of document opens, commands, debounced source edits, presentation completion, autosave recovery, and persistence. Every asynchronous operation is tied to the adapter and document revision that started it, so a delayed result cannot replace a newer document. Commands are serialized with pending source edits, and autosaves are serialized so the newest accepted snapshot is stored last.

The session depends on injected adapter factories, a document store, and an optional presenter callback. The Solid UI subscribes to immutable session state. IndexedDB remains a browser storage adapter, and DOM-dependent BPMN drawing remains in the BPMN surface.

### Source preservation

For Mermaid documents, keep the original text and YAML CST. Untouched saves are byte-identical. Visual commands patch only the top-level `manatee` mapping; text outside it remains byte-identical, and unknown fields/comments inside it survive a rewrite.

For BPMN documents, keep the original XML text and a source-range index alongside the moddle model. Visual commands patch only intended BPMN DI ranges and Manatee extension ranges. Semantic XML, unknown namespaces/extensions, comments, prefixes, and unrelated formatting remain byte-identical. A normal visual save must not replace the document with bpmn-js `saveXML()` output. Direct source edits remain exactly as typed.

If a safe targeted patch cannot be produced, reject that visual command with a diagnostic. Parsing always runs again against the patched source before the command commits.

### Mermaid version-one YAML

The concrete top-level shape is:

```yaml
manatee:
  version: 1
  layout:
    spacing:
      node: 48
      layer: 72
      groupPadding: 24
      lane: 32
  elements:
    nodes:
      payment:
        position: { x: 120, y: 80 }
        attributes: { status: failed }
        style:
          fill: "#ffffff"
          outline: { color: "#2563eb", width: 2, style: solid }
          text: { color: "#111827", size: 16, weight: 600, italic: false }
    relationships:
      byId:
        paymentFailure:
          style: { color: "#dc2626", width: 2, style: dashed }
          text: { color: "#111827", size: 14, weight: 500, italic: false }
      byEndpoints:
        - match: { source: payment, target: retry, kind: arrow }
          style: { color: "#dc2626", width: 2, style: dashed }
    groups: {}
    lanes: {}
  rules:
    - match:
        classes: [critical]
        attributes:
          status: { eq: failed }
      style:
        outline: { color: "#dc2626" }
```

Node, group, and lane keys are authored IDs. A rule `match` may contain `id`, `classes`, and `attributes`; every present condition must pass. Each attribute predicate contains exactly one of `eq`, `in`, `gt`, `gte`, `lt`, `lte`, or `exists`. `gt`/`gte`/`lt`/`lte` require finite numbers, `in` is a non-empty scalar array, and `exists` is boolean. Attribute values are strings, finite numbers, or booleans. Unknown operators and invalid types are preserved and diagnosed.

Colours use CSS hex notation for version one. Width and size are finite positive numbers. Weight is `400` through `700`; line/outline style is `solid`, `dashed`, or `dotted`. Positions and spacing are finite non-negative CSS-pixel numbers. Optional properties are applied property-by-property using the approved precedence: defaults, supported Mermaid styling, matching rules in document order, then manual element overrides.

Maintain [`docs/schema/manatee-v1.schema.json`](../schema/manatee-v1.schema.json), a checked JSON Schema 2020-12 document, as the validation source of truth. Validation produces precise YAML paths and never removes unknown fields. TypeScript types mirror the checked schema and are verified by schema fixtures; runtime code consumes the validated projection while the CST remains the persistence source.

### BPMN presentation extension

Attach one `manatee:presentation` element with `version="1"` under the BPMN definitions extension elements. It mirrors the layout, attributes, element-style, and rule concepts above using namespaced XML elements and `ref` attributes pointing to BPMN IDs. Standard BPMN DI remains authoritative for bounds and waypoints; the Manatee extension does not duplicate them. Preserve unknown Manatee elements/attributes/comments while changing known settings.

The extension descriptor is registered with bpmn-moddle. Unsupported third-party colour extensions are preserved; recognized bpmn.io fill/stroke colours participate at the imported-style precedence level. Manatee makes no claim that richer styles survive in tools that ignore its namespace.

### Layout and rendering

For Mermaid, automatic layout runs in a worker. Manual positions are container-local constraints. New elements lay out around those constraints, containers expand where possible, and unresolved overlaps are warnings. Manatee owns orthogonal post-drag relationship routing and uses the same SVG scene for preview and export.

For BPMN, imported DI is the initial layout. bpmn-js owns BPMN notation, canvas interaction, and SVG generation. Geometry-changing bpmn-js commands are translated into targeted DI patches. Reset layout invokes the isolated BPMN layout worker, replaces the diagram's DI as one undoable command, and retains semantic XML and Manatee style/attribute data. The editor and exported SVG retain the visible bpmn.io attribution required by its license.

### Application and storage

Use the approved Studio layout: canvas first, floating inspector, source panel on demand. Mount imperative BPMN and editor surfaces through Solid 2 ref directives and clean them up with `onSettled`. Lazy load BPMN code only for BPMN documents.

Autosave source, document kind, filename, and last-valid recovery state in IndexedDB. Prefer the File System Access API when available for an explicitly opened handle; always provide open-via-file-input and download fallbacks. No backend or account is required.

SVG export uses the active adapter's SVG with embedded styles/fonts where licensing permits. PNG export rasterizes that SVG at a user-visible high-resolution scale with a solid/transparent background choice. Clipboard copy uses the PNG blob and falls back to download when permissions or browser support prevent writing.

### Validation and release

Use Vitest for engine/schema/adapter fixtures and Playwright for Chromium, Firefox, and WebKit interaction/export workflows. GitHub Actions runs type checking, unit/integration tests, production build, browser tests, and then deploys `dist/client` to Pages. A deployed smoke test opens each family, edits source, performs one visual change, reloads autosave, and downloads SVG/PNG.

The release corpus contains exact positive and negative fixtures for the approved Mermaid syntax and BPMN process/collaboration boundary, source-preservation fixtures, invalid/outdated preview recovery, unmatched cleanup/undo, nested movement, styling precedence, layout conflicts, and unknown-version/content handling. Representative output is checked in current PowerPoint and Google Slides.

Support the latest two desktop releases of Chrome, Edge, Firefox, and Safari. Editing on mobile is outside release one. The representative ceiling is 100 elements, 150 relationships, and 10 groups or 8 lanes. Post-drag rerouting must settle within 250 ms and a representative full render within 2 seconds on the CI reference machine. All supported-family round trips and metadata/source-preservation checks block release.

## Consequences

The architecture keeps Solid prerelease risk at the UI boundary and makes format behavior independently testable. Mermaid exports share one custom renderer, while BPMN uses its mature standard-specific renderer; visual details can differ, but both use the same Studio workflow and slide-export acceptance criteria.

BPMN adds a second parser, renderer, source-preservation strategy, license obligation, lazy chunk, and validation corpus. Automatic BPMN layout depends on a pinned prerelease and therefore has an explicit spike and fallback work item before release. Source-range patching is deeper than whole-document serialization, but it is required to uphold the accepted preservation contract.
