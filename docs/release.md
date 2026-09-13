# Manatee release guide

Manatee edits portable Mermaid text entirely in the browser. The public release is available at <https://mlperrott.github.io/manatee/>.

## Supported documents

Manatee supports Mermaid 11.17.2 flowcharts with subgraphs, native swimlanes, C4 context diagrams, and C4 container diagrams. Version-one `manatee` YAML front matter stores presentation overrides without changing the Mermaid semantic source.

Flowcharts and swimlanes can use common process notation: tasks, start and end events, exclusive and parallel gateways, timer waits, interrupting timeouts, collapsed subprocesses, pools and lanes, and sequence and message flows. Authors select notation in the inspector. Other Mermaid viewers retain the source structure and show a simpler process diagram. The notation communicates processes to readers; XML interchange, execution, simulation, and full BPMN conformance are outside this release.

Unsupported Mermaid families and deferred constructs produce explicit diagnostics while preserving source.

## Portable workflow

Open `.mmd` and `.mermaid` files with the Open control. Save writes to a File System Access handle where available and otherwise downloads the source. IndexedDB autosave records the source and last valid rendering state; the next visit offers Recover or Discard. If an older release left BPMN XML in autosave, Manatee removes it from the active document slot and offers one final download or discard action without loading an XML editor.

SVG export uses the same scene as the preview. PNG export supports 2×, 3×, and 4× rasterization with white or transparent backgrounds. Copy PNG falls back to downloading when clipboard access is unavailable.

## Compatibility and limits

The release targets the latest two desktop versions of Chrome, Edge, Firefox, and Safari. The Studio adapts to iPhone-sized screens and landscape. The checked envelope is 100 elements, 150 relationships, and 10 groups or lanes. A representative full render must complete within 2 seconds, and post-drag routing within 250 ms.

The release corpus covers every supported Mermaid family, the complete process-notation starter, source and metadata preservation, invalid-source recovery, layout reconciliation, SVG/PNG output, clipboard behavior, portable filenames, desktop browsers, and mobile workflows. GitHub Actions verifies the exact `dist/client` artifact before Pages deployment.

PowerPoint for Microsoft 365 accepts SVG and PNG. Google Slides accepts PNG, so use a 3× or 4× PNG for Slides.

## Using the Studio on iPhone

Use the bottom Canvas, Source, and Inspector controls to switch views. Tap an element and open Inspector to choose process notation, change appearance, or move it precisely. Swipe a zoomed diagram to scroll; Fit returns to the whole diagram. Source fields and menus remain accessible when the keyboard opens. Autosave is local to the browser; use Save for a portable copy.
