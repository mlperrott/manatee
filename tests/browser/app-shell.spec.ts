import { expect, test } from "@playwright/test";

test("edits a Mermaid document through source, keyboard, and inspector", async ({
  page,
}) => {
  const runtimeErrors: Error[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error));
  await page.goto("./");

  await expect(
    page.getByRole("img", { name: "Manatee Mermaid diagram" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Diagram canvas" }),
  ).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Inspector" }),
  ).toBeVisible();

  await page.locator('[data-element-id="request"]').click();
  await expect(
    page
      .getByRole("complementary", { name: "Inspector" })
      .getByText("Request received", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Fill colour").fill("#ffccaa");
  await page.getByRole("button", { name: "Apply appearance" }).click();

  await page.getByRole("button", { name: "Show source" }).click();
  const source = page.getByRole("textbox", { name: "Diagram source" });
  await expect(source).toHaveValue(/fill: "?#ffccaa"?/u);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(source).not.toHaveValue(/ffccaa/u);
  await expect(page.getByRole("button", { name: "Redo" })).toBeEnabled();

  await page.locator('[data-element-id="request"]').click();
  await expect(page.locator(".selection-summary code")).toHaveText("request");
  await page
    .getByRole("application", { name: "Interactive Mermaid diagram" })
    .focus();
  await page.keyboard.press("ArrowRight");
  await expect(source).toHaveValue(/position:/u);

  await source.fill("flowchart LR\n  request[");
  await expect(page.getByText("Source has errors")).toBeVisible();
  await expect(page.locator('svg[data-outdated="true"]')).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reset layout" }),
  ).toBeDisabled();
  expect(runtimeErrors).toEqual([]);
});

test("switches to the lazy BPMN editor and selects a process element", async ({
  page,
}) => {
  await page.goto("./");
  await page.getByRole("button", { name: "BPMN example" }).click();

  await expect(page.locator(".bpmn-surface .djs-container")).toBeVisible();
  await page.locator('[data-element-id="Task_Review"]').click();
  await expect(
    page
      .getByRole("complementary", { name: "Inspector" })
      .getByText("Review request", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Apply appearance" }),
  ).toBeEnabled();
});
