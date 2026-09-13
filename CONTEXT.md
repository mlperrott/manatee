# Manatee

Manatee presents Mermaid-authored diagrams for technical discussions and management presentations, with formatting that supports communicating processes using BPMN notation while keeping their meaning available as text.

## Language

**BPMN notation**: The visual vocabulary used to communicate a business process to readers, including activity and event shapes, lanes, and connectors. In Manatee, its purpose is visual communication.

**Notation choice**: The BPMN symbol or connector convention an author assigns to a process element to communicate its role to readers.

**Semantic source**: The Mermaid textual description of a diagram's elements, relationships and groupings.

**Mermaid document**: A Mermaid semantic source with presentation overrides in its `manatee` front-matter section.

**Mermaid fallback**: The simpler process diagram shown by an ordinary Mermaid viewer, retaining the authored process structure while Manatee supplies richer BPMN notation and presentation.

**Presentation override**: A saved adjustment to a diagram's appearance, such as a manually chosen position, spacing or styling.

**Unmatched presentation override**: A preserved presentation override whose referenced authored element identity is absent from the current semantic source.

**Manual position**: A position chosen by the diagram's author that is preserved when the semantic source is edited.

**Automatic layout**: The placement computed for diagram elements that do not have manual positions.

**Reset layout**: The editor action that returns diagram placement to automatic layout.

**Node attribute**: A named value associated with a node, such as its status, that can be used to determine its presentation.

**Styling rule**: A declarative association between matching diagram elements and presentation properties. Mermaid elements can be matched by attributes or classes.

**Node fill**: The colour of the interior of a node, independent of its outline.

**Node outline**: The border of a node, with its own colour and line style.
