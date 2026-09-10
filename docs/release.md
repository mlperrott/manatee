# Manatee release guide

Manatee edits portable Mermaid text and BPMN 2.0 XML entirely in the browser. The public release is available at <https://mlperrott.github.io/manatee/>.

## Supported documents

- Mermaid 11.17.2 flowcharts with subgraphs, native swimlanes, C4 context diagrams, and C4 container diagrams.
- BPMN 2.0 process and collaboration diagrams with pools, lanes, events, activities and subprocesses, gateways, sequence and message flows, associations, annotations, groups, and data elements.
- Mermaid presentation overrides in version 1 `manatee` YAML front matter.
- BPMN geometry in standard Diagram Interchange and fill/outline overrides in the Manatee extension.

Unsupported Mermaid families and deferred constructs produce explicit diagnostics while preserving source. BPMN choreography, conversation diagrams, executable-engine configuration, simulation, and full semantic visual authoring are outside this release.

## Portable workflow

Open `.mmd`, `.mermaid`, and `.bpmn` files with the Open control. Save writes to a File System Access handle where the browser provides one and otherwise downloads the source with its current filename. IndexedDB autosave records the source and last valid rendering state; the next visit offers Recover or Discard before replacing it.

SVG export contains its required styles. BPMN SVG retains visible bpmn.io attribution. PNG export supports 2×, 3×, and 4× rasterization with white or transparent backgrounds. Copy PNG writes the same blob to the clipboard and downloads it when clipboard access is unavailable or denied.

## Compatibility and limits

The release targets the latest two desktop versions of Chrome, Edge, Firefox, and Safari. Editing on mobile is outside the first release. The checked envelope is 100 elements, 150 relationships, and 10 Mermaid groups or 8 BPMN lanes. A representative full render must complete within 2 seconds; BPMN lazy loading is measured separately.

The release corpus covers positive and negative fixtures for all supported Mermaid families, BPMN process and collaboration documents, source and metadata preservation, unknown versions and extensions, invalid-source recovery, layout reconciliation, SVG fidelity, PNG dimensions and backgrounds, clipboard behavior, and portable filenames. GitHub Actions runs the corpus in Chromium, Firefox, and WebKit before deploying the exact verified `dist/client` artifact, then tests file, worker, lazy chunk, export, and base-path behavior at the deployed URL.

PowerPoint for Microsoft 365 accepts both SVG and PNG. Google Slides accepts PNG but does not currently accept SVG uploads, so use Manatee's 3× or 4× PNG for Slides. See [Microsoft's SVG instructions](https://support.microsoft.com/en-au/office/edit-svg-images-in-microsoft-365-69f29d39-194a-4072-8c35-dbe5e7ea528c) and [Google's supported image-type guidance](https://support.google.com/docs/thread/305745994/what-vector-graphic-formats-are-supported-by-google-slides?hl=en).

BPMN source is round-tripped through current `bpmn-moddle` and rendered through current `bpmn-js`; unrelated namespaces, comments, prefixes, and semantic XML remain untouched by visual edits.
