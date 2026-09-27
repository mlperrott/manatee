# Manatee release guide

Manatee edits portable Mermaid text entirely in the browser. The public release is available at <https://mlperrott.github.io/manatee/>.

## Supported documents

Manatee supports Mermaid 11.17.2 flowcharts with subgraphs, native swimlanes, C4 context diagrams, and C4 container diagrams. Version-one `manatee` YAML front matter stores presentation overrides without changing the Mermaid semantic source.

Flowcharts and swimlanes can use common process notation: tasks, start and end events, exclusive and parallel gateways, timer waits, interrupting timeouts, collapsed subprocesses, pools and lanes, and sequence and message flows. Authors select notation in the inspector. Other Mermaid viewers retain the source structure and show a simpler process diagram. The notation communicates processes to readers; XML interchange, execution, simulation, and full BPMN conformance are outside this release.

Unsupported Mermaid families and deferred constructs produce explicit diagnostics while preserving source.

## Portable workflow

Open `.mmd` and `.mermaid` files with the Open control. **Download .mmd** always downloads the current source as a portable file. IndexedDB recovery independently records the source and last valid rendering state in the current browser; the next visit offers Recover or Discard. If an older release left BPMN XML in autosave, Manatee removes it from the active document slot and offers one final download or discard action without loading an XML editor.

SVG export uses the same scene as the preview. PNG export supports 2×, 3×, and 4× rasterization with white or transparent backgrounds. Copy PNG falls back to downloading when clipboard access is unavailable.

## Compatibility and limits

The release targets the latest two desktop versions of Chrome, Edge, Firefox, and Safari. Manatee adapts to iPhone-sized screens and landscape. The checked envelope is 100 elements, 150 relationships, and 10 groups or lanes. A representative full render must complete within 2 seconds, and post-drag routing within 250 ms.

The release corpus covers every supported Mermaid family, the complete process-notation starter, source and metadata preservation, invalid-source recovery, layout reconciliation, SVG/PNG output, clipboard behavior, portable filenames, desktop browsers, and mobile workflows. GitHub Actions verifies the exact `dist/client` artifact before Pages deployment.

PowerPoint for Microsoft 365 accepts SVG and PNG. Google Slides accepts PNG, so use a 3× or 4× PNG for Slides.

## Using Manatee on iPhone

Use the bottom Canvas, Source, and Inspector controls to switch views, and use **Open documents** to change documents. Tap a node or connection to select it, and open Inspector to change its common properties or reveal advanced notation and positioning controls. Drag a node to position it. Swipe blank canvas or a connection to scroll; **Fit** returns to the whole diagram and **100%** restores actual size. Source fields and menus remain accessible when the keyboard opens. Recovery is local to the browser; use **Download .mmd** for a portable copy.
