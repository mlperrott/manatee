# BPMN compatibility and architecture input

Research date: 2026-09-10. Sources are the OMG specification, Mermaid's official documentation and repository, and the bpmn.io projects and package metadata.

## Finding

Manatee should treat BPMN as a second source format, not as another Mermaid family. Mermaid 11.17.2 does not implement BPMN: BPMN is absent from the official diagram syntax list, and Mermaid's own repository still tracks native BPMN as an open new-diagram proposal. A Manatee-specific Mermaid-like BPMN grammar would lose interchange with BPMN tools and make Manatee responsible for a large semantic language. [Mermaid 11.17.2 syntax reference](https://mermaid.js.org/intro/syntax-reference.html) · [Mermaid native BPMN proposal](https://github.com/mermaid-js/mermaid/issues/7699)

Use BPMN 2.0 XML in `.bpmn` files as the portable source. The OMG standard defines the process model and BPMN Diagram Interchange (BPMN DI) in the same XML package. BPMN DI associates shapes and edges with model elements, stores bounds and waypoints, and is explicitly intended to exchange laid-out diagrams between tools. It does not standardize styling or prove semantic correctness. [OMG BPMN 2.0.2 specification and schemas](https://www.omg.org/spec/BPMN/2.0.2/About-BPMN) · [BPMN 2.0.2, Diagram Interchange](https://www.omg.org/spec/BPMN/2.0.2/PDF)

This choice has three practical consequences:

- BPMN element `id` values are authored identities. Manatee does not need the Mermaid reconciliation heuristic for well-formed BPMN elements.
- Manual shape positions and connection waypoints belong in standard BPMN DI so other BPMN tools can see them.
- Manatee-specific presentation settings need an XML extension namespace because BPMN DI does not exchange color or other tool-specific styling.

## Recommended browser stack

Use `bpmn-js@18.28.0` as a lazily loaded BPMN adapter. It is a browser viewer and modeler built on `diagram-js` and `bpmn-moddle`; it imports BPMN XML, applies BPMN modeling rules, renders the notation, and exports both BPMN XML and SVG. This avoids reimplementing the BPMN symbol set, connection rules, label placement, interaction model, and SVG export. [bpmn-js package](https://www.npmjs.com/package/bpmn-js) · [bpmn-js walkthrough](https://bpmn.io/toolkit/bpmn-js/walkthrough/)

The bpmn.io license grants broad reuse but requires its visible bpmn.io watermark to remain in rendered diagrams. Manatee must preserve that attribution in the editor and in bpmn-js-produced SVG. [bpmn-js license](https://github.com/bpmn-io/bpmn-js/blob/develop/LICENSE)

Use `bpmn-moddle@10.2.0` for model parsing, validation warnings, authored identity, and XML generation. It implements the BPMN 2.0 metamodel in browsers and can be configured with extension descriptors. Its underlying moddle model supports extension elements and unknown `Any` elements. [bpmn-moddle package](https://www.npmjs.com/package/bpmn-moddle) · [moddle extension behavior](https://github.com/bpmn-io/moddle)

Do not make automatic BPMN layout depend on `bpmn-auto-layout@1.3.0`. That stable release omits message flows, annotations, associations, groups, and all but the first collaboration participant, which conflicts with the proposed baseline. The current `2.0.0-alpha.2` line is substantially more capable: it handles processes and collaborations with BPMN-specific nested layout and orthogonal routing, but it deliberately discards all existing DI when run and remains prerelease software. Evaluate its exact pin in an implementation spike; if it passes the representative corpus, use it only for **Reset layout** and for XML that has no usable DI, in a Web Worker. Never invoke it after an ordinary drag or source edit because that would erase authored geometry. [stable package limitations](https://www.npmjs.com/package/bpmn-auto-layout) · [current layout contract](https://github.com/bpmn-io/bpmn-auto-layout/blob/main/docs/LAYOUT.md) · [current prerelease changelog](https://github.com/bpmn-io/bpmn-auto-layout/blob/main/CHANGELOG.md)

## Integration with Manatee

Keep the existing framework-neutral `DocumentEngine` boundary and add a `BpmnDocumentAdapter` beside the four Mermaid family adapters. The Solid 2 UI identifies the document kind from its extension/content, loads the BPMN adapter on demand, and mounts bpmn-js into an owned DOM ref. Solid remains responsible for the shell, panels, source editor, commands, persistence, and diagnostics; bpmn-js owns the BPMN canvas and notation interactions.

The source-of-truth contract should be:

1. The original XML text remains the editable semantic document.
2. A parsed BPMN model supplies semantic objects, warnings, and stable IDs.
3. Standard BPMN DI supplies positions, dimensions, labels, and edge waypoints.
4. A registered `manatee` XML namespace supplies spacing and presentation overrides that BPMN DI cannot represent.
5. Visual commands are translated back into targeted changes to BPMN DI and Manatee extension nodes.

Do not use a full `saveXML()` result as the normal persistence path. Model serialization is semantically portable but may normalize prefixes, whitespace, attribute order, and other text. To honor Manatee's source-preservation promise, retain the original XML and apply range-targeted patches for visual changes. Parse a fresh model after every patch. If a command cannot be represented safely as a targeted patch, report that limitation and leave the source unchanged rather than silently rewriting the document. Direct source edits are saved exactly as typed.

Unknown namespaces, extension elements, comments, and formatting outside the changed BPMN DI or `manatee` nodes remain byte-for-byte unchanged under visual-only edits. Unknown content inside a replaced standard DI element is retained when possible and diagnosed when it prevents a safe patch. This is the BPMN equivalent of preserving content outside Mermaid's `manatee` front matter.

For first-release styling, store Manatee's richer style rules in its own extension namespace and apply them through a bpmn-js custom renderer or markers. bpmn-js supports custom renderers and persistent fill/stroke color extensions, but the OMG specification does not standardize color interchange. Imported third-party color extensions should be rendered when recognized and preserved otherwise; Manatee should not claim cross-tool style fidelity. [bpmn-js color approaches](https://github.com/bpmn-io/bpmn-js-examples/blob/main/colors/README.md) · [bpmn-js custom rendering](https://github.com/bpmn-io/bpmn-js-example-custom-rendering)

## First-release feature boundary

The smallest coherent BPMN release is a BPMN 2.0 **process and collaboration diagram editor** with source editing, rendering/export, and presentation editing for:

- pools/participants and nested lanes;
- start, intermediate, boundary, and end events, including event-definition markers already supported by bpmn-js;
- tasks, call activities, and collapsed or expanded subprocesses;
- exclusive, parallel, inclusive, complex, and event-based gateways;
- sequence flows, message flows, associations, and their labels;
- text annotations, groups, and data objects/stores when present in an otherwise supported process diagram.

Manatee should render any standard process/collaboration element bpmn-js can import, preserve it, and expose a diagnostic if the visual editor cannot manipulate it. Visual editing in the first release covers selection, node/container dragging, supported resizing, spacing/reset layout, and Manatee styling. Semantic creation, deletion, connection, or type conversion remains source-editor work for this release; adopting bpmn-js's complete palette and context-pad authoring experience would be a separate product scope.

Exclude choreography diagrams, conversation diagrams, executable-engine configuration, token simulation, vendor properties panels, and proprietary workflow validation from the first release. Preserve these constructs when they occur in imported XML and make unsupported visual behavior explicit.

## Validation obligations

Add BPMN fixtures as a fifth family in the release corpus. Positive fixtures should cover:

- one process with events, tasks, gateway branches, labels, annotations, data, and nested subprocesses;
- a collaboration with multiple pools, nested lanes, sequence flows, message flows, and boundary events;
- imported authored DI followed by drag, resize, styling, undo/redo, source edit, unmatched-setting cleanup, Reset layout, reopen, SVG export, PNG export, and clipboard copy;
- custom prefixes, comments, extension namespaces, unknown elements, multiple BPMN diagrams in one definitions document, and incomplete/partial DI;
- representative official OMG machine-readable examples and bpmn-js fixtures.

Negative fixtures should cover malformed XML, duplicate/missing IDs, invalid references, unsupported diagram kinds, unsafe patch locations, missing DI, unsupported layout input, and source changes that delete or reparent visually configured elements.

Every visual-only round trip must prove that semantic XML and unknown source text are unchanged, except for the intended BPMN DI and `manatee` extension ranges. Re-import the output with `bpmn-moddle`, render it with bpmn-js, and validate geometry and identity. Cross-tool smoke checks should open and move the representative collaboration in a current BPMN 2.0 desktop modeler, then reopen it in Manatee without loss. SVG/PNG slide checks and the existing browser/performance envelope apply to BPMN too; measure BPMN separately because its adapter is lazily loaded and uses a different renderer.

## Decision input

Recommended product decision: add BPMN through portable `.bpmn` BPMN 2.0 XML, use bpmn-js as the rendering/modeling adapter, store layout in standard BPMN DI, and reserve a `manatee` XML extension for richer presentation rules. This is a second document kind with its own adapter inside the same editor, not a promise that Mermaid source can express BPMN.

The remaining product choice is the preservation contract: accept targeted updates to standard BPMN DI as part of a visual change, while keeping semantic XML and all unrelated text unchanged. Requiring every visual setting to live exclusively inside a Manatee extension would make layouts less portable to other BPMN tools and duplicate the standard DI model.
