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

for (const direction of ["LR", "TD"]) {
  test(`process labels remain readable in ${direction} layout`, async ({
    page,
  }) => {
    await page.goto("./");
    await page.getByRole("button", { name: "Show source" }).click();
    const input = page.getByLabel("Diagram source");
    await input.fill(
      (await input.inputValue()).replace(
        "flowchart LR",
        `flowchart ${direction}`,
      ),
    );
    await expect(
      page.getByText("Preview current", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Hide source" }).click();
    const collisions = await page
      .locator("svg[data-manatee-renderer]")
      .evaluate((svg) => {
        const labels = [...svg.querySelectorAll("text")];
        const overlap = (a: DOMRect, b: DOMRect) =>
          Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
          Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
        const result: string[] = [];
        for (let i = 0; i < labels.length; i++)
          for (let j = i + 1; j < labels.length; j++) {
            if (
              overlap(
                labels[i]!.getBoundingClientRect(),
                labels[j]!.getBoundingClientRect(),
              )
            )
              result.push(
                `${labels[i]!.textContent} / ${labels[j]!.textContent}`,
              );
          }
        for (const group of svg.querySelectorAll("g.group")) {
          const rect = group.querySelector("rect")!.getBoundingClientRect();
          const text = group.querySelector("text")!.getBoundingClientRect();
          if (
            text.left < rect.left ||
            text.top < rect.top ||
            text.right > rect.right ||
            text.bottom > rect.bottom
          )
            result.push(
              `Heading outside ${group.getAttribute("data-element-id")}`,
            );
        }
        for (const path of svg.querySelectorAll<SVGPathElement>(
          ".relationship > path",
        )) {
          const matrix = path.getScreenCTM()!;
          for (const label of labels) {
            const box = label.getBoundingClientRect();
            for (
              let distance = 0;
              distance < path.getTotalLength();
              distance += 2
            ) {
              const point = path
                .getPointAtLength(distance)
                .matrixTransform(matrix);
              if (
                point.x > box.left + 0.5 &&
                point.x < box.right - 0.5 &&
                point.y > box.top + 0.5 &&
                point.y < box.bottom - 0.5
              ) {
                result.push(`Connector through ${label.textContent}`);
                break;
              }
            }
          }
        }
        return result;
      });
    expect(collisions).toEqual([]);
  });
}
