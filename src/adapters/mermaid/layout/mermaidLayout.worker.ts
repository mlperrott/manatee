/// <reference lib="webworker" />

import {
  computeMermaidScene,
  type MermaidLayoutRequest,
} from "./automaticLayout";

interface WorkerRequest {
  readonly id: number;
  readonly request: MermaidLayoutRequest;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, request } = event.data;
  try {
    const scene = await computeMermaidScene(request);
    self.postMessage({ id, scene });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : "Layout failed.",
    });
  }
};
