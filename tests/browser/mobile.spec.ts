import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("touch multi-selection aligns and moves without enabling source editing", async ({
  page,
}) => {
  await page.goto("./");
  await page.locator('input[type="file"]').setInputFiles({
    name: "touch-selection.mmd",
    mimeType: "text/plain",
    buffer: Buffer.from("flowchart LR\nA[First] --> B[Second]\nB --> C[Third]"),
  });
  await expect(page.locator('.node[data-element-id="A"]')).toBeVisible();
  await page
    .getByRole("button", { name: "Select multiple", exact: true })
    .tap();
  await page.locator('.node[data-element-id="A"]').tap();
  await page.locator('.node[data-element-id="B"]').tap();
  await expect(page.locator(".node.selected")).toHaveCount(2);
  await page.getByLabel("Arrange selection").selectOption("top");
  await page.getByRole("button", { name: "Apply", exact: true }).tap();
  const before = Number(
    await page.locator('.node[data-element-id="A"] > rect').getAttribute("x"),
  );
  await page
    .getByRole("button", { name: "Move selected elements right", exact: true })
    .tap();
  await expect(
    page.locator('.node[data-element-id="A"] > rect'),
  ).toHaveAttribute("x", String(before + 10));
  await noPageOverflow(page);
  await page.locator('.node[data-element-id="B"]').tap();
  await expect(page.locator(".node.selected")).toHaveCount(1);
});

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

async function openAdvancedProcess(page: Page) {
  await page
    .getByRole("button", { name: "Examples", exact: true })
    .first()
    .tap();
  await page
    .getByRole("button", { name: "Open Advanced process", exact: true })
    .tap();
  await expect(page.locator('[data-element-id="review"]')).toBeVisible();
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
      const surface = await page.locator(".mermaid-surface").boundingBox();
      expect(surface!.width).toBeGreaterThan(0);
      expect(surface!.height).toBeGreaterThan(0);
      expect(surface!.x).toBeGreaterThanOrEqual(0);
      expect(surface!.x + surface!.width).toBeLessThanOrEqual(width!);
      expect(surface!.y).toBeGreaterThanOrEqual(0);
      expect(surface!.y + surface!.height).toBeLessThanOrEqual(height!);
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
  await page.getByLabel("Fill colour", { exact: true }).fill("#ffccaa");
  await page.getByLabel("Fill colour", { exact: true }).blur();
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
  expect((await downloadPromise).suggestedFilename()).toBe(
    "untitled-flowchart.png",
  );
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
    page.locator(".open-documents-picker option:checked"),
  ).toContainText("untitled-flowchart.mmd");
  await noPageOverflow(page);
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

