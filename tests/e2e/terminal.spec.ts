import { writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { lobbySnapshotSchema } from "../../packages/contracts/dist/index.js";

test("terminal follows committed prices, depth and events across two browsers (AC-03/04/06/09/10/17)", async ({
  browser,
}, testInfo) => {
  test.setTimeout(90_000);
  const hostContext = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
  });
  const guestContext = await browser.newContext({
    viewport: { width: 360, height: 800 },
    reducedMotion: "reduce",
  });
  let unavailableQuotes = false;
  let silence = false;
  // Synthetic transport responses cover unavailable depth and lost freshness
  // without changing the real service's bot resources or recorded history.
  await guestContext.routeWebSocket(/socket\.io/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      const packet = String(message);
      if (silence && /^4[23]/.test(packet)) return;
      const start = packet.indexOf("[");
      if (unavailableQuotes && start >= 0 && /^4[23]/.test(packet)) {
        const body = JSON.parse(packet.slice(start));
        ws.send(
          packet.slice(0, start) +
            JSON.stringify(body, (key, value) =>
              key === "quotes" ? [] : value,
            ),
        );
      } else ws.send(message);
    });
  });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  try {
    for (const [page, name] of [
      [host, "Terminal Host"],
      [guest, "Terminal Guest"],
    ] as const) {
      await page.goto("/");
      await page.getByLabel("Display name").fill(name);
      await page.getByRole("button", { name: "Save guest" }).click();
    }
    await host.getByRole("button", { name: "Create lobby" }).click();
    const code = await host.getByTestId("room-code").innerText();
    await guest.getByLabel("Room code").fill(code);
    await guest.getByRole("button", { name: "Join lobby" }).click();
    for (const page of [host, guest]) {
      await expect(page.getByText("Connected", { exact: true })).toBeVisible();
      await page
        .getByRole("button", { name: "Ready for round", exact: true })
        .click();
    }
    await host
      .getByRole("button", { name: "Start round", exact: true })
      .click();
    const read = (page: Page) =>
      page
        .evaluate(
          async (roomCode) =>
            await (await fetch(`/api/rooms/${roomCode}/snapshot`)).json(),
          code,
        )
        .then((data) => lobbySnapshotSchema.parse(data).round!);
    const money = (cents: number) =>
      `D$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    async function matchesSnapshot(
      page: Page,
      symbol: "FERN" | "BONE" | "AMBR",
    ) {
      const round = await read(page);
      const watchlist = page.getByRole("region", { name: "Asset watchlist" });
      for (const initial of round.openingAssets) {
        const current = round.assets.find((a) => a.symbol === initial.symbol)!;
        const button = watchlist.getByRole("button", {
          name: new RegExp(initial.symbol),
        });
        const change =
          (100 * (current.lastPriceCents - initial.initialPriceCents)) /
          initial.initialPriceCents;
        await expect(button).toContainText(money(current.lastPriceCents));
        await expect(button).toContainText(
          `${change >= 0 ? "+" : ""}${change.toFixed(2)}% since opening`,
        );
      }
      const initial = round.openingAssets.find((a) => a.symbol === symbol)!;
      const expectedPoints = [
        {
          sequence: 0,
          atMs: round.opensAt,
          priceCents: initial.initialPriceCents,
        },
        ...round.priceHistory.filter((p) => p.symbol === symbol),
      ];
      await expect
        .poll(() =>
          page.getByTestId("price-point").evaluateAll((points) =>
            points.map((point) => ({
              sequence: Number(point.getAttribute("data-sequence")),
              atMs: Number(point.getAttribute("data-at-ms")),
              priceCents: Number(point.getAttribute("data-price-cents")),
            })),
          ),
        )
        .toEqual(
          expectedPoints.map(({ sequence, atMs, priceCents }) => ({
            sequence,
            atMs,
            priceCents,
          })),
        );
      const depth = page.getByRole("region", { name: "Bot quote depth" });
      for (const side of ["bid", "ask"] as const) {
        const expected = round.quotes.filter(
          (q) => q.symbol === symbol && q.side === side,
        );
        await expect(
          depth
            .getByRole("list", {
              name: side === "bid" ? "Bids" : "Asks",
              exact: true,
            })
            .getByRole("listitem"),
        ).toHaveCount(expected.length);
        for (const quote of expected) {
          await expect(depth.getByTestId(quote.id)).toContainText(
            money(quote.priceCents),
          );
          await expect(depth.getByTestId(quote.id)).toContainText(
            `${quote.quantity} units`,
          );
        }
      }
    }
    await expect(
      host.getByRole("heading", { name: "Market and your resources" }),
    ).toBeVisible({ timeout: 10_000 });
    const opening = await read(host);
    for (const page of [host, guest]) {
      const watchlist = page.getByRole("region", { name: "Asset watchlist" });
      await expect(watchlist.getByRole("button")).toHaveCount(4);
      await expect(
        watchlist.getByRole("button", { name: /FERN/ }),
      ).toContainText("D$40.00");
      await expect(
        watchlist.getByRole("button", { name: /FERN/ }),
      ).toContainText("+0.00%");
      await expect(page.getByTestId("price-point")).toHaveCount(1);
      await expect(
        page.getByText("No trades yet.", { exact: true }),
      ).toBeVisible();
      const depth = page.getByRole("region", { name: "Bot quote depth" });
      for (const quote of opening.quotes.filter((q) => q.symbol === "FERN")) {
        await expect(depth.getByTestId(quote.id)).toContainText(
          `${quote.quantity} units`,
        );
        await expect(depth.getByTestId(quote.id)).toContainText(
          `D$${(quote.priceCents / 100).toFixed(2)}`,
        );
      }
    }
    // An idle scheduled event changes executable quotes, but adds no trade point.
    const originalLine = await host
      .getByTestId("price-line")
      .getAttribute("points");
    await guest.getByLabel("Maximum buy price (cents)").fill("4100");
    await writeFile(process.env.DINOPUMP_E2E_CLOCK!, "61000");
    await expect(host.getByTestId("news-item")).toHaveCount(1);
    const afterEvent = await read(host);
    expect(afterEvent.trades).toHaveLength(0);
    expect(afterEvent.assets.map((a) => a.lastPriceCents)).toEqual(
      opening.assets.map((a) => a.lastPriceCents),
    );
    expect(afterEvent.quotes).not.toEqual(opening.quotes);
    for (const page of [host, guest]) {
      await expect(page.getByTestId("price-point")).toHaveCount(1);
      await expect(page.getByTestId("event-marker")).toHaveCount(1);
      await expect(page.getByTestId("price-line")).toHaveAttribute(
        "points",
        originalLine!,
      );
    }
    await expect(guest.getByLabel("Maximum buy price (cents)")).toHaveValue(
      "4100",
    );
    await matchesSnapshot(host, "FERN");
    await matchesSnapshot(guest, "FERN");
    // Choose an asset unaffected by the first news effect for the worked buy.
    const symbol = afterEvent.assets.find((a) => a.referencePriceCents === 4000)
      ? "FERN"
      : "BONE";
    for (const page of [host, guest]) {
      await page
        .getByRole("region", { name: "Asset watchlist" })
        .getByRole("button", { name: new RegExp(symbol) })
        .focus();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("combobox", { name: "Asset", exact: true }),
      ).toHaveValue(symbol);
    }
    const price = symbol === "FERN" ? "4100" : "2600";
    await guest.getByLabel("Whole units").fill("150");
    await guest.getByLabel("Maximum buy price (cents)").fill(price);
    await guest.getByRole("button", { name: "Submit buy" }).click();
    await expect(guest.getByTestId("trade-result")).toContainText("Filled");
    const filled = await read(guest);
    const order = filled.recentOrders[0]!;
    expect(order.filledQuantity).toBe(150);
    expect(order.fills).toHaveLength(2);
    const executedTotal = symbol === "FERN" ? 608000 : 380000;
    expect(order.totalValueCents).toBe(executedTotal);
    await expect(guest.getByTestId("trade-result")).toContainText(
      symbol === "FERN"
        ? "Executed total: D$6,080.00"
        : "Executed total: D$3,800.00",
    );
    await expect(guest.getByTestId("trade-result")).toContainText(
      `${executedTotal}/150 cents per unit`,
    );

    for (const page of [host, guest]) {
      await expect(page.getByTestId("price-point")).toHaveCount(3);
      for (const trade of filled.trades) {
        const row = page.getByTestId(`trade-${trade.sequence}`);
        await expect(row).toContainText(
          `${trade.quantity} units at D$${(trade.priceCents / 100).toFixed(2)}`,
        );
        await expect(row).toContainText(
          `D$${(trade.totalValueCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        );
        await expect(row).toContainText(
          "Terminal Guest buys from game liquidity bot",
        );
      }
      await expect(page.getByTestId("selected-last")).toHaveText(
        `D$${(filled.assets.find((a) => a.symbol === symbol)!.lastPriceCents / 100).toFixed(2)}`,
      );
    }
    await matchesSnapshot(host, symbol);
    await matchesSnapshot(guest, symbol);
    await guest.getByLabel("Buy or sell").selectOption("sell");
    await guest.getByLabel("Whole units").fill("151");
    await guest.getByRole("button", { name: "Submit sell" }).click();
    await expect(guest.getByTestId("trade-result")).toContainText("Rejected");
    await expect(guest.getByTestId("price-point")).toHaveCount(3);
    await guest.getByLabel("Whole units").fill("150");
    await guest.getByRole("button", { name: "Submit sell" }).click();
    await expect(guest.getByTestId("trade-result")).toContainText(
      "150 units executed",
    );
    await expect(guest.getByTestId("price-point")).toHaveCount(5);
    // A window of recent tape cannot truncate the round chart on resync.
    await host.getByLabel("Whole units").fill("1");
    for (let i = 0; i < 31; i++) {
      await host.getByRole("button", { name: "Submit buy" }).click();
      await expect(
        host.getByRole("button", { name: "Submit buy" }),
      ).toBeEnabled();
    }
    const history = await read(host);
    expect(history.trades).toHaveLength(30);
    expect(history.priceHistory).toHaveLength(35);
    await expect(host.getByTestId("price-point")).toHaveCount(36);
    await guestContext.setOffline(true);
    await expect(
      guest.getByText("Reconnecting…", { exact: true }),
    ).toBeVisible();
    await expect(
      guest.getByRole("button", { name: "Submit sell" }),
    ).toBeDisabled();
    await guestContext.setOffline(false);
    await expect(guest.getByText("Connected", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(guest.getByTestId("price-point")).toHaveCount(36);
    expect((await read(guest)).priceHistory).toEqual(history.priceHistory);
    await matchesSnapshot(guest, symbol);
    // Switching assets changes chart and ticket together, including after reload.
    await guest
      .getByRole("combobox", { name: "Asset", exact: true })
      .selectOption("AMBR");
    await expect(
      guest.getByRole("heading", { name: "AMBR trade price" }),
    ).toBeVisible();
    await expect(guest.getByTestId("price-point")).toHaveCount(1);
    await matchesSnapshot(guest, "AMBR");
    await guest.reload();
    await expect(guest.getByText("Connected", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await guest
      .getByRole("combobox", { name: "Asset", exact: true })
      .selectOption(symbol);
    await expect(guest.getByTestId("price-point")).toHaveCount(36);
    expect(
      await guest.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    silence = true;
    await expect(
      guest.getByText("Synchronizing…", { exact: true }),
    ).toBeVisible({ timeout: 8000 });
    await expect(
      guest.getByRole("button", { name: "Submit buy" }),
    ).toBeDisabled();
    await expect(
      guest.getByText("Quotes stale or unavailable", { exact: false }).first(),
    ).toBeVisible();
    silence = false;
    await expect(guest.getByText("Connected", { exact: true })).toBeVisible({
      timeout: 15000,
    });
    unavailableQuotes = true;
    await guest.reload();
    await expect(guest.getByText("Connected", { exact: true })).toBeVisible({
      timeout: 15000,
    });
    const emptyDepth = guest.getByRole("region", { name: "Bot quote depth" });
    await expect(
      emptyDepth.getByText("Unavailable liquidity. No covered bids."),
    ).toBeVisible();
    await expect(
      emptyDepth.getByText("Unavailable liquidity. No covered asks."),
    ).toBeVisible();
    await expect(
      guest.getByRole("button", { name: "Submit buy" }),
    ).toBeDisabled();
    unavailableQuotes = false;
    await guest.reload();
    await expect(guest.getByText("Connected", { exact: true })).toBeVisible({
      timeout: 15000,
    });
    await guest
      .getByRole("combobox", { name: "Asset", exact: true })
      .selectOption(symbol);
    await guest.screenshot({
      path: testInfo.outputPath("terminal-360.png"),
      fullPage: true,
    });
    await host.screenshot({
      path: testInfo.outputPath("terminal-desktop.png"),
      fullPage: true,
    });
  } finally {
    await writeFile(process.env.DINOPUMP_E2E_CLOCK!, "0");
    await hostContext.close();
    await guestContext.close();
  }
});
