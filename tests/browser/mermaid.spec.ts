import { expect, test } from "@playwright/test";

test("normalizes all supported Mermaid families in the browser", async ({
  page,
}) => {
  const runtimeErrors: Error[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error));
  await page.goto("./");

  const result = await page.evaluate(async () => {
    const moduleUrl = "/src/mermaid/index.ts";
    const { MermaidDocument } = (await import(moduleUrl)) as {
      MermaidDocument: new () => {
        open(source: string): Promise<{
          valid: boolean;
          model?: { family: string; nodes: readonly unknown[] };
        }>;
      };
    };
    const sources = [
      "flowchart LR\nA-->B",
      "swimlane-beta LR\nsubgraph one[One]\nA-->B\nend",
      'C4Context\nPerson(user, "User")\nSystem(system, "System")\nRel(user, system, "Uses")',
      'C4Container\nPerson(user, "User")\nContainer(app, "App", "TypeScript", "UI")\nRel(user, app, "Uses")',
    ];
    const snapshots = [];
    for (const source of sources) {
      snapshots.push(await new MermaidDocument().open(source));
    }
    return snapshots.map(({ valid, model }) => ({
      valid,
      family: model?.family,
      nodeCount: model?.nodes.length,
    }));
  });

  expect(result).toEqual([
    { valid: true, family: "flowchart", nodeCount: 2 },
    { valid: true, family: "swimlane", nodeCount: 2 },
    { valid: true, family: "c4-context", nodeCount: 2 },
    { valid: true, family: "c4-container", nodeCount: 2 },
  ]);
  expect(runtimeErrors).toEqual([]);
});

test("lays out in a worker and renders the same SVG for preview and export", async ({
  page,
}) => {
  const runtimeErrors: Error[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error));
  await page.goto("./");

  const result = await page.evaluate(async () => {
    const moduleUrl = "/src/mermaid/index.ts";
    const api = (await import(moduleUrl)) as {
      MermaidDocument: new () => {
        open(source: string): Promise<{
          scene?: {
            width: number;
            nodes: readonly unknown[];
            relationships: readonly unknown[];
          };
        }>;
        dispose(): void;
      };
      renderMermaidPreviewSvg(scene: unknown): string;
      renderMermaidExportSvg(scene: unknown): string;
    };
    const document = new api.MermaidDocument();
    try {
      const snapshot = await document.open(
        "flowchart LR\nA[**Start**] --> B{Ready?}\nB --> C[(Store)]",
      );
      const scene = snapshot.scene;
      if (!scene) throw new Error("Mermaid document did not produce a scene.");
      const preview = api.renderMermaidPreviewSvg(scene);
      return {
        width: scene.width,
        nodeCount: scene.nodes.length,
        relationshipCount: scene.relationships.length,
        identical: preview === api.renderMermaidExportSvg(scene),
        hasBold: preview.includes('font-weight="700"'),
      };
    } finally {
      document.dispose();
    }
  });

  expect(result).toMatchObject({
    nodeCount: 3,
    relationshipCount: 2,
    identical: true,
    hasBold: true,
  });
  expect(result.width).toBeGreaterThan(0);
  expect(runtimeErrors).toEqual([]);
});

test("renders the process fixture in ordinary Mermaid", async ({ page }) => {
  await page.goto("./");
  const result = await page.evaluate(async () => {
    const source = await fetch(
      "/src/mermaid/fixtures/process-notation.mmd",
    ).then((response) => response.text());
    const moduleUrl = "/src/mermaid/index.ts";
    const { renderOrdinaryMermaid } = (await import(moduleUrl)) as {
      renderOrdinaryMermaid(source: string): Promise<string>;
    };
    const svg = await renderOrdinaryMermaid(source);
    const text = new DOMParser().parseFromString(svg, "image/svg+xml")
      .documentElement.textContent;
    return {
      isSvg: svg.includes("<svg"),
      hasRequest: text.includes("Request received"),
      hasTimeout: text.includes("Review timeout"),
      hasPools: text.includes("Customer") && text.includes("Company"),
    };
  });
  expect(result).toEqual({
    isSvg: true,
    hasRequest: true,
    hasTimeout: true,
    hasPools: true,
  });
});
