import { expect, test } from "@playwright/test";

test("rectangle aliases display the selected shape on canvas and in Inspector", async ({
  page,
}) => {
  await page.goto("./");
  await page.locator('input[type="file"]').setInputFiles({
    name: "shapes.mmd",
    mimeType: "text/plain",
    buffer: Buffer.from("flowchart LR\nA[Rectangle] --> B(Rounded)\n"),
  });
  await page.locator('.node[data-element-id="A"]').click();
  await expect(page.getByLabel("Canvas node type")).toHaveValue("rectangle");
  await expect(page.getByLabel("Selected node shape")).toHaveValue("rectangle");
  await page.getByLabel("Allow Mermaid source edits").check();
  await page.getByLabel("Canvas node type").selectOption("diamond");
  await expect(page.getByLabel("Selected node shape")).toHaveValue("diamond");
  await page.getByLabel("Selected node shape").selectOption("rectangle");
  await expect(page.getByLabel("Canvas node type")).toHaveValue("rectangle");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByLabel("Canvas node type")).toHaveValue("diamond");
  await page.locator('.node[data-element-id="B"]').click();
  await expect(page.getByLabel("Canvas node type")).toHaveValue("round");
  await expect(page.getByLabel("Selected node shape")).toHaveValue("round");
  await page.getByRole("button", { name: "Show source", exact: true }).click();
  await expect(page.getByLabel("Diagram source")).toHaveValue(
    /A\{"Rectangle"\}/,
  );
});
