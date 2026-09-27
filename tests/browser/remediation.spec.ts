import { expect, test } from "@playwright/test";

test("guides a first flowchart through two labelled nodes and a connection", async ({
  page,
}) => {
  await page.goto("./");

  await expect(page.getByText("Turn an idea into a diagram")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add your first node" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Paste Mermaid" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Browse examples" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Add your first node" }).click();
  await expect(page.getByLabel("Node label")).toBeFocused();
  await page.getByLabel("Node label").fill("Start here");
  await page.getByRole("button", { name: "Apply label" }).click();
  await expect(page.locator('[data-element-id="node_1"]')).toContainText(
    "Start here",
  );

  await page.getByRole("button", { name: "Add another node" }).click();
  await page.getByLabel("Node label").fill("Finish");
  await page.getByRole("button", { name: "Apply label" }).click();
  await page.getByRole("button", { name: "Connect nodes" }).click();

  await expect(page.locator(".relationship[data-element-id]")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Getting started" }),
  ).toBeVisible();
  await expect(page.getByText("Changes since last download")).toBeVisible();
});

test("reconciles selection and separates keyboard selection from movement", async ({
  page,
}) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Show source" }).click();
  const source = page.getByLabel("Diagram source");
  await source.fill("flowchart TD\nA[First] --> B[Second]\n");
  await page.locator('[data-element-id="A"]').click();
  await expect(page.locator(".selection-summary code")).toHaveText("A");

  await source.fill("flowchart TD\nC[Third] --> D[Fourth]\n");
  await expect(page.locator(".selection-summary")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Edit selected element" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Delete selected element" }),
  ).toHaveCount(0);

  const canvas = page.getByRole("application", {
    name: "Interactive Mermaid diagram",
  });
  await canvas.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".selection-summary code")).toHaveText("C");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".selection-summary code")).toHaveText("D");
  await expect(source).not.toHaveValue(/position:/u);
  await page.keyboard.press("Alt+ArrowRight");
  await expect(source).toHaveValue(/position:/u);
});

test("turns parser noise into an actionable source error", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Show source" }).click();
  const source = page.getByLabel("Diagram source");
  await source.fill("flowchart TD\nA[Broken");

  await expect(page.locator(".diagnostics")).toContainText(
    "Missing closing “]” in node A.",
  );
  await expect(page.getByText("Technical details")).toBeVisible();
  await page.getByRole("button", { name: "Show in source" }).click();
  await expect(source).toBeFocused();
  expect(
    await source.evaluate((element: HTMLTextAreaElement) =>
      element.value.slice(element.selectionStart, element.selectionEnd),
    ),
  ).toBe("[Broken");
  await expect(page.locator('svg[data-outdated="true"]')).toBeVisible();
});

test("shows an announced gallery empty state and clears the search", async ({
  page,
}) => {
  await page.goto("./");
  await page
    .getByRole("button", { name: "Examples", exact: true })
    .first()
    .click();
  await page.getByLabel("Find an example").fill("zzzz");

  await expect(page.getByText("No examples match “zzzz”")).toBeVisible();
  const count = page.locator(".gallery-result-count");
  await expect(count).toContainText("0 examples");
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(count).toContainText("10 examples");
});

test("uses a current-document picker on a phone-sized viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./");
  await page.locator(".new-document-menu summary").click();
  await page.getByRole("button", { name: "C4 context", exact: true }).click();
  await page.locator(".new-document-menu summary").click();
  await page.getByRole("button", { name: "C4 container", exact: true }).click();

  const picker = page.getByLabel("Open documents (3)");
  await expect(picker).toBeVisible();
  await expect(picker.locator("option:checked")).toHaveText(
    "untitled-c4-container.mmd",
  );
  await expect(page.locator(".document-tabs")).not.toBeVisible();
});

test("dismisses routine download confirmation automatically", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("./");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .mmd" }).click();
  await download;
  await expect(page.getByText("Portable .mmd downloaded.")).toBeVisible();

  await page.clock.fastForward(5_000);
  await expect(page.getByText("Portable .mmd downloaded.")).toHaveCount(0);
});

test("uses readable choices and repairs a parallel connection in one undo step", async ({
  page,
}) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Show source" }).click();
  const source = page.getByLabel("Diagram source");
  const original = "flowchart TD\nA[One]-->B[Two]\nA-->B\n";
  await source.fill(original);

  await page.locator('[data-element-id="A"]').click();
  await expect(
    page
      .getByLabel("Selected node shape")
      .locator('option[value="lean_right"]'),
  ).toHaveText("▱ Slanted right");

  await page
    .locator(".relationship .relationship-hit-area")
    .first()
    .click({ force: true });
  await expect(
    page.getByText(/parallel connection needs a stable ID/u),
  ).toBeVisible();
  await page.getByLabel("Connector colour", { exact: true }).fill("#123456");
  await page.getByLabel("Connector colour", { exact: true }).blur();
  await expect(source).toHaveValue(/edge_1@-->/u);
  await expect(source).toHaveValue(/#123456/u);

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(source).toHaveValue(original);
});
