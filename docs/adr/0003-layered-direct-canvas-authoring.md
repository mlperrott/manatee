# ADR-0003: Use layered direct canvas authoring

Manatee will keep an explicit Add Node entry point for standalone placement, then expose four directional quick-add and connection controls on a selected node. Selection-local action bars provide common semantic actions, while advanced presentation and metadata controls remain in the Inspector. The first increment applies to flowcharts and swimlanes; C4 keeps its existing Structure-panel path.

Canvas creation is committed through a composite document command. A created node, optional connection, initial manual position, containment, presentation defaults and label form one undoable source-preserving transaction. This deliberately favours stable author-chosen placement over immediately returning the new structure to automatic layout; Reset layout remains the explicit way to clear those manual positions.

Directional quick-add stages that complete transaction directly on the canvas. The proposed node and connection appear immediately with inline label editing; Enter or blur commits the transaction, while Escape removes the draft without adding history. A quick-added node inherits the source node's visible type and appearance so the frequent path does not require a separate type chooser.

Direct controls adapt their gestures across pointer, touch and keyboard input, respect presentation-only mode, and create only semantic node-to-node connections. Resize, rotation, multi-selection, route waypoints, arbitrary lines and group connection targets remain outside this increment so Manatee does not become a general-purpose drawing-object editor.
