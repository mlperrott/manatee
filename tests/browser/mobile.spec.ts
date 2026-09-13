import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function view(page: Page, name: "Canvas" | "Source" | "Inspector") {
  await page
    .getByRole("navigation", { name: "Workspace views" })
    .getByRole("button", { name, exact: true })
    .tap();
}

async function noPageOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(await page.evaluate(() => window.innerWidth)).toBe(
    page.viewportSize()!.width,
  );
}

for (const [width, height] of [
  [320, 568],
  [375, 667],
  [390, 844],
  [430, 932],
  [844, 390],
]) {
  test(`fits the workspace and controls at ${width} × ${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: width!, height: height! });
    await page.goto("./");
    const diagram = page.locator("svg[data-manatee-renderer]");
    await expect(diagram).toBeVisible();
    await noPageOverflow(page);
    await expect(async () => {
      const drawing = await diagram.boundingBox();
      const surface = await page.locator(".mermaid-surface").boundingBox();
      expect(drawing!.x).toBeGreaterThanOrEqual(surface!.x);
      expect(drawing!.x + drawing!.width).toBeLessThanOrEqual(
        surface!.x + surface!.width + 1,
      );
      expect(drawing!.y + drawing!.height).toBeLessThanOrEqual(
        surface!.y + surface!.height + 1,
      );
    }).toPass();
    for (const control of await page
      .locator("button:visible, summary:visible")
      .all()) {
      const box = (await control.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width!);
      expect(box.y + box.height).toBeLessThanOrEqual(height!);
    }
    await page.getByText("Export", { exact: true }).tap();
    await expect(
      page.getByRole("button", { name: "Download PNG" }),
    ).toBeInViewport();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Download PNG" }),
    ).not.toBeVisible();
  });
}

test("edits, selects, moves, styles, undoes, exports, and recovers on iPhone", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./");
  await view(page, "Source");
  const source = page.getByRole("textbox", { name: "Diagram source" });
  expect(
    await source.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
  ).toBeGreaterThanOrEqual(16);
  await source.fill("flowchart TD\n  phone[Phone review] --> ready[Ready]\n");
  await expect(
    page.getByText("Preview current", { exact: true }),
  ).toBeVisible();
  await view(page, "Canvas");
  await page.locator('[data-element-id="phone"]').tap();
  await view(page, "Inspector");
  await expect(page.locator(".selection-summary code")).toHaveText("phone");
  await page.getByRole("button", { name: "Move selection right" }).tap();
  await page.getByLabel("Fill colour").fill("#ffccaa");
  await page.getByRole("button", { name: "Apply appearance" }).tap();
  await view(page, "Source");
  await expect(source).toHaveValue(/position:/);
  await expect(source).toHaveValue(/ffccaa/);
  await view(page, "Canvas");
  await page.getByRole("button", { name: "Undo", exact: true }).tap();
  await view(page, "Source");
  await expect(source).not.toHaveValue(/ffccaa/);
  await view(page, "Canvas");
  await page.getByText("Export", { exact: true }).tap();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PNG" }).tap();
  expect((await downloadPromise).suggestedFilename()).toBe("request-flow.png");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Dismiss notification" }).tap();
  await view(page, "Source");
  await source.fill("flowchart TD\n  phone[");
  await expect(page.getByText("Source has errors")).toBeVisible();
  await view(page, "Canvas");
  await expect(page.locator('svg[data-outdated="true"]')).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reset layout" }),
  ).toBeDisabled();
  // Let the browser-local autosave finish before simulating a later visit.
  await page.waitForTimeout(500);
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Autosave recovery" }),
  ).toBeInViewport();
  await noPageOverflow(page);
  await page.getByRole("button", { name: "Recover", exact: true }).tap();
  await view(page, "Source");
  await expect(source).toHaveValue("flowchart TD\n  phone[");
  expect(errors).toEqual([]);
});

test("keeps source reachable in a short viewport and preserves it across rotation", async ({
  page,
}) => {
  await page.goto("./");
  await view(page, "Source");
  await page.setViewportSize({ width: 390, height: 400 });
  const source = page.getByRole("textbox", { name: "Diagram source" });
  await source.fill("flowchart TD\n  edit[Editing on phone] --> save[Save]\n");
  await expect(source).toBeInViewport();
  await expect(
    page.getByRole("button", { name: "Canvas", exact: true }),
  ).toBeInViewport();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(source).toHaveValue(/Editing on phone/);
  await view(page, "Canvas");
  await expect(page.locator('[data-element-id="edit"]')).toBeVisible();
  await noPageOverflow(page);
});

test("opens portable files and reaches process notation and export", async ({
  page,
}) => {
  await page.goto("./");
  await page.getByLabel("Choose diagram file").setInputFiles({
    name: "a-very-long-diagram-name-that-must-not-push-controls-offscreen.mmd",
    mimeType: "text/plain",
    buffer: Buffer.from("flowchart TD\n  a[Imported] --> b[Portable]\n"),
  });
  await expect(page.locator('[data-element-id="a"]')).toBeVisible();
  await noPageOverflow(page);
  const savePromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save", exact: true }).tap();
  expect((await savePromise).suggestedFilename()).toContain(
    "a-very-long-diagram",
  );
  await expect(page.getByText("Portable document downloaded.")).toBeVisible();
  await page.getByRole("button", { name: "Dismiss notification" }).tap();
  await page.getByText("Examples", { exact: true }).tap();
  await page.getByRole("button", { name: "Process example" }).tap();
  await expect(
    page.locator('[data-notation="exclusive-gateway"]'),
  ).toBeVisible();
  await page.getByRole("button", { name: "Fit diagram to screen" }).tap();
  await page.locator('[data-element-id="review"]').tap();
  await view(page, "Inspector");
  await expect(page.locator(".selection-summary code")).toHaveText("review");
  await page
    .getByLabel("Process notation")
    .selectOption("collapsed-subprocess");
  await page.getByLabel("Fill colour").fill("#ffccaa");
  await page.getByRole("button", { name: "Apply appearance" }).tap();
  await view(page, "Source");
  await expect(
    page.getByRole("textbox", { name: "Diagram source" }),
  ).toHaveValue(/ffccaa/);
  await page.getByText("Export", { exact: true }).tap();
  const exportPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download SVG" }).tap();
  expect((await exportPromise).suggestedFilename()).toBe("request-flow.svg");
});

test("cancelled touch drags never move an element", async ({ page }) => {
  await page.goto("./");
  const node = page.locator('[data-element-id="request"]');
  await node.dispatchEvent("pointerdown", {
    pointerId: 1,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    clientX: 100,
    clientY: 200,
  });
  await node.dispatchEvent("pointercancel", {
    pointerId: 1,
    pointerType: "touch",
  });
  await node.dispatchEvent("pointerup", {
    pointerId: 1,
    pointerType: "touch",
    clientX: 200,
    clientY: 250,
  });
  await view(page, "Source");
  await expect(
    page.getByRole("textbox", { name: "Diagram source" }),
  ).not.toHaveValue(/position:/);
});

test("Save preserves the latest text even before the preview updates", async ({
  page,
}) => {
  await page.goto("./");
  await view(page, "Source");
  const source = page.getByRole("textbox", { name: "Diagram source" });
  await expect(source).toBeEnabled();
  const latest = "flowchart TD\n  phone[Unfinished edit";
  const downloadPromise = page.waitForEvent("download");
  await source.fill(latest);
  await page.getByRole("button", { name: "Save", exact: true }).tap();
  const download = await downloadPromise;
  expect(await readFile((await download.path())!, "utf8")).toBe(latest);
});
