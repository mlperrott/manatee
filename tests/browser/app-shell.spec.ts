import { expect, test } from "@playwright/test";

test("opens the accessible Studio shell", async ({ page }) => {
  const runtimeErrors: Error[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error));

  await page.goto("./");

  await expect(page).toHaveTitle(/Manatee/i);
  await expect(
    page.getByRole("heading", {
      name: "Turn diagram source into a clear story.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Diagram canvas" }),
  ).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Inspector" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Show source" }).click();
  await expect(
    page.getByRole("complementary", { name: "Source" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Hide source" })).toBeVisible();

  expect(runtimeErrors).toEqual([]);
});
