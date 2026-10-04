import { expect, test as base } from "@playwright/test";

export { expect };
export const test = base.extend<{ solidDiagnostics: void }>({
  solidDiagnostics: [
    async ({ page }, use) => {
      const diagnostics: string[] = [];
      page.on("console", (message) => {
        if (/\[[A-Z_]+\]/u.test(message.text()))
          diagnostics.push(message.text());
      });
      await use();
      expect(diagnostics, "Unexpected Solid development diagnostics").toEqual(
        [],
      );
    },
    { auto: true },
  ],
});
