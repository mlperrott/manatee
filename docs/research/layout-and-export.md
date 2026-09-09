# Layout and export foundations

Research date: 2026-09-09. Primary documentation review only; runtime proof remains outstanding.

## Candidate comparison

| Foundation | Verified documentation | Implication |
| --- | --- | --- |
| ELK.js / ELK Layered | Browser execution and optional Web Worker; compound graphs and cross-hierarchy edges; ports; straight, orthogonal and spline routing. | Strong prototype candidate for nested flowcharts/C4 boundaries. Manatee supplies rendering and interaction. |
| Dagre | Client-side rendering-independent layout; clustering; supplied node/edge-label dimensions; direction and spacing controls; edge bend points. | Simpler comparison baseline. Documentation does not establish exact coordinate pins or obstacle-aware rerouting after manual moves. |

Sources: [ELK.js](https://github.com/kieler/elkjs), [ELK Layered](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html), [Dagre documentation](https://github.com/dagrejs/dagre/wiki).

ELK interactive layered configuration uses previous positions to influence layer/order preferences. This does not prove arbitrary pinned coordinates survive unchanged. Documentation distinguishes KLighD's additional constraint processing from ordinary layout options. ELK.js flags incremental layout and standalone routing as recurring topics. [Interactive constraints](https://eclipse.dev/elk/blog/posts/2023/23-01-09-constraining-the-model.html), [ELK.js recurring issues](https://github.com/kieler/elkjs#faqs-and-recurring-issues).

Mermaid's native swimlanes use top-level subgraphs as lanes. Neither researched engine establishes ready-made Mermaid lane geometry. **Proposed experiment:** retain semantic lane membership, implement lane bands/headers in Manatee and test placement within them. C4 context/container similarly need semantic adapters and rendering shapes; layout engines do not interpret Mermaid. [Swimlane documentation](https://mermaid.js.org/syntax/swimlanes).

## Rendering and export

**Recommended prototype candidate, not a final architecture:** custom SVG with ELK automatic layout. Separate semantic data, measured geometry, presentation overrides and final routes. Compare Dagre on identical fixtures. Applying saved coordinates after layout alone is insufficient: group bounds, collisions and connectors also require reconciliation.

Measure the actual chosen fonts and wrapped labels before layout. Await font readiness. Experiment with SVG text/tspan, inline styles and self-contained assets; verify embedded fonts in the target slide application rather than inferring fidelity from the browser. [Browser font loading](https://developer.mozilla.org/en-US/docs/Web/API/Document/fonts).

PNG export can serialize SVG, decode it as an image, draw at requested pixel dimensions and call canvas `toBlob("image/png")`. Pixel dimensions supply resolution; the quality argument is not a PNG resolution control. Canvas must remain origin-clean, requiring care with external assets. [HTML canvas standard](https://html.spec.whatwg.org/multipage/canvas.html#dom-canvas-toblob).

PNG clipboard output uses `ClipboardItem` with `image/png` and `navigator.clipboard.write` from the copy action. PNG has stronger specified support than optional SVG clipboard data. Keep file download as fallback when permission or support prevents clipboard writing. [Clipboard specification](https://w3c.github.io/clipboard-apis/), [browser requirements](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/write).

Both engines can run in a static application. Bundle workers and fonts with paths compatible with the GitHub Pages project prefix `/manatee/`. [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).

ELK.js uses EPL-2.0; Dagre uses MIT. Preserve applicable notices and source information in the distribution. [ELK.js license](https://raw.githubusercontent.com/kieler/elkjs/master/LICENSE.md), [Dagre repository/license](https://github.com/dagrejs/dagre).

## Remaining proof

Test nested cross-boundary edges, cross-lane connections, long C4 labels, exact pins after adding/deleting/renaming nodes, routes after dragging, SVG/large PNG import into a slide deck and PNG clipboard in target browsers. These are outstanding experiments, not verified capabilities.

## Ticket

[Evaluate layout and export foundations for slide-ready diagrams](https://github.com/mlperrott/manatee/issues/3).
