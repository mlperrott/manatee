import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

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

test("opens and downloads a portable source document", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("svg[data-manatee-renderer]")).toBeVisible();
  const input = page.getByLabel("Choose diagram file");
  await input.setInputFiles({
    name: "architecture.mmd",
    mimeType: "text/plain",
    buffer: Buffer.from("flowchart LR\n  api[API] --> db[(Database)]\n"),
  });

  await expect(page.getByLabel("Current document")).toContainText(
    "architecture.mmd",
  );
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("architecture.mmd");
  const path = await download.path();
  expect(path).not.toBeNull();
  expect(await readFile(path!, "utf8")).toContain("api[API]");
});

test("recovers invalid autosave with its last valid preview", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator("svg[data-manatee-renderer]")).toBeVisible();
  await page.getByRole("button", { name: "Show source" }).click();
  const source = page.getByRole("textbox", { name: "Diagram source" });
  await source.fill("flowchart LR\n  alpha[Recovered] --> beta[Work]\n");
  await expect(
    page.getByRole("region", { name: "Diagram canvas" }).getByText("Recovered"),
  ).toBeVisible();
  await source.fill("flowchart LR\n  alpha[");
  await expect(page.getByText("Source has errors")).toBeVisible();
  await page.waitForTimeout(500);

  await page.reload();
  await expect(
    page.getByRole("region", { name: "Autosave recovery" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Recover" }).click();
  await page.getByRole("button", { name: "Show source" }).click();
  await expect(
    page.getByRole("textbox", { name: "Diagram source" }),
  ).toHaveValue("flowchart LR\n  alpha[");
  await expect(page.locator('svg[data-outdated="true"]')).toBeVisible();
  await expect(page.getByText("Recovered", { exact: true })).toBeVisible();
});

test("exports scaled PNG and falls back to download when clipboard fails", async ({
  page,
}) => {
  await page.goto("./");
  const viewBox = (await page
    .locator("svg[data-manatee-renderer]")
    .getAttribute("viewBox"))!
    .split(/\s+/u)
    .map(Number);
  await page.getByText("Export", { exact: true }).click();
  await page.getByLabel("PNG scale").selectOption("3");
  const svgPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download SVG" }).click();
  const svgDownload = await svgPromise;
  expect(svgDownload.suggestedFilename()).toBe("request-flow.svg");
  const svgPath = await svgDownload.path();
  const exportedSvg = await readFile(svgPath!, "utf8");
  expect(exportedSvg).toContain('data-manatee-renderer="mermaid"');
  expect(exportedSvg).toContain("<style>");

  const pngPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PNG" }).click();
  const png = await pngPromise;
  expect(png.suggestedFilename()).toBe("request-flow.png");
  const pngPath = await png.path();
  const bytes = await readFile(pngPath!);
  expect(bytes.subarray(1, 4).toString()).toBe("PNG");
  expect(bytes.readUInt32BE(16)).toBe(Math.round(viewBox[2]! * 3));
  expect(bytes.readUInt32BE(20)).toBe(Math.round(viewBox[3]! * 3));
  const whitePixel = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    return [...context.getImageData(0, 0, 1, 1).data];
  }, bytes.toString("base64"));
  expect(whitePixel).toEqual([255, 255, 255, 255]);

  await page.getByLabel("Transparent background").check();
  const transparentPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PNG" }).click();
  const transparentDownload = await transparentPromise;
  const transparentPath = await transparentDownload.path();
  const transparentBytes = await readFile(transparentPath!);
  const transparentPixel = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    return [...context.getImageData(0, 0, 1, 1).data];
  }, transparentBytes.toString("base64"));
  expect(transparentPixel[3]).toBe(0);

  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write: () => Promise.resolve() },
    });
    Object.defineProperty(window, "ClipboardItem", {
      configurable: true,
      value: class {
        constructor(public readonly items: Record<string, Blob>) {}
      },
    });
  });
  await page.getByRole("button", { name: "Copy PNG" }).click();
  await expect(page.getByText("PNG copied to the clipboard.")).toBeVisible();

  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write: () => Promise.reject(new Error("denied")) },
    });
    Object.defineProperty(window, "ClipboardItem", {
      configurable: true,
      value: class {
        constructor(public readonly items: Record<string, Blob>) {}
      },
    });
  });
  const fallbackPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Copy PNG" }).click();
  const fallback = await fallbackPromise;
  expect(fallback.suggestedFilename()).toBe("request-flow.png");
  await expect(
    page.getByText("Clipboard unavailable; PNG downloaded instead."),
  ).toBeVisible();
});