test("keeps selected-node actions inside the mobile canvas", async ({
  page,
}) => {
  await page.goto("./");
  await view(page, "Source");
  await page
    .getByRole("textbox", { name: "Diagram source" })
    .fill("flowchart TD\n  start[Start] --> review[Review]\n");
  await view(page, "Canvas");
  await page.getByRole("button", { name: "Fit diagram to screen" }).tap();
  await page.locator('[data-element-id="review"]').tap();

  const actions = page.getByRole("toolbar", { name: "Actions for Review" });
  await expect(actions).toBeVisible();
  await expect(actions.getByLabel("Canvas node type")).not.toBeVisible();
  await expect(
    page.locator(".mermaid-surface__keyboard-help"),
  ).not.toBeVisible();
  const box = (await actions.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
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
  await page.getByRole("button", { name: "Download .mmd", exact: true }).tap();
  expect((await savePromise).suggestedFilename()).toContain(
    "a-very-long-diagram",
  );
  await expect(page.getByText("Portable .mmd downloaded.")).toBeVisible();
  await page.getByRole("button", { name: "Dismiss notification" }).tap();
  await openAdvancedProcess(page);
  await expect(
    page.locator('[data-notation="exclusive-gateway"]'),
  ).toBeVisible();
  await page.getByRole("button", { name: "Fit diagram to screen" }).tap();
  await page.locator('[data-element-id="review"]').tap();
  await view(page, "Inspector");
  await expect(page.locator(".selection-summary code")).toHaveText("review");
  await page.getByText("Process notation", { exact: true }).tap();
  await page
    .getByLabel("Process notation")
    .selectOption("collapsed-subprocess");
  await expect(page.locator('[data-element-id="review"]')).toHaveAttribute(
    "data-notation",
    "collapsed-subprocess",
  );
  await page.getByLabel("Fill colour", { exact: true }).fill("#ffccaa");
  await page.getByLabel("Fill colour", { exact: true }).blur();
  await view(page, "Source");
  await expect(
    page.getByRole("textbox", { name: "Diagram source" }),
  ).toHaveValue(/ffccaa/);
  await page.getByText("Export", { exact: true }).tap();
  const exportPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download SVG" }).tap();
  expect((await exportPromise).suggestedFilename()).toBe("process.svg");
});

test("cancelled touch drags never move an element", async ({ page }) => {
  await page.goto("./");
  await openAdvancedProcess(page);
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

test("connections have a finger-sized hit area and remain selectable", async ({
  page,
}) => {
  await page.goto("./");
  await view(page, "Source");
  await page
    .getByRole("textbox", { name: "Diagram source" })
    .fill("flowchart LR\n  a[Start] --> b[End]\n");
  await view(page, "Canvas");
  const hitArea = page.locator(".relationship-hit-area");
  await expect(hitArea).toHaveCount(1);
  expect(await hitArea.getAttribute("vector-effect")).toBe(
    "non-scaling-stroke",
  );
  const target = await hitArea.evaluate((path: SVGPathElement) => {
    const point = path.getPointAtLength(path.getTotalLength() / 2);
    const screen = point.matrixTransform(path.getScreenCTM()!);
    return { x: screen.x, y: screen.y + 8 };
  });
  await page.touchscreen.tap(target.x, target.y);
  const id = await hitArea.locator("..").getAttribute("data-element-id");
  expect(await hitArea.evaluate((path) => getComputedStyle(path).stroke)).toBe(
    "rgba(0, 0, 0, 0)",
  );
  await view(page, "Inspector");
  await expect(page.locator(".selection-summary code")).toHaveText(id!);
});

test("touch edits a route and exposes waypoint removal", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  await page.goto("./");
  await view(page, "Source");
  await page
    .getByRole("textbox", { name: "Diagram source" })
    .fill("flowchart LR\n  a[Start] e1@--> b[End]\n");
  await view(page, "Canvas");
  const hitArea = page.locator(".relationship-hit-area");
  const target = await hitArea.evaluate((path: SVGPathElement) => {
    const point = path.getPointAtLength(path.getTotalLength() / 2);
    const screen = point.matrixTransform(path.getScreenCTM()!);
    return { x: screen.x, y: screen.y };
  });
  await page.touchscreen.tap(target.x, target.y);
  const segment = page.locator(".route-segment-handle").last();
  const box = (await segment.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(43);
  expect(box.height).toBeGreaterThanOrEqual(43);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const routePath = page.locator(
    '.relationship[data-element-id="e1"] > path:not(.relationship-hit-area)',
  );
  const originalPath = await routePath.getAttribute("d");
  await page
    .getByRole("application", { name: "Interactive Mermaid diagram" })
    .evaluate((surface) => {
      surface.setPointerCapture = () => undefined;
    });
  await segment.dispatchEvent("pointerdown", {
    pointerId: 7,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    clientX: x,
    clientY: y,
  });
  await segment.dispatchEvent("pointermove", {
    pointerId: 7,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    clientX: x + 30,
    clientY: y + 30,
  });
  await expect(routePath).not.toHaveAttribute("d", originalPath!);
  await segment.dispatchEvent("pointerup", {
    pointerId: 7,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    clientX: x + 30,
    clientY: y + 30,
  });
  await view(page, "Source");
  await expect(
    page.getByRole("textbox", { name: "Diagram source" }),
  ).toHaveValue(/route:[^]*waypoints:/u);
  await view(page, "Canvas");
  await page.locator(".route-waypoint-handle").first().tap();
  await expect(
    page.getByRole("button", { name: "Remove waypoint", exact: true }),
  ).toBeVisible();
});

test("finger drag previews and commits one node move", async ({
  page,
  context,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  await page.goto("./");
  await view(page, "Source");
  await page
    .getByRole("textbox", { name: "Diagram source" })
    .fill("flowchart LR\n  a[Start] -->|Next| b[Middle]\n  b --> c[End]\n");
  await view(page, "Canvas");
  const node = page.locator('[data-element-id="b"]');
  await expect(node).toBeVisible();
  const edge = page.locator(".relationship > path:not(.relationship-hit-area)");
  const hitArea = page.locator(".relationship-hit-area");
  const label = page.locator(".relationship-label");
  const originalPaths = await edge.evaluateAll((paths) =>
    paths.map((path) => path.getAttribute("d")),
  );
  const box = (await node.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const client = await context.newCDPSession(page);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: x + 45, y: y + 20 }],
  });
  await expect(node).toHaveAttribute("transform", /translate\(/);
  const previewPaths = await edge.evaluateAll((paths) =>
    paths.map((path) => path.getAttribute("d")),
  );
  expect(previewPaths).toHaveLength(2);
  expect(previewPaths[0]).not.toBe(originalPaths[0]);
  expect(previewPaths[1]).not.toBe(originalPaths[1]);
  expect(
    await hitArea.evaluateAll((paths) =>
      paths.map((path) => path.getAttribute("d")),
    ),
  ).toEqual(previewPaths);
  await expect(label).toHaveAttribute("transform", /translate\(/);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await page
    .getByRole("navigation", { name: "Workspace views" })
    .getByRole("button", { name: "Source" })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Diagram source" }),
  ).toHaveValue(/b:\s*\n\s*position:/);
  await page
    .getByRole("navigation", { name: "Workspace views" })
    .getByRole("button", { name: "Canvas" })
    .click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Workspace views" })
    .getByRole("button", { name: "Source" })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Diagram source" }),
  ).not.toHaveValue(/b:\s*\n\s*position:/);
  await page
    .getByRole("navigation", { name: "Workspace views" })
    .getByRole("button", { name: "Canvas" })
    .click();
  const restoredPaths = await edge.evaluateAll((paths) =>
    paths.map((path) => path.getAttribute("d")),
  );
  const restoredBox = (await node.boundingBox())!;
  const restoredX = restoredBox.x + restoredBox.width / 2;
  const restoredY = restoredBox.y + restoredBox.height / 2;
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: restoredX, y: restoredY }],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: restoredX + 35, y: restoredY + 15 }],
  });
  await expect(node).toHaveAttribute("transform", /translate\(/);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchCancel",
    touchPoints: [],
  });
  await expect(node).not.toHaveAttribute("transform", /translate\(/);
  expect(
    await edge.evaluateAll((paths) =>
      paths.map((path) => path.getAttribute("d")),
    ),
  ).toEqual(restoredPaths);
});

