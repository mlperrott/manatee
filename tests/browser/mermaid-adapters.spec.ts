import { expect, test } from "@playwright/test";

test("normalizes all supported Mermaid families in the browser", async ({
  page,
}) => {
  const runtimeErrors: Error[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error));
  await page.goto("./");

  const result = await page.evaluate(async () => {
    const moduleUrl = "/src/adapters/mermaid/index.ts";
    const { MermaidDocumentAdapter } = (await import(moduleUrl)) as {
      MermaidDocumentAdapter: new () => {
        open(source: string): Promise<{
          valid: boolean;
          semanticModel?: { family: string; nodes: readonly unknown[] };
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
      snapshots.push(await new MermaidDocumentAdapter().open(source));
    }
    return snapshots.map(({ valid, semanticModel }) => ({
      valid,
      family: semanticModel?.family,
      nodeCount: semanticModel?.nodes.length,
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
