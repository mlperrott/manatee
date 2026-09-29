import { expect, test, type Page } from "@playwright/test";

const source = `---
manatee:
  version: 1
  elements:
    nodes:
      A: {position: {x: 60, y: 80}}
      B: {position: {x: 300, y: 170}}
      C: {position: {x: 640, y: 290}}
---
flowchart LR
A[First] --> B[Second]
B --> C[Third]
`;

async function open(page: Page) {
  await page.goto("./");
  await page.locator('input[type="file"]').setInputFiles({
    name: "selection.mmd",
    mimeType: "text/plain",
    buffer: Buffer.from(source),
  });
  await expect(page.locator('.node[data-element-id="C"]')).toBeVisible();
}

test("modifier selection, preview, align, distribute and undo preserve imported source", async ({
  page,
}) => {
  await open(page);
  await page.locator('.node[data-element-id="A"]').click();
  await page.keyboard.down("Shift");
  await page.locator('.node[data-element-id="B"]').click();
  await page.keyboard.up("Shift");
  await page
    .locator('.node[data-element-id="C"]')
    .click({ modifiers: ["Control"] });
  await expect(page.locator(".node.selected")).toHaveCount(3);
  await expect(page.locator(".node-quick-add")).toHaveCount(0);
  await expect(page.getByLabel("Allow Mermaid source edits")).not.toBeChecked();
  await page.getByLabel("Arrange selection").selectOption("top");
  const original = await page
    .locator('.node[data-element-id="B"] > rect')
    .getAttribute("y");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.locator('.node[data-element-id="B"]')).toHaveAttribute(
    "transform",
    /translate/,
  );
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(async () => {
    const y = await page
      .locator('.node[data-element-id="A"] > rect')
      .getAttribute("y");
    expect(
      await page.locator('.node[data-element-id="B"] > rect').getAttribute("y"),
    ).toBe(y);
    expect(
      await page.locator('.node[data-element-id="C"] > rect').getAttribute("y"),
    ).toBe(y);
  }).toPass();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    page.locator('.node[data-element-id="B"] > rect'),
  ).toHaveAttribute("y", original!);
  await expect(page.locator(".node.selected")).toHaveCount(3);
  await page.getByLabel("Arrange selection").selectOption("horizontal");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(async () => {
    const rects = await page.locator(".node > rect").evaluateAll((elements) =>
      elements.map((element) => ({
        x: Number(element.getAttribute("x")),
        width: Number(element.getAttribute("width")),
      })),
    );
    expect(rects[1]!.x - rects[0]!.x - rects[0]!.width).toBeCloseTo(
      rects[2]!.x - rects[1]!.x - rects[1]!.width,
    );
  }).toPass();
  await page.getByRole("button", { name: "Show source", exact: true }).click();
  await expect(page.getByLabel("Diagram source")).toHaveValue(
    /flowchart LR\nA\[First\] --> B\[Second\]\nB --> C\[Third\]/,
  );
});

test("keyboard selection is separate from movement and toggling membership", async ({
  page,
}) => {
  await open(page);
  const surface = page.getByRole("application", {
    name: "Interactive Mermaid diagram",
  });
  await surface.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.locator(".node.selected")).toHaveCount(2);
  const before = await page
    .locator('.node[data-element-id="A"] > rect')
    .getAttribute("x");
  await page.keyboard.press("Alt+ArrowRight");
  await expect(
    page.locator('.node[data-element-id="A"] > rect'),
  ).toHaveAttribute("x", String(Number(before) + 5));
  await page.keyboard.press("Alt+Shift+ArrowRight");
  await expect(
    page.locator('.node[data-element-id="A"] > rect'),
  ).toHaveAttribute("x", String(Number(before) + 25));
  await page
    .locator('.node[data-element-id="B"]')
    .click({ modifiers: ["Shift"] });
  await expect(page.locator(".node.selected")).toHaveCount(1);
  await surface.focus();
  await page.keyboard.press("Control+a");
  await expect(page.locator(".node.selected")).toHaveCount(3);
  await page.keyboard.press("Escape");
  await expect(page.locator(".node.selected")).toHaveCount(0);
});

test("marquee selects enclosed nodes and dragging previews all affected connections", async ({
  page,
}) => {
  await open(page);
  const a = (await page.locator('.node[data-element-id="A"]').boundingBox())!;
  const b = (await page.locator('.node[data-element-id="B"]').boundingBox())!;
  await page.mouse.move(a.x - 8, a.y - 8);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width + 8, b.y + b.height + 8, { steps: 8 });
  await expect(page.locator(".selection-marquee")).toBeVisible();
  await page.mouse.up();
  await expect(page.locator(".node.selected")).toHaveCount(2);
  const connection = page
    .locator(".relationship > path:not(.relationship-hit-area)")
    .first();
  const original = await connection.getAttribute("d");
  const selected = (await page
    .locator('.node[data-element-id="A"]')
    .boundingBox())!;
  await page.mouse.move(
    selected.x + selected.width / 2,
    selected.y + selected.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    selected.x + selected.width / 2 + 30,
    selected.y + selected.height / 2 + 25,
    { steps: 8 },
  );
  await expect(connection).not.toHaveAttribute("d", original!);
  await expect(page.locator('.node[data-element-id="B"]')).toHaveAttribute(
    "transform",
    /translate/,
  );
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(connection).toHaveAttribute("d", original!);
  await expect(page.locator(".node.selected")).toHaveCount(2);
});
