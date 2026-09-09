# Manatee

Manatee presents Mermaid and BPMN diagrams for technical discussions and management presentations while keeping their meaning available as text.

## Language

**Semantic source**: The textual description of a diagram's elements, relationships and groupings: Mermaid syntax in a Mermaid document or BPMN 2.0 XML in a BPMN document.

**Mermaid document**: A Mermaid semantic source with presentation overrides in its `manatee` front-matter section.

**BPMN document**: A portable `.bpmn` BPMN 2.0 XML source. Standard BPMN Diagram Interchange holds its shared geometry; a Manatee XML extension holds richer presentation overrides.

**BPMN Diagram Interchange**: The standard BPMN XML shapes, bounds, edges and waypoints that allow laid-out process and collaboration diagrams to move between BPMN tools.

**Presentation override**: A saved adjustment to a diagram's appearance, such as a manually chosen position, spacing or styling.

**Unmatched presentation override**: A preserved presentation override whose referenced authored element identity is absent from the current semantic source.

**Manual position**: A position chosen by the diagram's author that is preserved when the semantic source is edited.

**Automatic layout**: The placement computed for diagram elements that do not have manual positions.

**Reset layout**: The editor action that returns diagram placement to automatic layout.

**Node attribute**: A named value associated with a node, such as its status, that can be used to determine its presentation.

**Styling rule**: A declarative association between matching diagram elements and presentation properties. Mermaid elements can be matched by attributes or classes; BPMN elements can be matched by their standard type or properties.

**Node fill**: The colour of the interior of a node, independent of its outline.

**Node outline**: The border of a node, with its own colour and line style.
