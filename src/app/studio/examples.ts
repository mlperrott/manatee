import { stringify } from "yaml";
import process from "../../mermaid/fixtures/process-notation.mmd?raw";
import swimlane from "../../mermaid/fixtures/swimlane-baseline.mmd?raw";
import context from "../../mermaid/fixtures/c4-context-baseline.mmd?raw";
import containers from "../../mermaid/fixtures/c4-container-baseline.mmd?raw";
import type { MermaidFamily } from "../../mermaid/model";
export interface StudioExample {
  id: string;
  title: string;
  category: string;
  description: string;
  notice: string;
  try: readonly string[];
  source: string;
}
const enriched = (semantic: string, settings: Record<string, unknown>) =>
  `---\n${stringify({ manatee: { version: 1, ...settings } })}---\n${semantic}`;
const basic = `flowchart TD
  start([Request received]) --> review[Review request]
  review --> decision{Approved?}
  decision yes@-->|Yes| complete([Complete])
  decision no@-->|No| revise[Revise request]
  revise --> review
`;
const simple = enriched(basic, {
  elements: {
    nodes: {
      start: { notation: { type: "start-event" } },
      review: { notation: { type: "task" } },
      decision: { notation: { type: "exclusive-gateway" } },
      complete: { notation: { type: "end-event" } },
      revise: { notation: { type: "task" } },
    },
  },
});
const stylingSource = `flowchart TD
  discover[Discover]:::active --> design[Design]:::active
  design --> deliver[Deliver]:::future
`;
export const studioExamples: readonly StudioExample[] = [
  {
    id: "simple-bpmn",
    title: "Simple BPMN",
    category: "Start here",
    description: "A small process with a decision and a revision loop.",
    notice:
      "Ordinary Mermaid supplies the process structure. Manatee adds task, event and gateway notation through front matter.",
    try: [
      "Select Review request and change its process notation.",
      "Change a label with Mermaid source edits enabled; then undo it.",
    ],
    source: simple,
  },
  {
    id: "swimlanes",
    title: "BPMN with swim lanes",
    category: "Process diagrams",
    description: "See how responsibilities and handoffs become visible.",
    notice:
      "Native Mermaid swimlanes retain their group membership. Manatee adds lane notation and independently styled containers.",
    try: [
      "Select Delivery and change its fill or typography.",
      "Move Plan into Sales using Edit selected element → Parent group.",
    ],
    source: enriched(swimlane, {
      elements: {
        lanes: {
          sales: { notation: { type: "lane" }, style: { fill: "#e6f3ef" } },
          delivery: { notation: { type: "lane" }, style: { fill: "#edf0fa" } },
        },
        nodes: { qualify: { notation: { type: "exclusive-gateway" } } },
      },
    }),
  },
  {
    id: "process",
    title: "Advanced process",
    category: "Process diagrams",
    description:
      "Pools, lanes, messages, parallel paths and an interrupting timeout.",
    notice:
      "The boundary timer attaches to Review request and hides only its explicitly named fallback connection. Other Mermaid viewers retain that connection.",
    try: [
      "Select Review timeout and adjust its anchor side and offset.",
      "Change a message flow’s colour; its identifying line convention stays intact.",
    ],
    source: process,
  },
  {
    id: "c4-context",
    title: "C4 system context",
    category: "Architecture",
    description: "People, external systems, databases and queues.",
    notice:
      "Manatee lays out supported C4 elements and lets you style them without changing their Mermaid definitions.",
    try: [
      "Edit a system’s description through Edit selected element.",
      "Disable Mermaid source edits, then change typography.",
    ],
    source: context,
  },
  {
    id: "c4-container",
    title: "C4 containers",
    category: "Architecture",
    description: "Technology and responsibilities inside a system boundary.",
    notice:
      "C4 container types, technology labels and relationship descriptions are available through the visual editor.",
    try: [
      "Select Web app and change its technology.",
      "Add a container and connect it to Database.",
    ],
    source: containers,
  },
  ...[
    {
      id: "quiet",
      title: "Quiet monochrome",
      fill: "#ffffff",
      outline: "#39434b",
      text: "#222b32",
      width: 1,
      weight: 400,
      pattern: "solid",
    },
    {
      id: "bold",
      title: "Bold presentation",
      fill: "#143d3c",
      outline: "#0b6660",
      text: "#ffffff",
      width: 3,
      weight: 700,
      pattern: "solid",
    },
    {
      id: "soft",
      title: "Soft colour and transparency",
      fill: "#b8dbef99",
      outline: "#5b75a4",
      text: "#293d5d",
      width: 2,
      weight: 500,
      pattern: "dashed",
    },
  ].map((theme): StudioExample => ({
    id: theme.id,
    title: theme.title,
    category: "Styling variations",
    description:
      "The same diagram, presented with a different visual treatment.",
    notice:
      "A class-matching styling rule applies fill, outline and typography together. These are editable examples; styles are saved in the document.",
    try: [
      "Open Attributes and styling rules and edit Rule 1.",
      "Override one node’s fill, then reset it to inherit the rule again.",
    ],
    source: enriched(stylingSource, {
      rules: [
        {
          match: { classes: ["active"] },
          style: {
            fill: theme.fill,
            outline: {
              color: theme.outline,
              width: theme.width,
              style: theme.pattern,
            },
            text: {
              color: theme.text,
              size: 18,
              weight: theme.weight,
              italic: false,
            },
          },
        },
        {
          match: { classes: ["future"] },
          style: {
            fill: "#ffffff",
            outline: { color: "#879299", style: "dotted" },
            text: { italic: true },
          },
        },
      ],
    }),
  })),
  {
    id: "attributes",
    title: "Attribute-driven styling",
    category: "Go deeper",
    description:
      "Typed values and combined conditions communicate status and risk.",
    notice:
      "Rules match IDs, classes and typed attributes. Every condition must match; later rules and individual overrides take precedence.",
    try: [
      "Change Deliver’s risk from 8 to 2 and watch its appearance update.",
      "Edit the rule, add a condition, or reorder rules to explore precedence.",
    ],
    source: enriched(stylingSource, {
      elements: {
        nodes: {
          discover: {
            attributes: { status: "complete", risk: 1, approved: true },
          },
          design: { attributes: { status: "active", risk: 4, approved: true } },
          deliver: {
            attributes: { status: "active", risk: 8, approved: false },
          },
        },
      },
      rules: [
        {
          match: {
            attributes: {
              status: { in: ["active", "complete"] },
              risk: { exists: true },
            },
          },
          style: { fill: "#d7eee6", outline: { color: "#28766b" } },
        },
        {
          match: { attributes: { risk: { gte: 5 }, approved: { eq: false } } },
          style: {
            fill: "#f9dbc8",
            outline: { color: "#a84925", width: 3 },
            text: { weight: 700 },
          },
        },
      ],
    }),
  },
  {
    id: "layout",
    title: "Saved layout and source edits",
    category: "Go deeper",
    description: "Manual positions remain saved while the diagram evolves.",
    notice:
      "Manatee stores positions relative to their parent and computes automatic layout for the remaining elements. Spacing is independently editable.",
    try: [
      "Move Discover, then edit another node’s label.",
      "Set exact coordinates or return the selection to automatic positioning.",
    ],
    source: enriched(stylingSource, {
      layout: { spacing: { node: 64, layer: 96, groupPadding: 32, lane: 40 } },
      elements: { nodes: { discover: { position: { x: 48, y: 36 } } } },
    }),
  },
];
export const newDocumentSources: Record<MermaidFamily, string> = {
  flowchart: "flowchart TD\n",
  swimlane: "swimlane-beta TD\nsubgraph lane1[First lane]\nend\n",
  "c4-context": 'C4Context\nSystem(first, "New system")\n',
  "c4-container":
    'C4Container\nContainer(first, "New container", "Technology")\n',
};
