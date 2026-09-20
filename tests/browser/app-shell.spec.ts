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
  await page.getByLabel("Fill colour", { exact: true }).fill("#ffccaa");
  await page.getByLabel("Fill colour", { exact: true }).blur();

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

test("changes process notation through the Mermaid inspector", async ({
  page,
}) => {
  await page.goto("./");
  await page.locator('[data-element-id="review"]').click();
  await expect(
    page
      .getByRole("complementary", { name: "Inspector" })
      .getByText("Review request", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Process notation")
    .selectOption("collapsed-subprocess");
  await expect(
    page.locator(
      '[data-element-id="review"][data-notation="collapsed-subprocess"]',
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Show source" }).click();
  await expect(page.getByLabel("Diagram source")).toHaveValue(
    /review:[\s\S]*type: collapsed-subprocess/u,
  );
  await page.getByRole("button", { name: "Hide source" }).click();
  await page.locator('[data-element-id="timeout"]').click();
  await expect(page.getByLabel("Process notation")).toHaveValue(
    "boundary-timer",
  );
  await expect(page.getByLabel("Timeout task")).toHaveValue("timeoutLink");
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
    page.getByRole("tab", { name: "request-flow.mmd •", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Show source" }).click();
  await expect(
    page.getByRole("textbox", { name: "Diagram source" }),
  ).toHaveValue("flowchart LR\n  alpha[");
  await expect(page.locator('svg[data-outdated="true"]')).toBeVisible();
  await expect(page.getByText("Recovered", { exact: true })).toBeVisible();
});

test("retires a legacy BPMN autosave before opening Mermaid", async ({
  page,
}) => {
  await page.goto("./");
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("manatee-studio", 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const active = await new Promise<unknown>((resolve, reject) => {
          const request = database
            .transaction("documents", "readonly")
            .objectStore("documents")
            .get("workspace");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        database.close();
        return (active as { version?: unknown } | undefined)?.version;
      }),
    )
    .toBe(1);
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("manatee-studio", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("documents", "readwrite");
      transaction.objectStore("documents").put(
        {
          filename: "retired-process.bpmn",
          kind: "bpmn",
          source: "<definitions><process /></definitions>",
          savedAt: Date.now(),
        },
        "active",
      );
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });

  await page.reload();
  await expect(
    page.getByRole("region", { name: "Autosave recovery" }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("region", { name: "Retired source recovery" }),
  ).toBeVisible();
  await expect(page.locator("svg[data-manatee-renderer]")).toHaveAttribute(
    "data-manatee-renderer",
    "mermaid",
  );
  const stored = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("manatee-studio", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const values = await new Promise<{ active: unknown; retired: unknown }>(
      (resolve, reject) => {
        const store = database
          .transaction("documents", "readonly")
          .objectStore("documents");
        const active = store.get("workspace");
        const retired = store.get("retired-bpmn");
        retired.onsuccess = () =>
          resolve({ active: active.result, retired: retired.result });
        retired.onerror = () => reject(retired.error);
      },
    );
    database.close();
    return values;
  });
  expect(stored.active).toMatchObject({
    version: 1,
    tabs: [expect.objectContaining({ filename: "request-flow.mmd" })],
  });
  expect(stored.active).not.toHaveProperty("kind");
  expect(stored.retired).toMatchObject({
    filename: "retired-process.bpmn",
    kind: "bpmn",
  });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download source" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("retired-process.bpmn");
  const path = await download.path();
  expect(await readFile(path!, "utf8")).toBe(
    "<definitions><process /></definitions>",
  );
  await page
    .getByRole("region", { name: "Retired source recovery" })
    .getByRole("button", { name: "Discard" })
    .click();
  await expect(
    page.getByRole("region", { name: "Retired source recovery" }),
  ).not.toBeVisible();
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

test("reclaims the canvas when panels close and keeps menus keyboard accessible", async ({
  page,
}) => {
  await page.goto("./");
  const canvas = page.getByRole("region", { name: "Diagram canvas" });
  await expect(page.locator("svg[data-manatee-renderer]")).toBeVisible();
  const originalWidth = (await canvas.boundingBox())!.width;
  await page.getByRole("button", { name: "Close inspector" }).click();
  expect((await canvas.boundingBox())!.width).toBeGreaterThan(
    originalWidth + 250,
  );
  await page.getByRole("button", { name: "Show source" }).click();
  await expect(
    page.getByRole("textbox", { name: "Diagram source" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Hide source" }).click();
  await page.getByRole("button", { name: "Show inspector" }).click();
  await expect(
    page.getByRole("complementary", { name: "Inspector" }),
  ).toBeVisible();
  await page.getByText("Export", { exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(
    page.locator(".topbar .export-menu:not(.examples-menu) summary"),
  ).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Download PNG" }),
  ).not.toBeVisible();
});

test("exports authored appearance without the editor selection highlight", async ({
  page,
}) => {
  await page.goto("./");
  await page.locator('[data-element-id="review"]').click();
  await page.getByLabel("Outline colour", { exact: true }).fill("#123456");
  await page.getByLabel("Outline colour", { exact: true }).blur();
  await expect(page.locator('[data-element-id="review"]')).toHaveClass(
    /selected/,
  );
  await page.getByText("Export", { exact: true }).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download SVG", exact: true }).click();
  const svg = await readFile((await (await pending).path())!, "utf8");
  expect(svg).not.toMatch(/class="[^"]*\bselected\b/);
  expect(svg).toContain('stroke="#123456"');
});

test("an invalid newly opened file cannot masquerade as the previous diagram", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator('[data-element-id="review"]')).toBeVisible();
  await page.getByLabel("Choose diagram file").setInputFiles({
    name: "broken.mmd",
    mimeType: "text/plain",
    buffer: Buffer.from("flowchart LR\nnew["),
  });
  await expect(page.getByLabel("Current document")).toContainText("broken.mmd");
  await expect(page.locator('[data-element-id="review"]')).toHaveCount(0);
  await expect(
    page.getByText("No preview available", { exact: true }),
  ).toBeVisible();
  await page.getByText("Export", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Download SVG", exact: true }),
  ).toBeDisabled();
});
