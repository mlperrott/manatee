import { expect, test } from "@playwright/test";

test("protects imported source while exposing presentation controls", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./");
  await expect(page.locator("svg[data-manatee-renderer]")).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({
    name: "import.mmd",
    mimeType: "text/plain",
    buffer: Buffer.from("flowchart LR\nA[Imported] --> B[Second]\n"),
  });
  await expect(
    page.getByRole("tab", { name: "import.mmd", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Allow Mermaid source edits")).not.toBeChecked();
  await page.getByText("Create and edit structure", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add node", exact: true }),
  ).toBeDisabled();
  await page.locator('[data-element-id="A"]').click();
  await page.getByLabel("Fill colour", { exact: true }).fill("#aabbcc88");
  await page.getByLabel("Fill colour", { exact: true }).blur();
  await page.getByText("Typography", { exact: true }).click();
  await page.getByLabel("Text size", { exact: true }).fill("24");
  await page.getByLabel("Text size", { exact: true }).blur();
  await page.getByRole("button", { name: "Show source" }).click();
  await expect(page.getByLabel("Diagram source")).toHaveJSProperty(
    "readOnly",
    true,
  );
  await expect(page.getByLabel("Diagram source")).toHaveValue(/#aabbcc88/);
  await expect(page.getByLabel("Diagram source")).toHaveValue(/size: 24/);
  await page.getByLabel("Allow Mermaid source edits").check();
  await expect(
    page.getByRole("button", { name: "Add node", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Edit selected element", exact: true })
    .click();
  await page.getByLabel("Element label").fill("Renamed");
  await page
    .getByRole("button", { name: "Update element", exact: true })
    .click();
  await expect(page.locator('[data-element-id="A"]')).toContainText("Renamed");
  await page.getByLabel("Allow Mermaid source edits").uncheck();
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeDisabled();
  expect(errors).toEqual([]);
});

test("opens teaching examples in separate tabs and restores the workspace", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator("svg[data-manatee-renderer]")).toBeVisible();
  await page
    .getByRole("button", { name: "Example gallery", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Example gallery" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open C4 containers", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "c4-container.mmd", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-element-id="web"]')).toBeVisible();
  await expect(
    page.getByText("About this example: C4 containers", { exact: true }),
  ).toBeVisible();
  await page.getByText("Create and edit structure", { exact: true }).click();
  await page.locator('[data-element-id="web"]').click();
  await page
    .getByRole("button", { name: "Edit selected element", exact: true })
    .click();
  await page.getByLabel("Technology", { exact: true }).fill("Solid");
  await page
    .getByRole("button", { name: "Update element", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "c4-container.mmd •", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("tab", { name: "request-flow.mmd", exact: true })
    .click();
  await expect(page.locator('[data-element-id="review"]')).toBeVisible();
  await page
    .getByRole("tab", { name: "c4-container.mmd •", exact: true })
    .click();
  await expect(page.getByText("Recovery saved", { exact: true })).toBeVisible();
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(
    page.getByRole("tab", { name: "c4-container.mmd •", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-element-id="web"]')).toContainText("Solid");
  await expect(page.getByRole("tab")).toHaveCount(2);
});

test("creates nodes, groups and connections without typing Mermaid", async ({
  page,
}) => {
  const solidDiagnostics: string[] = [];
  page.on("console", (message) => {
    if (/\[[A-Z_]+\]/u.test(message.text()))
      solidDiagnostics.push(message.text());
  });
  await page.goto("./");
  await expect(page.locator("svg[data-manatee-renderer]")).toBeVisible();
  await page.locator(".new-document-menu summary").click();
  await page.getByRole("button", { name: "Flowchart", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "untitled-flowchart.mmd", exact: true }),
  ).toBeVisible();
  await page.getByText("Create and edit structure", { exact: true }).click();
  for (const [id, label] of [
    ["first", "First node"],
    ["second", "Second node"],
  ]) {
    await page.getByRole("button", { name: "Add node", exact: true }).click();
    await page.getByLabel("Element identifier").fill(id!);
    await page.getByLabel("Element label").fill(label!);
    await page
      .getByRole("button", { name: "Create node", exact: true })
      .click();
    await expect(page.locator(`[data-element-id="${id}"]`)).toBeVisible();
  }
  await page.getByRole("button", { name: "Add group", exact: true }).click();
  await page.getByLabel("Element identifier").fill("team");
  await page.getByLabel("Element label").fill("Team");
  await page.getByRole("button", { name: "Create group", exact: true }).click();
  await expect(page.locator('[data-element-id="team"]')).toBeVisible();
  await page
    .getByRole("button", { name: "Add connection", exact: true })
    .click();
  await page.getByLabel("Element label").fill("Next");
  await page.getByLabel("Connection from").selectOption("first");
  await page.getByLabel("Connection to").selectOption("second");
  await page
    .getByRole("button", { name: "Create connection", exact: true })
    .click();
  await expect(page.locator("svg")).toContainText("Next");
  await page.locator('[data-element-id="first"]').click();
  await page
    .getByRole("button", { name: "Edit selected element", exact: true })
    .click();
  await page.getByLabel("Parent group").selectOption("team");
  await page
    .getByRole("button", { name: "Update element", exact: true })
    .click();
  await page.getByRole("button", { name: "Show source" }).click();
  await expect(page.getByLabel("Diagram source")).toHaveValue(
    /subgraph team[^]*first\[/,
  );
  expect(solidDiagnostics).toEqual([]);
});

test("edits typed attributes and complete styling rules", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("svg[data-manatee-renderer]")).toBeVisible();
  await page
    .getByRole("button", { name: "Example gallery", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open Attribute-driven styling", exact: true })
    .click();
  await page.locator('[data-element-id="deliver"]').click();
  await page.getByLabel("Attribute risk", { exact: true }).fill("2");
  await page.getByLabel("Attribute risk", { exact: true }).blur();
  await expect(
    page.locator('[data-element-id="deliver"] rect').first(),
  ).toHaveAttribute("fill", "#d7eee6");
  await page.getByText("Attributes and styling rules", { exact: true }).click();
  await page.getByRole("button", { name: "Edit rule 2", exact: true }).click();
  await page.getByLabel("Condition 1 value", { exact: true }).fill("1");
  await page.getByRole("button", { name: "Save rule", exact: true }).click();
  await expect(
    page.locator('[data-element-id="deliver"] rect').first(),
  ).toHaveAttribute("fill", "#f9dbc8");
  await page
    .getByRole("button", { name: "Move rule 2 up", exact: true })
    .click();
  await expect(
    page.locator('[data-element-id="deliver"] rect').first(),
  ).toHaveAttribute("fill", "#d7eee6");
});
