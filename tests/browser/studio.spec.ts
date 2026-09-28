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
  await page.getByText("Structure", { exact: true }).click();
  await expect(
    page
      .getByRole("complementary", { name: "Inspector" })
      .getByRole("button", { name: "Add node", exact: true }),
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
    page
      .getByRole("complementary", { name: "Inspector" })
      .getByRole("button", { name: "Add node", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Edit selected element", exact: true })
    .click();
  await page.getByLabel("Element label", { exact: true }).fill("Renamed");
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

test("opens teaching examples beside edited work and restores the workspace", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator("svg[data-manatee-renderer]")).toBeVisible();
  await page
    .getByRole("button", { name: "Add your first node", exact: true })
    .click();
  await page
    .getByRole("application", { name: "Interactive Mermaid diagram" })
    .click({ position: { x: 120, y: 120 } });
  await page.getByLabel("Node label").fill("My first node");
  await page.getByLabel("Node label").press("Enter");
  await page
    .getByRole("button", { name: "Examples", exact: true })
    .first()
    .click();
  await expect(page.getByRole("dialog", { name: "Examples" })).toBeVisible();
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
  await page.getByText("Structure", { exact: true }).click();
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
    .getByRole("tab", { name: "untitled-flowchart.mmd •", exact: true })
    .click();
  await expect(page.locator('[data-element-id="my_first_node"]')).toContainText(
    "My first node",
  );
  await page
    .getByRole("tab", { name: "c4-container.mmd •", exact: true })
    .click();
  await expect(
    page.getByText("Recovered locally in this browser", { exact: true }),
  ).toBeVisible();
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
  for (const [id, label] of [
    ["first", "First node"],
    ["second", "Second node"],
  ]) {
    await page
      .getByRole("complementary", { name: "Inspector" })
      .getByRole("button", { name: "Add node", exact: true })
      .click();
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
  await page.getByText("Structure", { exact: true }).click();
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
    .getByRole("button", { name: "Examples", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Open Attribute-driven styling", exact: true })
    .click();
  await page.locator('[data-element-id="deliver"]').click();
  await page.getByText("Node attributes", { exact: true }).click();
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

test("locks connection docks and reconnects with distinct drag targets", async ({
  page,
}) => {
  await page.goto("./");
  await page.locator('input[type="file"]').setInputFiles({
    name: "docking.mmd",
    mimeType: "text/plain",
    buffer: Buffer.from(`flowchart LR
A[First] e1@--> B[Second]
C[Third]
`),
  });
  const edge = page.locator(
    '.relationship[data-element-id="e1"] > path:not(.relationship-hit-area)',
  );
  await edge.click({ force: true });
  await expect(page.locator(".connection-endpoint-handle")).toHaveCount(2);

  const sourceHandle = page.locator(
    '.connection-endpoints[data-element-id="e1"] .connection-endpoint-handle[data-endpoint="source"]',
  );
  const sourceHandleBox = (await sourceHandle.boundingBox())!;
  const firstBox = (await page
    .locator('.node[data-element-id="A"]')
    .boundingBox())!;
  await page.mouse.move(
    sourceHandleBox.x + sourceHandleBox.width / 2,
    sourceHandleBox.y + sourceHandleBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y, {
    steps: 3,
  });
  await expect(
    page.locator('.dock-target.is-active[data-dock="top"]'),
  ).toHaveCount(1);
  await page.mouse.up();
  await expect(page.getByLabel("Source dock")).toHaveValue("top");
  await page.getByRole("button", { name: "Show source" }).click();
  await expect(page.getByLabel("Diagram source")).toHaveValue(
    /docks:[^]*source: top/u,
  );

  await page.getByLabel("Allow Mermaid source edits").check();
  const targetHandle = page.locator(
    '.connection-endpoints[data-element-id="e1"] .connection-endpoint-handle[data-endpoint="target"]',
  );
  const targetBox = (await targetHandle.boundingBox())!;
  const thirdBox = (await page
    .locator('.node[data-element-id="C"]')
    .boundingBox())!;
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    thirdBox.x + thirdBox.width / 2,
    thirdBox.y + thirdBox.height / 2,
    { steps: 5 },
  );
  await expect(
    page.locator('.reconnect-target.is-active[data-node-id="C"]'),
  ).toBeVisible();
  await expect(page.getByText("Reconnect", { exact: true })).toBeVisible();
  await page.mouse.up();
  await expect(page.getByLabel("Diagram source")).toHaveValue(/A e1@--> C/u);
  await expect(page.getByLabel("Target dock")).toHaveValue("auto");
  await expect(page.getByLabel("Source dock")).toHaveValue("top");

  await page.getByRole("button", { name: "Reset layout" }).click();
  await expect(page.getByLabel("Source dock")).toHaveValue("auto");
});

test("edits, keyboards, resets, and undoes an exact connection route", async ({
  page,
}) => {
  await page.goto("./");
  await page.locator('input[type="file"]').setInputFiles({
    name: "routing.mmd",
    mimeType: "text/plain",
    buffer: Buffer.from(`flowchart LR
A[First] e1@--> B[Second]
`),
  });
  await page
    .locator(
      '.relationship[data-element-id="e1"] > path:not(.relationship-hit-area)',
    )
    .click({ force: true });
  const segment = page.locator(".route-segment-handle").first();
  await expect(segment).toBeVisible();
  const box = (await segment.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 36,
    box.y + box.height / 2 + 36,
    {
      steps: 4,
    },
  );
  await page.mouse.up();

  await page.getByRole("button", { name: "Show source" }).click();
  const source = page.getByLabel("Diagram source");
  await expect(source).toHaveValue(/route:[^]*waypoints:/u);
  await expect(page.locator(".route-waypoint-handle").first()).toBeVisible();

  await page.locator(".route-waypoint-handle").first().focus();
  await page.locator(".route-waypoint-handle").first().press("ArrowDown");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(source).toHaveValue(/route:[^]*waypoints:/u);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(source).not.toHaveValue(/route:/u);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await page.getByRole("button", { name: "Redo", exact: true }).click();

  await page
    .getByRole("button", { name: "Reset route", exact: true })
    .first()
    .click();
  await expect(source).not.toHaveValue(/route:/u);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(source).toHaveValue(/route:[^]*waypoints:/u);
});

test("snaps connected nodes and previews container descendants", async ({
  page,
}) => {
  await page.goto("./");
  await page.locator('input[type="file"]').setInputFiles({
    name: "movement.mmd",
    mimeType: "text/plain",
    buffer: Buffer.from(`flowchart LR
subgraph team[Team]
  A[First]
  B[Second]
end
C[Third]
A e1@--> B
B e2@--> C
`),
  });

  const child = page.locator('.node[data-element-id="A"]');
  const group = page.locator('.group[data-element-id="team"] rect').first();
  const internalConnection = page.locator(
    '.relationship[data-element-id="e1"] > path:not(.relationship-hit-area)',
  );
  const childBefore = (await child.boundingBox())!;
  const connectionBefore = await internalConnection.getAttribute("d");
  const groupBox = (await group.boundingBox())!;
  await page.mouse.move(groupBox.x + 8, groupBox.y + 8);
  await page.mouse.down();
  await page.mouse.move(groupBox.x + 48, groupBox.y + 38, { steps: 3 });
  await expect(child).toHaveAttribute("transform", /translate\(/u);
  await expect(internalConnection).not.toHaveAttribute("d", connectionBefore!);
  const childDuring = (await child.boundingBox())!;
  expect(childDuring.x - childBefore.x).toBeGreaterThan(25);
  await page.mouse.up();
  await expect(child).not.toHaveAttribute("transform", /translate\(/u);

  const first = page.locator('.node[data-element-id="A"]');
  const second = page.locator('.node[data-element-id="B"]');
  let secondBox = (await second.boundingBox())!;
  await page.mouse.move(
    secondBox.x + secondBox.width / 2,
    secondBox.y + secondBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    secondBox.x + secondBox.width / 2,
    secondBox.y + secondBox.height / 2 + 30,
  );
  await page.mouse.up();

  secondBox = (await second.boundingBox())!;
  await page.mouse.move(
    secondBox.x + secondBox.width / 2,
    secondBox.y + secondBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    secondBox.x + secondBox.width / 2,
    secondBox.y + secondBox.height / 2 - 24,
    { steps: 3 },
  );
  await expect(page.locator('.alignment-guide[data-axis="y"]')).toHaveCount(1);
  await page.mouse.up();
  const firstAfter = (await first.boundingBox())!;
  const secondAfter = (await second.boundingBox())!;
  expect(
    Math.abs(
      firstAfter.y +
        firstAfter.height / 2 -
        (secondAfter.y + secondAfter.height / 2),
    ),
  ).toBeLessThan(1);
});
