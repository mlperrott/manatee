import { describe, expect, it } from "vitest";

import { UnsafeSourcePatchError } from "../source/patches";
import {
  patchBpmnEdgeWaypoints,
  patchBpmnShapeBounds,
  patchManateePresentationAttributes,
  readBpmnSource,
} from "./bpmnSource";
import { indexXmlSource } from "./xmlRangeIndex";

const bpmn = `<?xml version="1.0" encoding="UTF-8"?>
<!-- preserve this comment -->
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI">
  <bpmn:process id="Process_1">
    <bpmn:task id="Task_1" name="Keep > this" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Task_1" targetRef="Task_2" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Shape_1" bpmnElement="Task_1">
        <dc:Bounds x="100" y="120" width="80" height="60" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Edge_1" bpmnElement="Flow_1">
        <di:waypoint x="180" y="150" />
        <di:waypoint x="260" y="150" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;

describe("BPMN source patching", () => {
  it("recognizes BPMN without changing untouched source", () => {
    const read = readBpmnSource(bpmn);
    expect(read).toMatchObject({ kind: "bpmn", valid: true, diagnostics: [] });
    expect(bpmn).toContain("<!-- preserve this comment -->");
  });

  it("patches only the requested Bounds attribute values", () => {
    const result = patchBpmnShapeBounds(bpmn, "Task_1", {
      x: 10,
      y: 20,
      width: 90,
      height: 70,
    });
    expect(result.source).toContain(
      '<dc:Bounds x="10" y="20" width="90" height="70" />',
    );
    expect(result.patches).toHaveLength(4);
    expect(result.source.slice(0, bpmn.indexOf("<dc:Bounds"))).toBe(
      bpmn.slice(0, bpmn.indexOf("<dc:Bounds")),
    );
    expect(result.source).toContain(
      '<bpmn:task id="Task_1" name="Keep > this" />',
    );
  });

  it("replaces only the edge waypoints and keeps surrounding indentation", () => {
    const result = patchBpmnEdgeWaypoints(bpmn, "Flow_1", [
      { x: 200, y: 210 },
      { x: 300, y: 310 },
      { x: 400, y: 410 },
    ]);
    expect(result.source).toContain(
      '        <di:waypoint x="200" y="210" />\n' +
        '        <di:waypoint x="300" y="310" />\n' +
        '        <di:waypoint x="400" y="410" />',
    );
    expect(result.source).toContain(
      '<bpmn:sequenceFlow id="Flow_1" sourceRef="Task_1" targetRef="Task_2" />',
    );
  });

  it("adds and then narrowly updates Manatee presentation metadata", () => {
    const inserted = patchManateePresentationAttributes(bpmn, { zoom: 1.25 });
    expect(inserted.source).toContain("<bpmn:extensionElements>");
    expect(inserted.source).toContain(
      'xmlns:manatee="https://mlperrott.github.io/manatee/bpmn" version="1" zoom="1.25"',
    );
    const updated = patchManateePresentationAttributes(inserted.source, {
      zoom: 2,
    });
    expect(updated.patches).toHaveLength(1);
    expect(updated.source).toContain('version="1" zoom="2"');
    expect(updated.source).toContain("<!-- preserve this comment -->");
  });

  it("refuses to update an unsupported Manatee extension version", () => {
    const withUnsupportedMetadata = patchManateePresentationAttributes(bpmn, {
      zoom: 1,
    }).source.replace('version="1"', 'version="2"');
    expect(() =>
      patchManateePresentationAttributes(withUnsupportedMetadata, { zoom: 2 }),
    ).toThrow(UnsafeSourcePatchError);
  });

  it("refuses ambiguous or malformed edits without producing rewritten source", () => {
    const duplicate = bpmn.replace(
      "      <bpmndi:BPMNShape",
      '      <bpmndi:BPMNShape id="Duplicate" bpmnElement="Task_1"><dc:Bounds x="0" y="0" width="1" height="1" /></bpmndi:BPMNShape>\n      <bpmndi:BPMNShape',
    );
    expect(() =>
      patchBpmnShapeBounds(duplicate, "Task_1", {
        x: 1,
        y: 2,
        width: 3,
        height: 4,
      }),
    ).toThrow(UnsafeSourcePatchError);
    expect(() =>
      patchBpmnShapeBounds(bpmn.slice(0, -25), "Task_1", {
        x: 1,
        y: 2,
        width: 3,
        height: 4,
      }),
    ).toThrow(UnsafeSourcePatchError);
  });
});

describe("XML range indexing", () => {
  it("skips comments and CDATA and accepts greater-than signs in quotes", () => {
    const indexed = indexXmlSource(
      '<root value="a > b"><!-- <fake/> --><![CDATA[<also-fake/>]]><child /></root>',
    );
    expect(indexed.valid).toBe(true);
    expect(indexed.elements.map(({ localName }) => localName)).toEqual([
      "root",
      "child",
    ]);
  });
});
