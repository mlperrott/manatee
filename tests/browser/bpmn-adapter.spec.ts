import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const source = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_1" targetNamespace="https://example.com/manatee">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="Start_1" />
    <bpmn:task id="Task_1" name="Review" />
    <bpmn:endEvent id="End_1" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="End_1" />
  </bpmn:process>
</bpmn:definitions>`;

test("lazy loads, recovers, mounts, exports, and disposes BPMN", async ({
  page,
}) => {
  const runtimeErrors: Error[] = [];
  const requested: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error));
  page.on("request", (request) => requested.push(request.url()));
  await page.goto("./");

  const beforeImport = requested.filter((url) => /bpmn|diagram-js/u.test(url));
  expect(beforeImport).toEqual([]);

  const result = await page.evaluate(async (bpmnSource) => {
    const moduleUrl = "/src/adapters/bpmn/index.ts";
    const api = (await import(moduleUrl)) as {
      BpmnDocumentAdapter: new () => {
        open(source: string): Promise<{
          valid: boolean;
          presentationModel?: unknown;
        }>;
        recoverMissingDi(): Promise<{
          source: string;
          presentationModel?: unknown;
        }>;
        style(
          elementId: string,
          style: { fill: string; stroke: string },
        ): Promise<{
          snapshot: { source: string; presentationModel?: unknown };
        }>;
        dispose(): void;
      };
      BpmnCanvas: new () => {
        mount(
          container: HTMLElement,
          source: string,
          options: { presentation?: unknown },
        ): Promise<void>;
        geometry(elementId: string): { bounds?: { width: number } } | undefined;
        exportSvg(): Promise<string>;
        dispose(): void;
      };
    };
    const adapter = new api.BpmnDocumentAdapter();
    const opened = await adapter.open(bpmnSource);
    const recovered = await adapter.recoverMissingDi();
    const styled = await adapter.style("Task_1", {
      fill: "#fee2e2",
      stroke: "#dc2626",
    });
    const host = document.createElement("div");
    host.style.cssText = "width:900px;height:600px;position:fixed;inset:0";
    document.body.append(host);
    const canvas = new api.BpmnCanvas();
    try {
      await canvas.mount(host, styled.snapshot.source, {
        presentation: styled.snapshot.presentationModel,
      });
      const watermark = host.querySelector<HTMLElement>(".bjs-powered-by");
      const taskVisual = host.querySelector<SVGElement>(
        '[data-element-id="Task_1"] .djs-visual > rect',
      );
      const svg = await canvas.exportSvg();
      return {
        opened: opened.valid,
        recovered: recovered.source.includes("<bpmndi:BPMNDiagram"),
        taskWidth: canvas.geometry("Task_1")?.bounds?.width,
        watermarkVisible:
          watermark !== null &&
          getComputedStyle(watermark).display !== "none" &&
          getComputedStyle(watermark).visibility !== "hidden",
        attributed:
          svg.includes('data-bpmn-io-attribution="true"') &&
          svg.includes('href="https://bpmn.io"'),
        fill: taskVisual ? getComputedStyle(taskVisual).fill : "",
        stroke: taskVisual ? getComputedStyle(taskVisual).stroke : "",
      };
    } finally {
      canvas.dispose();
      adapter.dispose();
      host.remove();
    }
  }, source);

  expect(result).toEqual({
    opened: true,
    recovered: true,
    taskWidth: 100,
    watermarkVisible: true,
    attributed: true,
    fill: "rgb(254, 226, 226)",
    stroke: "rgb(220, 38, 38)",
  });
  expect(requested.some((url) => /bpmn|diagram-js/u.test(url))).toBe(true);
  expect(runtimeErrors).toEqual([]);
});

test("renders a recovered multi-pool collaboration", async ({ page }) => {
  const collaboration = await readFile(
    resolve("src/adapters/bpmn/fixtures/collaboration-missing-di.bpmn"),
    "utf8",
  );
  await page.goto("./");
  const result = await page.evaluate(async (bpmnSource) => {
    const moduleUrl = "/src/adapters/bpmn/index.ts";
    const api = (await import(moduleUrl)) as {
      BpmnDocumentAdapter: new () => {
        open(source: string): Promise<unknown>;
        recoverMissingDi(): Promise<{ source: string }>;
        dispose(): void;
      };
      BpmnCanvas: new () => {
        mount(container: HTMLElement, source: string): Promise<void>;
        exportSvg(): Promise<string>;
        dispose(): void;
      };
    };
    const adapter = new api.BpmnDocumentAdapter();
    await adapter.open(bpmnSource);
    const recovered = await adapter.recoverMissingDi();
    const host = document.createElement("div");
    host.style.cssText = "width:1000px;height:700px;position:fixed;inset:0";
    document.body.append(host);
    const canvas = new api.BpmnCanvas();
    try {
      await canvas.mount(host, recovered.source);
      const svg = await canvas.exportSvg();
      return {
        participants: host.querySelectorAll(
          '[data-element-id="Participant_Seller"], [data-element-id="Participant_Buyer"]',
        ).length,
        messageFlow:
          host.querySelector('[data-element-id="MessageFlow_1"]') !== null,
        attributed: svg.includes("Created with bpmn.io"),
      };
    } finally {
      canvas.dispose();
      adapter.dispose();
      host.remove();
    }
  }, collaboration);
  expect(result).toEqual({
    participants: 2,
    messageFlow: true,
    attributed: true,
  });
});

test("renders the recovered process notation corpus", async ({ page }) => {
  const process = await readFile(
    resolve("src/adapters/bpmn/fixtures/process-missing-di.bpmn"),
    "utf8",
  );
  await page.goto("./");
  const result = await page.evaluate(async (bpmnSource) => {
    const moduleUrl = "/src/adapters/bpmn/index.ts";
    const api = (await import(moduleUrl)) as {
      BpmnDocumentAdapter: new () => {
        open(source: string): Promise<unknown>;
        recoverMissingDi(): Promise<{ source: string }>;
        dispose(): void;
      };
      BpmnCanvas: new () => {
        mount(container: HTMLElement, source: string): Promise<void>;
        dispose(): void;
      };
    };
    const adapter = new api.BpmnDocumentAdapter();
    await adapter.open(bpmnSource);
    const recovered = await adapter.recoverMissingDi();
    const host = document.createElement("div");
    host.style.cssText = "width:1100px;height:700px;position:fixed;inset:0";
    document.body.append(host);
    const canvas = new api.BpmnCanvas();
    try {
      await canvas.mount(host, recovered.source);
      const visibleIds = [
        "Lane_Review",
        "Task_Review",
        "Gateway_1",
        "SubProcess_1",
        "DataRef_1",
        "Annotation_1",
        "Group_1",
      ].filter(
        (id) => host.querySelector(`[data-element-id="${id}"]`) !== null,
      );
      return {
        visibleIds,
        poweredBy: host.querySelector(".bjs-powered-by") !== null,
      };
    } finally {
      canvas.dispose();
      adapter.dispose();
      host.remove();
    }
  }, process);

  expect(result).toEqual({
    visibleIds: [
      "Lane_Review",
      "Task_Review",
      "Gateway_1",
      "SubProcess_1",
      "DataRef_1",
      "Annotation_1",
      "Group_1",
    ],
    poweredBy: true,
  });
});
