import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("two guests trade, reconnect, finish, reset and start a fresh round at 360px (AC-11/17)", async ({
  browser,
}, testInfo) => {
  test.setTimeout(150_000);
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext({
    viewport: { width: 360, height: 800 },
  });
  let loseNextTrade = false;
  let blocked = false;
  const submissions: unknown[] = [];
  let originalResultPacket = "";
  let replayOldResult = () => {};
  await guestContext.routeWebSocket(/socket\.io/, (ws) => {
    const server = ws.connectToServer();
    replayOldResult = () => {
      if (originalResultPacket) ws.send(originalResultPacket);
    };
    ws.onMessage((message) => {
      const text = String(message);
      if (text.includes('"order:submit"')) {
        const payload = JSON.parse(text.slice(text.indexOf("[")))[1];
        submissions.push(payload);
        if (loseNextTrade) {
          blocked = true;
          loseNextTrade = false;
        }
      }
      server.send(message);
    });
    server.onMessage((message) => {
      if (String(message).includes('"order:result"') && !originalResultPacket)
        originalResultPacket = String(message);
      if (!blocked) ws.send(message);
      else if (String(message).includes('"order:result"')) {
        blocked = false;
        ws.close();
        server.close();
      }
    });
  });
  const host = await hostContext.newPage(),
    guest = await guestContext.newPage();
  try {
    await host.goto("/");
    await host.getByLabel("Display name").fill("Fern Host");
    await host.getByLabel("Dinosaur").selectOption("triceratops");
    await host.getByRole("button", { name: "Save guest" }).click();
    await host.getByRole("button", { name: "Create lobby" }).click();
    const code = await host.getByTestId("room-code").innerText();
    await expect(host.getByText("Connected", { exact: true })).toBeVisible();
    await guest.goto("/");
    await guest.getByLabel("Display name").fill("Amber Guest");
    await guest.getByLabel("Dinosaur").selectOption("stegosaurus");
    await guest.getByRole("button", { name: "Save guest" }).click();
    await guest.getByLabel("Room code").fill(code.toLowerCase());
    await guest.getByRole("button", { name: "Join lobby" }).focus();
    await guest.keyboard.press("Enter");
    await expect(guest.getByTestId("room-code")).toHaveText(code);
    await expect(host.getByText("Amber Guest", { exact: true })).toBeVisible();
    await expect(guest.getByText("Fern Host", { exact: true })).toBeVisible();
    await expect(
      guest
        .getByRole("region", { name: "Gather your herd" })
        .getByText("Game liquidity bot", { exact: false }),
    ).toBeVisible();
    await expect(
      guest.getByText("Fictional market game. Virtual currency only."),
    ).toBeVisible();
    const before = await guest.evaluate(
      async (roomCode) =>
        (await (await fetch(`/api/rooms/${roomCode}/snapshot`)).json()).players,
      code,
    );
    await guestContext.setOffline(true);
    await expect(
      guest.getByRole("status").filter({ hasText: "Reconnecting" }),
    ).toBeVisible();
    await guestContext.setOffline(false);
    await expect(guest.getByText("Connected", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    // Fail all startup lookups, including React development effect replay.
    let sessionUnavailable = true;
    await guest.route("**/api/session", (route) =>
      sessionUnavailable
        ? route.fulfill({
            status: 503,
            json: {
              error: "SERVICE_UNAVAILABLE",
              message: "Temporarily unavailable",
            },
          })
        : route.continue(),
    );
    await guest.reload();
    await expect(
      guest
        .getByRole("region", { name: "Gather your herd" })
        .getByRole("alert"),
    ).toHaveText("The lobby is temporarily unavailable. Please retry.");
    await expect(guest.getByRole("button", { name: "Save guest" })).toHaveCount(
      0,
    );
    sessionUnavailable = false;
    await expect(guest.getByTestId("room-code")).toHaveText(code);
    const after = await guest.evaluate(
      async (roomCode) =>
        (await (await fetch(`/api/rooms/${roomCode}/snapshot`)).json()).players,
      code,
    );
    expect(after.map((p: { playerId: string }) => p.playerId)).toEqual(
      before.map((p: { playerId: string }) => p.playerId),
    );
    expect(
      await guest.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(
      guest.getByRole("list", { name: "Lobby players" }).getByRole("listitem"),
    ).toHaveCount(2);
    await guest.screenshot({
      path: testInfo.outputPath("lobby-360.png"),
      fullPage: true,
    });
    await expect(
      host.getByRole("button", { name: "Start round", exact: true }),
    ).toBeDisabled();
    await expect(
      guest.getByRole("button", { name: "Start round", exact: true }),
    ).toHaveCount(0);
    await host
      .getByRole("button", { name: "Ready for round", exact: true })
      .focus();
    await host.keyboard.press("Enter");
    await guest
      .getByRole("button", { name: "Ready for round", exact: true })
      .click();
    await expect(
      host.getByRole("button", { name: "Start round", exact: true }),
    ).toBeEnabled();
    await host
      .getByRole("button", { name: "Start round", exact: true })
      .click();
    await expect(guest.getByTestId("round-countdown")).toContainText(
      "Round opens in",
    );
    for (const page of [host, guest]) {
      await expect(
        page.getByRole("heading", { name: "Market and your resources" }),
      ).toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId("own-cash")).toHaveText("D$10,000.00");
      await expect(page.getByTestId("round-remaining")).toContainText(
        "Round closes in",
      );
    }
    const read = async (page: typeof guest) =>
      page.evaluate(
        async (roomCode) =>
          (await (await fetch(`/api/rooms/${roomCode}/snapshot`)).json()).round,
        code,
      );
    const opening = await read(host);
    expect(await read(guest)).toEqual(opening);
    expect(opening.quotes).toHaveLength(24);
    expect(opening.portfolio.holdings).toEqual({
      FERN: 0,
      AMBR: 0,
      VOLC: 0,
      BONE: 0,
    });
    await guestContext.setOffline(true);
    await expect(
      guest.getByRole("status").filter({ hasText: "Reconnecting" }),
    ).toBeVisible();
    await guestContext.setOffline(false);
    await expect(guest.getByText("Connected", { exact: true })).toBeVisible({
      timeout: 15000,
    });
    expect(await read(guest)).toEqual(opening);
    expect(
      await guest.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await guest.screenshot({
      path: testInfo.outputPath("opening-360.png"),
      fullPage: true,
    });
    const ticket = guest.getByRole("region", { name: "Protected trade" });
    await guest.getByLabel("Whole units").fill("150");
    const bid = await read(guest);
    const bestAsk = Math.min(
      ...bid.quotes
        .filter(
          (q: { symbol: string; side: string }) =>
            q.symbol === "FERN" && q.side === "ask",
        )
        .map((q: { priceCents: number }) => q.priceCents),
    );
    await guest.getByLabel("Maximum buy price (cents)").fill(String(bestAsk));
    await ticket.getByRole("button", { name: "Submit buy" }).focus();
    await guest.keyboard.press("Enter");
    await expect(guest.getByTestId("trade-result")).toContainText(
      "Partially filled",
    );
    await expect(guest.getByTestId("trade-result")).toContainText(
      "100 units executed; 50 unfilled",
    );
    await expect(host.getByTestId("own-cash")).toHaveText("D$10,000.00");
    await guest.getByLabel("Whole units").fill("1");
    await guest.getByLabel("Maximum buy price (cents)").fill("100");
    await ticket.getByRole("button", { name: "Submit buy" }).click();
    await expect(guest.getByTestId("trade-result")).toContainText(
      "No liquidity within protection",
    );
    await guest.getByLabel("Buy or sell").selectOption("sell");
    await guest.getByLabel("Whole units").fill("101");
    await ticket.getByRole("button", { name: "Submit sell" }).click();
    await expect(guest.getByTestId("trade-result")).toContainText("Rejected");
    await guest.getByLabel("Whole units").fill("100");
    await ticket.getByRole("button", { name: "Submit sell" }).click();
    await expect(guest.getByTestId("trade-result")).toContainText("Filled");
    await expect(guest.getByTestId("trade-result")).toContainText(
      "100 units executed; 0 unfilled",
    );
    const cashAfterSell = await guest.getByTestId("own-cash").innerText();
    replayOldResult();
    await expect(guest.getByTestId("own-cash")).toHaveText(cashAfterSell);
    await expect(guest.getByTestId("trade-result")).toContainText(
      "100 units executed; 0 unfilled",
    );
    await guest.getByLabel("Buy or sell").selectOption("buy");
    await guest.getByLabel("Whole units").fill("1");
    loseNextTrade = true;
    await ticket.getByRole("button", { name: "Submit buy" }).click();
    await expect(guest.getByTestId("trade-result")).toContainText(
      "Pending reconciliation",
    );
    await expect(
      ticket.getByRole("button", { name: "Submit buy" }),
    ).toBeDisabled();
    await expect(guest.getByText("Connected", { exact: true })).toBeVisible({
      timeout: 15000,
    });
    await expect(guest.getByTestId("trade-result")).toContainText(
      "1 units executed; 0 unfilled",
      { timeout: 15000 },
    );
    const traded = await read(guest);
    expect(traded.portfolio.holdings.FERN).toBe(1);
    const lostRequest = (submissions.at(-1) as { requestId: string }).requestId;
    expect(
      traded.recentOrders.filter(
        (r: { requestId: string }) => r.requestId === lostRequest,
      ),
    ).toHaveLength(1);
    expect(
      traded.trades.filter(
        (t: { sequence: number }) => t.sequence > bid.sequence,
      ),
    ).toHaveLength(3);
    await guest.screenshot({
      path: testInfo.outputPath("trading-360.png"),
      fullPage: true,
    });
    for (const page of [host, guest]) {
      await expect(
        page.getByRole("heading", { name: "The Daily Roar" }),
      ).toBeVisible();
      await expect(
        page.getByText(
          "No news yet. The first market event arrives one minute into the round.",
        ),
      ).toBeVisible();
    }
    await expect(host.getByTestId("news-item")).toHaveCount(1, {
      timeout: 70_000,
    });
    await expect(guest.getByTestId("news-item")).toHaveCount(1);
    const updated = await read(host);
    const guestUpdated = await read(guest);
    expect(guestUpdated.assets).toEqual(updated.assets);
    expect(guestUpdated.quotes).toEqual(updated.quotes);
    expect(guestUpdated.news).toEqual(updated.news);
    expect(updated.sequence).toBeGreaterThan(opening.sequence);
    expect(updated.quotes).not.toEqual(opening.quotes);
    expect(updated.portfolio).toEqual(opening.portfolio);
    expect(
      updated.assets.map((a: { lastPriceCents: number }) => a.lastPriceCents),
    ).toEqual(
      traded.assets.map((a: { lastPriceCents: number }) => a.lastPriceCents),
    );
    expect(updated.news[0].narrationStatus).toBe("pending");
    await expect(
      ticket.getByRole("button", { name: "Submit buy" }),
    ).toBeEnabled();
    await expect(guest.getByTestId("news-item")).toContainText(
      updated.news[0].headline,
    );
    await guestContext.setOffline(true);
    await expect(
      guest.getByRole("status").filter({ hasText: "Reconnecting" }),
    ).toBeVisible();
    await guestContext.setOffline(false);
    await expect(guest.getByText("Connected", { exact: true })).toBeVisible({
      timeout: 15000,
    });
    await expect(guest.getByTestId("news-item")).toHaveCount(1);
    expect((await read(guest)).news).toEqual(updated.news);
    expect(
      await guest.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await guest.screenshot({
      path: testInfo.outputPath("news-360.png"),
      fullPage: true,
    });
    await guestContext.setOffline(true);
    await expect(
      guest.getByText("Reconnecting…", { exact: true }),
    ).toBeVisible();
    if (!process.env.DINOPUMP_E2E_CLOCK) throw new Error("Missing test clock");
    await writeFile(process.env.DINOPUMP_E2E_CLOCK, "600000");
    await expect(
      host.getByRole("heading", { name: "Round results", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await guestContext.setOffline(false);
    await expect(
      guest.getByRole("heading", { name: "Round results", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    const historical = async (page: typeof guest) =>
      page.evaluate(
        async (roundId) =>
          (await fetch(`/api/rounds/${roundId}/results`)).json(),
        opening.roundId,
      );
    const firstHostResult = await historical(host),
      firstGuestResult = await historical(guest);
    expect(firstGuestResult.rankings).toEqual(firstHostResult.rankings);
    expect(firstHostResult.portfolio.cashCents).toBe(1000000);
    expect(firstGuestResult.portfolio.holdings.FERN).toBe(1);
    await expect(
      guest
        .getByRole("list", { name: "Round event timeline" })
        .getByRole("listitem"),
    ).toHaveCount(9);
    await expect(
      guest.getByRole("button", { name: "Return to lobby" }),
    ).toHaveCount(0);
    expect(
      await guest.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await guest.screenshot({
      path: testInfo.outputPath("results-360.png"),
      fullPage: true,
    });
    await host.getByRole("button", { name: "Return to lobby" }).focus();
    await host.keyboard.press("Enter");
    for (const page of [host, guest]) {
      await expect(
        page.getByRole("button", { name: "Ready for round", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Round results", exact: true }),
      ).toHaveCount(0);
      await page
        .getByRole("button", { name: "Ready for round", exact: true })
        .click();
    }
    await host
      .getByRole("button", { name: "Start round", exact: true })
      .click();
    await expect(guest.getByTestId("own-cash")).toHaveText("D$10,000.00", {
      timeout: 15000,
    });
    const second = await read(guest);
    expect(second.roundId).not.toBe(opening.roundId);
    expect(second.portfolio.holdings.FERN).toBe(0);
    replayOldResult();
    await expect(guest.getByTestId("own-cash")).toHaveText("D$10,000.00");
    expect(await historical(host)).toEqual(firstHostResult);
    expect(await historical(guest)).toEqual(firstGuestResult);
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});