test("Download preserves the latest text even before the preview updates", async ({
  page,
}) => {
  await page.goto("./");
  await view(page, "Source");
  const source = page.getByRole("textbox", { name: "Diagram source" });
  await expect(source).toBeEnabled();
  const latest = "flowchart TD\n  phone[Unfinished edit";
  const downloadPromise = page.waitForEvent("download");
  await source.fill(latest);
  await page.getByRole("button", { name: "Download .mmd", exact: true }).tap();
  const download = await downloadPromise;
  expect(await readFile((await download.path())!, "utf8")).toBe(latest);
});

test("notation controls are touch sized and explain timeout hosts only when needed", async ({
  page,
}) => {
  await page.goto("./");
  await openAdvancedProcess(page);
  await page.locator('[data-element-id="review"]').tap();
  await view(page, "Inspector");
  await expect(page.getByLabel("Timeout task")).toHaveCount(0);
  await page.getByText("Process notation", { exact: true }).tap();
  const symbol = page.getByLabel("Process notation");
  expect((await symbol.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(
    await symbol.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
  ).toBeGreaterThanOrEqual(16);
  await view(page, "Canvas");
  await page.locator('[data-element-id="timeout"]').tap();
  await view(page, "Inspector");
  const host = page.getByLabel("Timeout task");
  await expect(host).toBeVisible();
  expect((await host.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(host.locator("option:checked")).toHaveText("Review request");
});

test("explores examples and visually authors a diagram on a phone", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./");
  await expect(page.locator("svg[data-manatee-renderer]")).toBeVisible();
  await page
    .getByRole("button", { name: "Add your first node", exact: true })
    .tap();
  await page
    .getByRole("application", { name: "Interactive Mermaid diagram" })
    .tap({ position: { x: 100, y: 140 } });
  await page.getByLabel("Node label").fill("Keep this document");
  await page.getByLabel("Node label").press("Enter");
  await page
    .getByRole("button", { name: "Examples", exact: true })
    .first()
    .tap();
  await page
    .getByRole("button", { name: "Open Simple BPMN", exact: true })
    .tap();
  await expect(
    page.locator(".open-documents-picker option:checked"),
  ).toContainText("simple-bpmn.mmd");
  await view(page, "Inspector");
  await page.getByText("Structure", { exact: true }).tap();
  await page
    .getByRole("complementary", { name: "Inspector" })
    .getByRole("button", { name: "Add node", exact: true })
    .tap();
  await page.getByLabel("Element identifier").fill("extra");
  await page.getByLabel("Element label").fill("Phone task");
  await page.getByRole("button", { name: "Create node", exact: true }).tap();
  await view(page, "Canvas");
  await page.locator('[data-element-id="extra"]').tap();
  await view(page, "Inspector");
  await page.getByText("Process notation", { exact: true }).tap();
  await page.getByLabel("Process notation").selectOption("task");
  await page.getByText("Typography", { exact: true }).tap();
  await page.getByLabel("Text weight", { exact: true }).selectOption("700");
  await view(page, "Source");
  await expect(page.getByLabel("Diagram source")).toHaveValue(/weight: 700/);
  await noPageOverflow(page);
  await view(page, "Canvas");
  page.on("dialog", (dialog) => dialog.dismiss());
  await page
    .getByRole("button", { name: "Close active diagram", exact: true })
    .tap();
  await expect(
    page.locator(".open-documents-picker option:checked"),
  ).toContainText("simple-bpmn.mmd");
  expect(errors).toEqual([]);
});
