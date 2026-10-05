import { expect, test } from "@playwright/test";

for (const width of [1280, 360]) {
  test(`shows the real service baseline at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const responsePromise = page.waitForResponse("**/api/market-baseline");
    await page.goto("/");
    const response = await responsePromise;
    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(body.assets).toHaveLength(4);
    expect(Object.keys(body).sort()).toEqual([
      "assets",
      "contentVersion",
      "rulesVersion",
      "schemaVersion",
    ]);
    const market = page.getByRole("region", { name: "Meet the market" });
    await expect(market.getByRole("listitem")).toHaveCount(4);
    const expectedAssets: [string, string, string][] = [
      ["FERN", "Fern Farms", "D$40.00"],
      ["AMBR", "Amber Works", "D$75.00"],
      ["VOLC", "Volcano Energy", "D$100.00"],
      ["BONE", "Fossil Finds", "D$25.00"],
    ];
    for (const [symbol, name, price] of expectedAssets) {
      const card = market.getByRole("listitem").filter({ hasText: symbol });
      await expect(card.getByRole("heading", { name })).toBeVisible();
      await expect(card.getByText(price, { exact: false })).toBeVisible();
      await expect(
        card.getByText("Initial price", { exact: true }),
      ).toBeVisible();
    }
    await expect(
      page.getByText("Live rounds are not available yet."),
    ).toBeVisible();
    await expect(
      page.getByText("Fictional market game. Virtual currency only."),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`baseline-${width}.png`),
      fullPage: true,
    });
  });
}

test("keeps the introduction during failure and retries with the real service", async ({
  page,
}) => {
  await page.route("**/api/market-baseline", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "MARKET_INFORMATION_UNAVAILABLE" },
    }),
  );
  await page.goto("/");
  await expect(page.getByRole("status")).toHaveText(
    "Market information is temporarily unavailable",
  );
  await expect(page.getByRole("listitem")).toHaveCount(0);
  await expect(
    page.getByText("Live rounds are not available yet."),
  ).toBeVisible();
  await expect(
    page.getByText("Fictional market game. Virtual currency only."),
  ).toBeVisible();
  await page.unroute("**/api/market-baseline");
  // The guest form now precedes Retry in the natural keyboard order.
  const retry = page.getByRole("button", { name: "Retry" });
  for (
    let i = 0;
    i < 6 &&
    !(await retry.evaluate((button) => button === document.activeElement));
    i++
  ) {
    await page.keyboard.press("Tab");
  }
  await expect(retry).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listitem")).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
});

test("rejects a malformed response instead of displaying partial prices", async ({
  page,
}) => {
  await page.route("**/api/market-baseline", (route) =>
    route.fulfill({
      json: {
        schemaVersion: 1,
        contentVersion: "1.0",
        rulesVersion: "1.0",
        assets: [],
      },
    }),
  );
  await page.goto("/");
  await expect(page.getByRole("status")).toHaveText(
    "Market information is temporarily unavailable",
  );
  await expect(page.getByRole("listitem")).toHaveCount(0);
});
