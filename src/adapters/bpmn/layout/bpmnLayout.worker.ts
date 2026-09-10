/// <reference lib="webworker" />

import { generateBpmnLayout } from "./generateLayout";

interface WorkerRequest {
  readonly id: number;
  readonly source: string;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  try {
    const layout = await generateBpmnLayout(event.data.source);
    self.postMessage({ id: event.data.id, layout });
  } catch (error) {
    self.postMessage({
      id: event.data.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
