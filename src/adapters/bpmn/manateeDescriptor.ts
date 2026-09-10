import { MANATEE_BPMN_NAMESPACE } from "../../core/bpmn/bpmnSource";

export const manateeModdleDescriptor = Object.freeze({
  name: "Manatee",
  uri: MANATEE_BPMN_NAMESPACE,
  prefix: "manatee",
  xml: { tagAlias: "lowerCase" },
  types: [
    {
      name: "Presentation",
      properties: [
        { name: "version", type: "String", isAttr: true },
        { name: "zoom", type: "Real", isAttr: true },
        { name: "layout", type: "Layout" },
        { name: "elements", type: "Element", isMany: true },
        { name: "rules", type: "Rule", isMany: true },
      ],
    },
    {
      name: "Layout",
      properties: [
        { name: "nodeSpacing", type: "Real", isAttr: true },
        { name: "layerSpacing", type: "Real", isAttr: true },
        { name: "laneSpacing", type: "Real", isAttr: true },
      ],
    },
    {
      name: "Element",
      properties: [
        { name: "ref", type: "String", isAttr: true },
        { name: "fill", type: "String", isAttr: true },
        { name: "stroke", type: "String", isAttr: true },
        { name: "strokeWidth", type: "Real", isAttr: true },
        { name: "lineStyle", type: "String", isAttr: true },
        { name: "textColor", type: "String", isAttr: true },
        { name: "fontSize", type: "Real", isAttr: true },
        { name: "fontWeight", type: "Integer", isAttr: true },
        { name: "italic", type: "Boolean", isAttr: true },
        { name: "attributes", type: "Attribute", isMany: true },
      ],
    },
    {
      name: "Attribute",
      properties: [
        { name: "name", type: "String", isAttr: true },
        { name: "value", type: "String", isAttr: true },
      ],
    },
    {
      name: "Rule",
      properties: [
        { name: "type", type: "String", isAttr: true },
        { name: "property", type: "String", isAttr: true },
        { name: "operator", type: "String", isAttr: true },
        { name: "value", type: "String", isAttr: true },
        { name: "fill", type: "String", isAttr: true },
        { name: "stroke", type: "String", isAttr: true },
      ],
    },
  ],
});
