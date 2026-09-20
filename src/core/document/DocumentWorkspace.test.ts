import { describe, expect, it } from "vitest";
import {
  DocumentWorkspace,
  type SavedWorkspace,
  type WorkspaceStore,
} from "./DocumentWorkspace";
import { MermaidDocument } from "../../mermaid/MermaidDocument";
import type { SavedDocument } from "./DocumentSession";
const fallback = {
  filename: "first.mmd",
  source: "flowchart LR\nA[First] --> B[Second]\n",
};
function storage() {
  let saved: SavedWorkspace | undefined;
  let legacy: SavedDocument | undefined;
  const store: WorkspaceStore = {
    load: async () => legacy,
    save: async (record) => {
      legacy = record;
    },
    clear: async () => {
      legacy = undefined;
    },
    loadWorkspace: async () => saved,
    saveWorkspace: async (record) => {
      saved = structuredClone(record);
    },
  };
  return { store, getSaved: () => saved };
}
function workspace(store: WorkspaceStore) {
  return new DocumentWorkspace({
    store,
    createDocument: () => new MermaidDocument(),
    initialFilename: fallback.filename,
    initialSource: fallback.source,
  });
}
describe("multiple document workspace", () => {
  it("preserves independent histories, source permissions and pending edits across tabs", async () => {
    const memory = storage();
    const current = workspace(memory.store);
    await current.initialize(fallback);
    const first = current.activeId();
    current.editSource(fallback.source.replace("First", "Edited"));
    const second = await current.open({
      filename: "import.mmd",
      source: "flowchart TD\nI[Imported]\n",
    });
    expect(current.state().snapshot!.sourceEditing).toBe(false);
    current.editSource("flowchart TD\nI[Not allowed]\n");
    expect(current.state().source).not.toContain("Not allowed");
    current.select(first);
    await current.execute({ type: "select", elementId: "A" });
    expect(current.state().source).toContain("Edited");
    expect(current.dirty()).toBe(true);
    await current.execute({ type: "undo" });
    expect(current.state().source).toBe(fallback.source);
    current.select(second);
    expect(current.state().snapshot!.commands.undo).toBe(false);
    current.dispose();
  });
  it("restores all documents, active tab, permissions and invalid drafts with last valid previews", async () => {
    const memory = storage();
    const current = workspace(memory.store);
    await current.initialize(fallback);
    const first = current.activeId();
    const second = await current.open(
      { filename: "invalid.mmd", source: "flowchart LR\nX[Preview]\n" },
      true,
      "simple-bpmn",
    );
    current.editSource("flowchart LR\nX[");
    await current.execute({ type: "select", elementId: undefined });
    await current.flushPersistence();
    expect(memory.getSaved()?.tabs).toHaveLength(2);
    current.dispose();
    const restored = workspace(memory.store);
    await restored.initialize(fallback);
    expect(restored.activeId()).toBe(second);
    expect(restored.state().source).toBe("flowchart LR\nX[");
    expect(restored.state().snapshot?.previewOutdated).toBe(true);
    expect(restored.state().snapshot?.scene?.nodes[0]?.label).toBe("Preview");
    expect(restored.activeTab()?.exampleId).toBe("simple-bpmn");
    expect(restored.dirty()).toBe(true);
    restored.select(first);
    expect(restored.state().source).toBe(fallback.source);
    restored.dispose();
  });
  it("tracks portable saves separately from the initial source and guards the final tab", async () => {
    const memory = storage();
    const current = workspace(memory.store);
    await current.initialize(fallback);
    const first = current.activeId();
    current.editSource(fallback.source.replace("First", "Edited"));
    await current.execute({ type: "select", elementId: "A" });
    current.markSaved(first, current.state().source);
    expect(current.dirty()).toBe(false);
    await current.execute({ type: "undo" });
    expect(current.dirty()).toBe(true);
    current.close(first);
    expect(current.tabs()).toHaveLength(1);
    const second = await current.open(
      { filename: "another.mmd", source: fallback.source },
      true,
    );
    current.close(first);
    expect(current.activeId()).toBe(second);
    expect(current.tabs()).toHaveLength(1);
    await current.flushPersistence();
    expect(memory.getSaved()?.tabs).toHaveLength(1);
    current.dispose();
  });
  it("queues an import during startup so the fallback cannot replace its selection", async () => {
    const memory = storage();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const current = workspace({
      ...memory.store,
      loadWorkspace: async () => {
        await gate;
        return undefined;
      },
    });
    const initialized = current.initialize(fallback);
    const opened = current.open(
      { filename: "early-import.mmd", source: "flowchart TD\nI[Imported]\n" },
      false,
    );
    release();
    await initialized;
    await opened;
    expect(current.state().filename).toBe("early-import.mmd");
    expect(current.state().snapshot?.sourceEditing).toBe(false);
    expect(current.tabs()).toHaveLength(2);
    current.dispose();
  });
  it("reports failed recovery saves and retries without discarding the document", async () => {
    const memory = storage();
    let fail = true;
    const current = workspace({
      ...memory.store,
      saveWorkspace: async (record) => {
        if (fail) throw new Error("Quota exceeded");
        await memory.store.saveWorkspace(record);
      },
    });
    await current.initialize(fallback);
    await current.flushPersistence();
    expect(current.state().workspaceSaveFailed).toBe(true);
    expect(current.state().source).toBe(fallback.source);
    fail = false;
    current.select(current.activeId());
    await current.flushPersistence();
    expect(current.state().workspaceSaveFailed).toBe(false);
    expect(memory.getSaved()?.tabs[0]?.source).toBe(fallback.source);
    current.dispose();
  });
});
