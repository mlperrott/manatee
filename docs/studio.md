# Studio authoring and examples

Studio supports Mermaid flowcharts, native swimlanes, C4 context and C4 container diagrams. Open **Example gallery** to explore simple BPMN, swim lanes, advanced process notation, both C4 families, three styling variations, attribute-driven rules, and saved layout. Every example opens as a separate editable document; its **About this example** panel explains the extension and suggests edits to try.

## Editing scope

Imported documents start in presentation-only mode. The inspector can change Manatee metadata: appearance, notation, attributes, rules, spacing, positions and timer anchors. The source panel remains readable. Enable **Allow Mermaid source edits** to edit the source or use **Create and edit structure** for nodes, connections, labels, groups and C4 details. New documents and examples start with this enabled.

The document engine enforces the restriction, including undo and redo. An undo that would cross into a Mermaid source change is disabled until Mermaid editing is enabled. Changing the restriction does not clear history.

Presentation commands patch only the `manatee` front-matter mapping. Structural commands regenerate Mermaid structural statements, preserving the front matter, comments, supported element identities and styling directives. Their formatting can change. Commands validate the resulting document before committing; rejected edits leave the source intact. Source editing retains the existing last-valid-preview behavior for incomplete text.

Deleting a node removes its connections. Deleting a group keeps its contents in its parent. Moving elements between groups clears their parent-relative manual positions so automatic placement remains consistent after reopening. Timer notation whose attachment is removed is cleared in the same undoable change. C4 starter documents contain an initial element because the Mermaid C4 parser requires content.

## Presentation controls

Select an element to edit its effective colours, outline width and pattern, text colour, size, weight and slant. Eight-digit hex colours include alpha, for example `#b8dbef99`. Reset a property to inherit its appearance, or reset the entire appearance override. Connections expose line and label controls; fill is reserved for nodes and containers. BPMN notation determines the line conventions that identify each connection type.

Positions are relative to the parent’s content area. Boundary timers use a host-border side and offset between zero and one. Reset layout returns positions and timer anchors to automatic placement; resetting spacing is a separate action.

Node attributes support text, numbers and booleans, with rename and removal. Styling rules can combine node IDs, classes and attribute conditions. Predicates include typed equality, membership lists, existence and numeric comparisons. All conditions in a rule must match. Rules run in document order, then individual presentation overrides take precedence. Rules apply to nodes. The rule editor supports editing, deletion and reordering without writing YAML.

Document-wide layout controls and styling rules remain available with no element selected. Unused presentation settings are retained and can be removed individually or together.

## Documents, saving and recovery

Each open document owns its selection, undo/redo history, source restriction, portable-save baseline and last valid preview. Switching tabs does not reopen it. The workspace restores open documents, their contents, active tab and restrictions after reload. Undo history lasts for the current session; it is not stored across reloads.

**Recovery saved** means the workspace has been committed to this browser’s storage. **Save** writes a portable Mermaid file or downloads one. Saving one tab does not mark another tab saved. Closing a document with unsaved changes asks before discarding it; the final tab remains open. The browser also asks before leaving with unsaved work.

Recovery is browser-local. Clearing browser data removes it. File handles are not retained across reloads, so Save downloads a portable file after restoring a workspace. Older single-document autosaves remain available through the recovery notice.

## Desktop and mobile

Desktop provides canvas, inspector and optional source side by side. Phones use Canvas, Source and Inspector views with the same authoring controls. Tap a node or connection to select it; drag a node to move it. Swipe the blank canvas or a connection to scroll, and use the zoom controls for dense diagrams. Advanced controls are expandable, gallery navigation is keyboard accessible, and primary touch controls use at least 44 CSS pixels.
