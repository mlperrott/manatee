# Manatee authoring and examples

Manatee supports Mermaid flowcharts, native swimlanes, C4 context and C4 container diagrams. A new flowchart opens with a guided canvas: add and label a first node, add another, then connect them. You can also paste Mermaid source or open **Examples** to explore simple BPMN, swim lanes, advanced process notation, both C4 families, styling variations, attribute-driven rules, and saved layout. Every example opens as a separate editable document; its **About this example** panel explains the extension and suggests edits to try.

## Editing scope

Imported documents start in presentation-only mode. The inspector can change Manatee metadata: appearance, notation, attributes, rules, spacing, positions and timer anchors. The source panel remains readable. Enable **Allow Mermaid source edits** to edit the source or use **Structure** for nodes, connections, labels, groups and C4 details. New documents and examples start with this enabled. Common selection controls—label, shape and connection kind—appear first; notation, attributes and exact coordinates are grouped under advanced controls.

Flowcharts and swimlanes also support direct canvas authoring. Choose **Add node** or press `N`, then click the canvas and enter a label inside the proposed node. Selecting a node reveals four directional controls: click one to stage a connected node with its label active, or drag one onto another node to create a connection. The staged node inherits the source node's visible type and appearance. `Command+Enter` or `Control+Enter` quick-adds in the diagram's forward direction. Drafts commit as one undoable change with Enter or blur and cancel without history with Escape. New IDs are readable slugs derived from the first label and remain stable after later label edits.

A selection-local action bar provides the frequent label, type, connection-kind, duplicate, delete and Inspector actions without leaving the canvas. Enter or F2 edits a selected label, Delete removes the selection, and Escape cancels the current canvas action. Quick-added nodes inherit the source node's visible appearance as explicit overrides, while **Duplicate** copies the node without its connections. Direct structural actions remain visibly gated in presentation-only mode until Mermaid source editing is enabled. C4 authoring continues through the existing Structure controls.

The document engine enforces the restriction, including undo and redo. An undo that would cross into a Mermaid source change is disabled until Mermaid editing is enabled. Changing the restriction does not clear history.

Presentation commands patch only the `manatee` front-matter mapping. Structural commands regenerate Mermaid structural statements, preserving the front matter, comments, supported element identities and styling directives. Their formatting can change. Commands validate the resulting document before committing; rejected edits leave the source intact. Source editing retains the existing last-valid-preview behavior for incomplete text.

Deleting a node removes its connections. Deleting a group keeps its contents in its parent. Moving elements between groups clears their parent-relative manual positions so automatic placement remains consistent after reopening. Timer notation whose attachment is removed is cleared in the same undoable change. C4 starter documents contain an initial element because the Mermaid C4 parser requires content.

## Presentation controls

Select an element to edit its effective colours, outline width and pattern, text colour, size, weight and slant. Eight-digit hex colours include alpha, for example `#b8dbef99`. Reset a property to inherit its appearance, or reset the entire appearance override. Connections expose line and label controls; fill is reserved for nodes and containers. BPMN notation determines the line conventions that identify each connection type.

Positions are relative to the parent’s content area. While dragging a node, Manatee snaps its centreline to directly connected nodes within eight screen pixels, shows a temporary guide and releases the snap beyond twelve pixels. Hold Alt or Option to bypass snapping; keyboard movement and exact coordinates remain unsnapped. Boundary timers use a host-border side and offset between zero and one.

Focus the canvas and use the arrow keys to move selection through nodes, groups and connections in document order. Hold Alt or Option while pressing an arrow key to move a selected node. Manatee announces the selected element and provides a visible focus treatment and keyboard reminder.

Selecting a connection reveals handles for both endpoints. Drag a handle to one of the current node’s north, east, south or west dock targets to lock that endpoint there. Drag it to a dashed **Reconnect** target to change the Mermaid connection; reconnection is available only when Mermaid source editing is enabled. The inspector provides independent Auto and cardinal-side choices for both endpoints. Dock locks are presentation settings, while reconnection changes the semantic source. Reset layout clears positions, timer anchors and dock locks; resetting spacing is a separate action.

Node attributes support text, numbers and booleans, with rename and removal. Styling rules can combine node IDs, classes and attribute conditions. Predicates include typed equality, membership lists, existence and numeric comparisons. All conditions in a rule must match. Rules run in document order, then individual presentation overrides take precedence. Rules apply to nodes. The rule editor supports editing, deletion and reordering without writing YAML.

Document-wide layout controls and styling rules remain available with no element selected. Unused presentation settings are retained and can be removed individually or together.

## Documents, saving and recovery

Each open document owns its selection, undo/redo history, source restriction, portable-download baseline and last valid preview. Switching tabs does not reopen it. The workspace restores open documents, their contents, active tab and restrictions after reload. Undo history lasts for the current session; it is not stored across reloads.

**Recovered locally in this browser** means the workspace has been committed to browser storage on this device. **Download .mmd** writes a portable Mermaid file. **Changes since last download** identifies documents whose current source differs from the last downloaded copy. Downloading one tab does not mark another tab downloaded. Closing a document with changes asks before discarding it; the final tab remains open. The browser also asks before leaving with changes.

Recovery is browser-local. Clearing browser data removes it. **Download .mmd** always downloads a portable copy, including after restoring a workspace. Older single-document autosaves remain available through the recovery notice.

## Desktop and mobile

Desktop provides canvas, inspector and optional source side by side. Phones use Canvas, Source and Inspector views with the same authoring controls, plus an **Open documents** picker that always identifies the current document. Tap a node or connection to select it; frequent label, duplicate, delete and Inspector actions appear in a bottom-docked bar, while type and appearance remain in the Inspector. Drag a node to move it. Connected lines follow the node during the drag and reroute when released. On desktop, dragging a container previews its nested containers, nodes and connections together before the final reroute. Container dragging remains desktop-only. Swipe the blank canvas or a connection to scroll. **Fit** centres the diagram in the available canvas and continues to fit it when panels or the viewport change; manual zoom or **100%** leaves Fit mode. Advanced controls are expandable, example navigation is keyboard accessible, and primary touch controls use at least 44 CSS pixels.
