import { expect, test } from "@playwright/test";

test("deployed release loads workers, lazy BPMN, files, and exports", async ({
  page,
}) => {
  test.skip(!process.env.MANATEE_BASE_URL, "Runs after a Pages deployment.");
  const failedResponses: string[] = [];
  page.on("response", (response) => {
    if (response.status() >= 400) failedResponses.push(response.url());
  });

  await page.goto("./");
  await expect(page.locator("svg[data-manatee-renderer]")).toBeVisible();
  await page.getByLabel("Choose diagram file").setInputFiles({
    name: "deployed-smoke.mmd",
    mimeType: "text/plain",
    buffer: Buffer.from("flowchart LR\n  deployed --> working\n"),
  });
  await expect(page.getByLabel("Current document")).toContainText(
    "deployed-smoke.mmd",
  );
  await page.getByText("Export", { exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download SVG" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe(
    "deployed-smoke.svg",
  );

  await page.getByRole("button", { name: "BPMN example" }).click();
  await expect(page.locator(".bpmn-surface .djs-container")).toBeVisible();
  expect(failedResponses).toEqual([]);
});
