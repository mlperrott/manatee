import { expect, test } from "@playwright/test";

function releaseDiagram(): string {
  const lines = ["flowchart LR"];
  for (let group = 0; group < 10; group += 1) {
    lines.push(`subgraph group${group}[Group ${group}]`);
    for (let node = 0; node < 10; node += 1) {
      const index = group * 10 + node;
      lines.push(`node${index}[Node ${index}]`);
    }
    lines.push("end");
  }
  for (let index = 0; index < 99; index += 1) {
    lines.push(`node${index} --> node${index + 1}`);
  }
  for (let index = 0; index < 51; index += 1) {
    lines.push(`node${index} --> node${index + 2}`);
  }
  return lines.join("\n");
}

test("renders the supported ceiling within the release budget", async ({
  page,
}) => {
  await page.goto("./");
  const result = await page.evaluate(async (source) => {
    const moduleUrl = "/src/mermaid/index.ts";
    const api = await import(moduleUrl);
    const document = new api.MermaidDocument();
    try {
      await document.open("flowchart LR\n  warmup --> ready");
      const started = performance.now();
      const snapshot = await document.open(source);
      const scene = snapshot.scene;
      if (!scene) throw new Error("Mermaid document did not produce a scene.");
      api.renderMermaidSvg(scene);
      return {
        valid: snapshot.valid,
        nodes: scene.nodes.length,
        relationships: scene.relationships.length,
        groups: scene.groups.length,
        elapsed: performance.now() - started,
      };
    } finally {
      document.dispose();
    }
  }, releaseDiagram());

  expect(result).toMatchObject({
    valid: true,
    nodes: 100,
    relationships: 150,
    groups: 10,
  });
  expect(result.elapsed).toBeLessThan(2_000);
});

test("renders the enriched process starter within the render budget", async ({
  page,
}) => {
  await page.goto("./");
  const started = await page.evaluate(() => performance.now());
  await page.getByRole("button", { name: "Process example" }).click();
  await expect(page.locator('[data-notation="boundary-timer"]')).toBeVisible();
  await expect(page.locator('[data-notation="message-flow"]')).toBeVisible();
  const elapsed = await page.evaluate(
    (before) => performance.now() - before,
    started,
  );
  expect(elapsed).toBeLessThan(2_000);
});

test("settles a moved node and its routes within 250 ms", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator('[data-element-id="request"]')).toBeVisible();
  await page.getByRole("button", { name: "Show source" }).click();
  await page.locator('[data-element-id="request"]').click();
  const surface = page.getByRole("application", {
    name: "Interactive Mermaid diagram",
  });
  await surface.focus();
  const started = await page.evaluate(() => performance.now());
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() =>
    document
      .querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Diagram source"]',
      )
      ?.value.includes("position:"),
  );
  const elapsed = await page.evaluate(
    (before) => performance.now() - before,
    started,
  );
  expect(elapsed).toBeLessThan(250);
});
