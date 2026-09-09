# Mermaid compatibility findings

Research date: 2026-09-09. Documentation/source review only; no runtime tests. Current documentation identifies Mermaid 11.17.2; source checks use that release where available.

## Syntax and semantic extraction

Native swimlanes shipped in **11.16.0**. Use `swimlane-beta` with optional direction; top-level subgraphs are lanes and nodes/edges use flowchart syntax. The syntax is explicitly described as evolving. [Documentation](https://mermaid.js.org/syntax/swimlanes), [release](https://github.com/mermaid-js/mermaid/releases/tag/mermaid@11.16.0).

Flowcharts support named and nested subgraphs and connections to groups. Preserve full semantic hierarchy. The renderer-oriented database representation can hide collapsed nodes and redirect boundary edges. [Syntax](https://mermaid.js.org/syntax/flowchart.html), [11.17.2 database](https://raw.githubusercontent.com/mermaid-js/mermaid/mermaid@11.17.2/packages/mermaid/src/diagrams/flowchart/flowDb.ts).

C4 supports `C4Context` and `C4Container`, including people, systems, containers, relationships and boundaries. C4 syntax remains experimental; the documented renderer is statement-order-sensitive. Parsing compatibility need not mean reproducing that presentation. [C4 documentation](https://mermaid.js.org/syntax/c4.html).

Public `mermaid.parse()` returns diagram type/configuration, not a semantic graph. `getDiagramFromText()` exposes a parsed Diagram under the documented but deprecated `mermaidAPI` namespace. Its database/parser/renderer interfaces are family-specific; this is not a stable universal AST contract. [ParseResult](https://mermaid.js.org/config/setup/mermaid/interfaces/ParseResult.html), [Mermaid interface](https://mermaid.js.org/config/setup/mermaid/interfaces/Mermaid.html), [Diagram source, development branch](https://raw.githubusercontent.com/mermaid-js/mermaid/develop/packages/mermaid/src/Diagram.ts).

Flowchart raw getters include `getVertices()`, `getEdges()`, and `getSubGraphs()`. Investigate these rather than using `getData()` as raw semantics: the latter handles collapsed visibility and redirects edges. C4 instead exposes `getC4ShapeArray()`, `getBoundaries()`, and `getRels()`. **Candidate:** isolate a version-pinned adapter per family, subject to a browser spike. The exact swimlane database adapter path remains unverified. [Flowchart source](https://raw.githubusercontent.com/mermaid-js/mermaid/mermaid@11.17.2/packages/mermaid/src/diagrams/flowchart/flowDb.ts), [C4 source](https://raw.githubusercontent.com/mermaid-js/mermaid/mermaid@11.17.2/packages/mermaid/src/diagrams/c4/c4Db.ts).

## Identity and document persistence

Use authored node/group IDs and C4 aliases for presentation references. Flowcharts support explicit edge IDs, for example `A e1@--> B`. Generated edge IDs depend on endpoints and duplicate-edge counts. C4 relationships have no general explicit relationship-ID argument. Parallel relationships, renames/deletes and stale overrides therefore need a reconciliation policy. [Flowchart syntax](https://mermaid.js.org/syntax/flowchart.html), [ID generation](https://raw.githubusercontent.com/mermaid-js/mermaid/mermaid@11.17.2/packages/mermaid/src/diagrams/flowchart/flowDb.ts), [C4 syntax](https://mermaid.js.org/syntax/c4.html).

The 11.17.2 front-matter extractor parses YAML, strips the block and copies only `title`, `displayMode`, and `config` to returned metadata. **Inference:** a top-level `manatee:` namespace should be ignored by that extractor, but will not survive its returned metadata. Manatee must preserve the original document and unknown front-matter fields independently, changing only its namespace. Regenerating Mermaid text from the database would not be a lossless round trip. Confirm with fixtures before relying on this behaviour. [Front-matter source](https://raw.githubusercontent.com/mermaid-js/mermaid/mermaid@11.17.2/packages/mermaid/src/diagram-api/frontmatter.ts).

Mermaid is MIT-licensed; redistribution retains its copyright and permission notice. [License](https://raw.githubusercontent.com/mermaid-js/mermaid/develop/LICENSE).

## Remaining proof

A bounded browser spike should test all selected families, nested membership extraction, native swimlane extraction, duplicate relationships, unknown-YAML preservation and repeated parsing without state leakage. The compatibility boundary and metadata contract remain user decisions.

## Ticket

[Establish Mermaid parsing and front-matter compatibility](https://github.com/mlperrott/manatee/issues/2).
