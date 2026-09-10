import {
  computeMermaidScene,
  type MermaidLayoutRequest,
} from "./automaticLayout";
import type { MermaidScene } from "./types";

interface WorkerResponse {
  readonly id: number;
  readonly scene?: MermaidScene;
  readonly error?: string;
}

export class MermaidLayout implements Disposable {
  readonly #worker: Worker | undefined;
  readonly #pending = new Map<
    number,
    { resolve: (scene: MermaidScene) => void; reject: (error: Error) => void }
  >();
  #nextId = 1;

  constructor(useWorker = typeof Worker !== "undefined") {
    this.#worker = useWorker
      ? new Worker(new URL("./mermaidLayout.worker.ts", import.meta.url), {
          type: "module",
        })
      : undefined;
    if (this.#worker) {
      this.#worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const pending = this.#pending.get(event.data.id);
        if (!pending) return;
        this.#pending.delete(event.data.id);
        if (event.data.scene) pending.resolve(event.data.scene);
        else pending.reject(new Error(event.data.error ?? "Layout failed."));
      };
      this.#worker.onerror = (event) => {
        const error = new Error(event.message || "The layout worker failed.");
        for (const pending of this.#pending.values()) pending.reject(error);
        this.#pending.clear();
      };
    }
  }

  layout(request: MermaidLayoutRequest): Promise<MermaidScene> {
    if (!this.#worker) return computeMermaidScene(request);
    const id = this.#nextId;
    this.#nextId += 1;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#worker?.postMessage({ id, request });
    });
  }

  [Symbol.dispose](): void {
    this.dispose();
  }

  dispose(): void {
    this.#worker?.terminate();
    for (const pending of this.#pending.values()) {
      pending.reject(new Error("The layout worker was disposed."));
    }
    this.#pending.clear();
  }
}
