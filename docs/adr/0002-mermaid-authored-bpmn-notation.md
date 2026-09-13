# ADR-0002: Express common BPMN notation through Mermaid presentation

Manatee's process-diagram authoring format is Mermaid, enriched with enough presentation control to communicate common BPMN notation to human readers. Ordinary Mermaid viewers may display a simpler diagram; preserving identical BPMN appearance outside Manatee is not required. This accepts reduced visual fidelity in other viewers to keep Mermaid authoring and a small notation scope, rather than making BPMN XML interchange or workflow execution the purpose of the feature.

This supersedes ADR-0001's requirement for a separate BPMN XML document kind as the solution to BPMN support. The existing Mermaid presentation and source-preservation approach remains applicable. Remove the existing BPMN XML editor from the product so the implementation follows the Mermaid authoring scope.

The initial notation set is tasks, start/end events, exclusive and parallel gateways, pools/lanes, sequence/message flows, timer events, and collapsed subprocesses. Timers can represent a wait within the flow or an interrupting timeout attached to a task. Non-interrupting timers are outside the initial set.

Authors choose BPMN notation in the inspector, and those choices are saved in editable Manatee front matter alongside ordinary Mermaid source. Manatee renders the richer notation and saved layout; ordinary Mermaid viewers retain a simpler process diagram. This builds on the existing presentation persistence approach while keeping the base diagram readable in Mermaid.

An interrupting boundary timer records its host task, the exact authored Mermaid relationship used as its ordinary-view fallback, and a host-border anchor. Manatee hides only that declared attachment in the enriched scene. Missing or changed references remain in the source and produce diagnostics instead of causing another relationship to be guessed or hidden.

Optimize the implementation for one concrete Mermaid document, scene, and rendering/export path. Remove the XML implementation and the format-adapter registry, document-kind discrimination, generic document contracts, and lifecycle hooks introduced to support both formats. Retain document transaction ordering, source preservation, worker layout, browser storage, and the existing Mermaid families because they still serve this path.

The implemented path is `Studio → DocumentSession → MermaidDocument → parse/normalize → resolve notation and styles → worker layout → MermaidScene → SVG`. `MermaidDocument` owns parsing, history, source patches, diagnostics, commands, and scene production. The session owns document lifetime, stale-work rejection, debounced source edits, and ordered autosaves.

The ordered implementation plan and acceptance gates are tracked in [issue #17](https://github.com/mlperrott/manatee/issues/17).
