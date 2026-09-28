# Manatee

Manatee presents Mermaid-authored diagrams for technical discussions and management presentations, with formatting that supports communicating processes using BPMN notation while keeping their meaning available as text.

## Language

**BPMN notation**: The visual vocabulary used to communicate a business process to readers, including activity and event shapes, lanes, and connectors. In Manatee, its purpose is visual communication.

**Notation choice**: The BPMN symbol or connector convention an author assigns to a process element to communicate its role to readers.

**Semantic source**: The Mermaid textual description of a diagram's elements, relationships and groupings.

**Connection**: An authored relationship between two diagram elements, rendered as a line in the diagram.
_Avoid_: Edge

**Mermaid document**: A Mermaid semantic source with presentation overrides in its `manatee` front-matter section.

**Presentation-only mode**: A document editing state in which semantic source changes are disabled while presentation overrides remain editable.

**Mermaid fallback**: The simpler process diagram shown by an ordinary Mermaid viewer, retaining the authored process structure while Manatee supplies richer BPMN notation and presentation.

**Presentation override**: A saved adjustment to a diagram's appearance, such as a manually chosen position, spacing or styling.

**Unmatched presentation override**: A preserved presentation override whose referenced authored element identity is absent from the current semantic source.

**Manual position**: A position chosen by the diagram's author that is preserved when the semantic source is edited.

**Automatic layout**: The placement computed for diagram elements that do not have manual positions.

**Reset layout**: The editor action that clears manual positions and dock locks, then recomputes automatic placement and connection routing.

**Routing dogleg**: An unnecessary pair of short bends in an automatically routed connection, usually caused when connected diagram elements are almost but not exactly aligned.
_Avoid_: Kink

**Alignment snap**: The editor behaviour that brings a dragged node's centreline into exact alignment with a directly connected node to prevent a routing dogleg.
_Avoid_: Snap to grid, grid snapping

**Connection dock**: One of the four side-centre points—north, east, south or west—where a connection endpoint meets a node.
_Avoid_: Cardinal point, port

**Dock lock**: A presentation override that requires one connection endpoint to use a chosen connection dock without changing which nodes the connection relates. Routing retains the chosen dock even when it cannot find a clean path.

**Automatic docking**: Connection routing in which Manatee chooses the connection dock for an endpoint.
_Avoid_: Auto select

**Route waypoint**: An author-chosen interior point that defines part of a connection's exact orthogonal path.
_Avoid_: Control point, bend point

**Manual route**: An exact connection path chosen by the author and saved as a presentation override. It remains authoritative even when later diagram changes cause it to cross another element.
_Avoid_: Suggested route, preferred route

**Reset route**: The editor action that clears one connection's manual route and returns it to automatic routing without clearing its dock locks.

**Reconnect**: An authoring change that moves a connection endpoint to a different node, changing the semantic source.

**Node attribute**: A named value associated with a node, such as its status, that can be used to determine its presentation.

**Styling rule**: A declarative association between matching diagram elements and presentation properties. Mermaid elements can be matched by attributes or classes.

**Node fill**: The colour of the interior of a node, independent of its outline.

**Node outline**: The border of a node, with its own colour and line style.
