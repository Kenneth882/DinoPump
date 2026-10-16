import { expect, type Page } from "@playwright/test";

/** Navigate the real responsive UI; desktop exposes all four views together. */
export async function terminalView(
  page: Page,
  name: "Market" | "Trade" | "Portfolio" | "News",
) {
  if ((page.viewportSize()?.width ?? 1600) > 1100) return;
  const tab = page.getByRole("tab", { name, exact: true });
  await expect(tab).toBeVisible();
  await tab.focus();
  await page.keyboard.press("Enter");
  await expect(tab).toHaveAttribute("aria-selected", "true");
}
