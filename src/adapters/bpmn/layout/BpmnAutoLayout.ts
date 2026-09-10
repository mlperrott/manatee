import { generateBpmnLayout, type GeneratedBpmnLayout } from "./generateLayout";

interface WorkerResponse {
  readonly id: number;
  readonly layout?: GeneratedBpmnLayout;
  readonly error?: string;
}

export interface BpmnLayoutService {
  layout(source: string): Promise<GeneratedBpmnLayout>;
  dispose(): void;
}

export class BpmnAutoLayout implements Disposable, BpmnLayoutService {
  readonly #worker: Worker | undefined;
  readonly #pending = new Map<
    number,
    {
      resolve: (layout: GeneratedBpmnLayout) => void;
      reject: (error: Error) => void;
    }
  >();
  #nextId = 1;

  constructor(useWorker = typeof Worker !== "undefined") {
    this.#worker = useWorker
      ? new Worker(new URL("./bpmnLayout.worker.ts", import.meta.url), {
          type: "module",
        })
      : undefined;
    if (this.#worker) {
      this.#worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const pending = this.#pending.get(event.data.id);
        if (!pending) return;
        this.#pending.delete(event.data.id);
        if (event.data.layout) pending.resolve(event.data.layout);
        else
          pending.reject(new Error(event.data.error ?? "BPMN layout failed."));
      };
      this.#worker.onerror = (event) => {
        const error = new Error(
          event.message || "The BPMN layout worker failed.",
        );
        for (const pending of this.#pending.values()) pending.reject(error);
        this.#pending.clear();
      };
    }
  }

  layout(source: string): Promise<GeneratedBpmnLayout> {
    if (!this.#worker) return generateBpmnLayout(source);
    const id = this.#nextId;
    this.#nextId += 1;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#worker?.postMessage({ id, source });
    });
  }

  [Symbol.dispose](): void {
    this.dispose();
  }

  dispose(): void {
    this.#worker?.terminate();
    for (const pending of this.#pending.values()) {
      pending.reject(new Error("The BPMN layout worker was disposed."));
    }
    this.#pending.clear();
  }
}
