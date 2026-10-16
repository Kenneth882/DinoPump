import { terminalView } from "../helpers/terminal.js";
import { writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import {
  lobbySnapshotSchema,
  roundEndedSchema,
  marketBatchSchema,
} from "../../packages/contracts/dist/index.js";

test("owners see marked portfolios and shared provisional ranks (AC-04/10/11/17)", async ({
  browser,
}, testInfo) => {
  test.setTimeout(90_000);
  const hostContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const guestContext = await browser.newContext({
    viewport: { width: 360, height: 800 },
    reducedMotion: "reduce",
  });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  const delivered = new Map<Page, string[]>([
    [host, []],
    [guest, []],
  ]);
  const responseReads: Promise<void>[] = [];
  for (const page of [host, guest]) {
    page.on("websocket", (socket) =>
      socket.on("framereceived", ({ payload }) =>
        delivered.get(page)!.push(String(payload)),
      ),
    );
    page.on("response", (response) => {
      if (response.url().includes("/api/"))
        responseReads.push(
          response
            .text()
            .then((body) => {
              delivered.get(page)!.push(body);
            })
            .catch(() => {}),
        );
    });
  }
  try {
    for (const [page, name] of [
      [host, "Portfolio Host"],
      [guest, "Portfolio Guest"],
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
        .then((raw) => lobbySnapshotSchema.parse(raw));
    await expect(
      host.getByRole("heading", { name: "Market and your resources" }),
    ).toBeVisible({ timeout: 10_000 });
    const opening = (await read(host)).round!;
    expect(
      opening.totals.map((r) => [
        r.rank,
        r.portfolioValueCents,
        r.profitCents,
        r.returnPercent,
      ]),
    ).toEqual([
      [1, 1000000, 0, 0],
      [1, 1000000, 0, 0],
    ]);
    for (const page of [host, guest]) {
      await terminalView(page, "Portfolio");
      const portfolio = page.getByRole("region", {
        name: "Your portfolio",
        exact: true,
      });
      await expect(portfolio.getByTestId("own-cash")).toHaveText("D$10,000.00");
      await expect(portfolio.getByTestId("portfolio-value")).toHaveText(
        "D$10,000.00",
      );
      await expect(
        portfolio.getByText("No holdings yet.", { exact: true }),
      ).toBeVisible();
      await expect(portfolio.getByTestId("portfolio-profit")).toHaveText(
        "Unchanged: D$0.00",
      );
      await expect(portfolio.getByTestId("portfolio-return")).toHaveText(
        "Unchanged: 0.00%",
      );
      const rows = page
        .getByRole("region", { name: "Provisional leaderboard" })
        .getByRole("listitem");
      await expect(rows).toHaveCount(2);
      await expect(rows.nth(0)).toContainText(
        "Rank 1 (shared) · Portfolio Host",
      );
      await expect(rows.nth(1)).toContainText(
        "Rank 1 (shared) · Portfolio Guest",
      );
    }
    const hostId = opening.totals[0]!.playerId;
    const guestId = opening.totals[1]!.playerId;
    const own = host.getByRole("region", {
      name: "Your portfolio",
      exact: true,
    });
    await host.getByLabel("Whole units").fill("150");
    await host.getByLabel("Maximum buy price (cents)").fill("4100");
    await host.getByRole("button", { name: "Submit buy" }).click();
    await expect(host.getByTestId("trade-result")).toContainText(
      "150 units executed",
    );
    const bought = (await read(host)).round!;
    expect(bought.portfolio.cashCents).toBe(392000);
    expect(bought.portfolio.holdings.FERN).toBe(150);
    expect(bought.totals.find((r) => r.playerId === hostId)).toMatchObject({
      rank: 1,
      portfolioValueCents: 1004000,
      profitCents: 4000,
      returnPercent: 0.4,
    });
    await expect(own.getByTestId("own-cash")).toHaveText("D$3,920.00");
    await expect(own.getByTestId("portfolio-value")).toHaveText("D$10,040.00");
    await expect(own.getByTestId("portfolio-profit")).toHaveText(
      "Profit: D$40.00",
    );
    await expect(own.getByTestId("portfolio-return")).toHaveText("Gain: 0.40%");
    const fern = own.getByTestId("holding-FERN");
    await expect(fern.getByTestId("holding-units")).toHaveText("150 units");
    await expect(fern.getByTestId("holding-mark")).toHaveText("D$40.80");
    await expect(fern.getByTestId("holding-value")).toHaveText("D$6,120.00");
    for (const page of [host, guest]) {
      const ranks = page.getByRole("region", {
        name: "Provisional leaderboard",
      });
      await expect(ranks.getByTestId(`rank-${hostId}`)).toContainText(
        "Rank 1 · Portfolio Host",
      );
      await expect(ranks.getByTestId(`rank-${guestId}`)).toContainText(
        "Rank 2 · Portfolio Guest",
      );
      await expect(ranks.getByTestId(`rank-${hostId}`)).toContainText(
        "D$10,040.00",
      );
    }
    // Best FERN bid after the buy's +10 bps reference impact is D$39.63.
    await host.getByLabel("Buy or sell").selectOption("sell");
    await host.getByLabel("Whole units").fill("50");
    await host.getByLabel("Minimum sell price (cents)").fill("3963");
    await host.getByRole("button", { name: "Submit sell" }).click();
    await expect(host.getByTestId("trade-result")).toContainText(
      "50 units executed",
    );
    const sold = (await read(host)).round!;
    expect(sold.portfolio.cashCents).toBe(590150);
    expect(sold.portfolio.holdings.FERN).toBe(100);
    expect(sold.totals.find((r) => r.playerId === hostId)).toMatchObject({
      rank: 2,
      portfolioValueCents: 986450,
      profitCents: -13550,
    });
    await expect(own.getByTestId("portfolio-value")).toHaveText("D$9,864.50");
    await expect(own.getByTestId("portfolio-profit")).toHaveText(
      "Loss: D$135.50",
    );
    await expect(own.getByTestId("portfolio-return")).toHaveText("Loss: 1.36%");
    await expect(fern.getByTestId("holding-value")).toHaveText("D$3,963.00");
    // The guest's single buy uses the rebuilt D$40.40 ask, marking both portfolios.
    await terminalView(guest, "Trade");
    await guest.getByLabel("Whole units").fill("1");
    await guest.getByLabel("Maximum buy price (cents)").fill("4040");
    await guest.getByRole("button", { name: "Submit buy" }).click();
    await expect(guest.getByTestId("trade-result")).toContainText(
      "1 units executed",
    );
    const guestTraded = (await read(guest)).round!;
    expect(guestTraded.portfolio.cashCents).toBe(995960);
    expect(guestTraded.portfolio.holdings.FERN).toBe(1);
    const afterBoth = (await read(host)).round!;
    expect(afterBoth.totals.find((r) => r.playerId === hostId)).toMatchObject({
      portfolioValueCents: 994150,
      profitCents: -5850,
    });
    await expect(own.getByTestId("portfolio-value")).toHaveText("D$9,941.50");
    await expect(own.getByTestId("portfolio-return")).toHaveText("Loss: 0.59%");
    await terminalView(guest, "Portfolio");
    const guestPortfolio = guest.getByRole("region", {
      name: "Your portfolio",
      exact: true,
    });
    await expect(guestPortfolio.getByTestId("own-cash")).toHaveText(
      "D$9,959.60",
    );
    await expect(
      guestPortfolio.getByTestId("holding-FERN").getByTestId("holding-units"),
    ).toHaveText("1 unit");
    await expect(guestPortfolio.getByTestId("portfolio-value")).toHaveText(
      "D$10,000.00",
    );
    await writeFile(process.env.DINOPUMP_E2E_CLOCK!, "61000");
    await expect(host.getByTestId("news-item")).toHaveCount(1);
    const afterNews = (await read(host)).round!;
    expect(afterNews.quotes).not.toEqual(afterBoth.quotes);
    expect(afterNews.totals).toEqual(afterBoth.totals);
    await expect(fern.getByTestId("holding-mark")).toHaveText("D$40.40");
    await expect(own.getByTestId("portfolio-value")).toHaveText("D$9,941.50");
    await expect(
      own.getByText("Quote changes alone do not change your value.", {
        exact: false,
      }),
    ).toBeVisible();
    await guestContext.setOffline(true);
    const offlineGuest = host
      .getByRole("region", { name: "Provisional leaderboard" })
      .getByTestId(`rank-${guestId}`);
    await expect(offlineGuest).toContainText("Offline · still ranked", {
      timeout: 15_000,
    });
    await expect(offlineGuest).toContainText("Rank 1 · Portfolio Guest");
    await expect(offlineGuest).toContainText("D$10,000.00");
    await guestContext.setOffline(false);
    await expect(guest.getByText("Connected", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    expect((await read(guest)).round!.portfolio).toEqual(guestTraded.portfolio);
    await expect(guestPortfolio.getByTestId("portfolio-value")).toHaveText(
      "D$10,000.00",
    );
    // Read-only panels and their holdings disclosure remain keyboard reachable.
    await guestPortfolio.focus();
    await expect(guestPortfolio).toBeFocused();
    await guestPortfolio
      .getByText("Your holdings at last-trade marks", { exact: true })
      .focus();
    await guest.keyboard.press("Enter");
    await expect(guestPortfolio.getByTestId("holding-FERN")).toBeHidden();
    await guest.keyboard.press("Enter");
    await expect(guestPortfolio.getByTestId("holding-FERN")).toBeVisible();
    expect(
      await guest.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await host.screenshot({
      path: testInfo.outputPath("portfolio-desktop.png"),
      fullPage: true,
    });
    await guest.screenshot({
      path: testInfo.outputPath("portfolio-360.png"),
      fullPage: true,
    });
    const finalized = (page: Page) =>
      page
        .evaluate(
          async (roundId) =>
            await (await fetch(`/api/rounds/${roundId}/results`)).json(),
          opening.roundId,
        )
        .then((raw) => roundEndedSchema.parse(raw));
    await guestContext.setOffline(true);
    await writeFile(process.env.DINOPUMP_E2E_CLOCK!, "611000");
    await expect(
      host.getByRole("heading", { name: "Round results", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    const hostFinal = await finalized(host);
    expect(hostFinal.status).toBe("FINISHED");
    if (hostFinal.status !== "FINISHED")
      throw new Error("Expected frozen results");
    expect(hostFinal.playerId).toBe(hostId);
    expect(hostFinal.portfolio).toEqual(afterBoth.portfolio);
    expect(hostFinal.marks.FERN).toBe(4040);
    expect(hostFinal.rankings.find((r) => r.playerId === hostId)).toMatchObject(
      { rank: 2, portfolioValueCents: 994150, profitCents: -5850 },
    );
    expect(hostFinal.timeline).toHaveLength(9);
    const finalPanel = host.getByRole("region", {
      name: "Your final portfolio",
      exact: true,
    });
    await expect(finalPanel.getByTestId("portfolio-value")).toHaveText(
      "D$9,941.50",
    );
    await expect(finalPanel.getByTestId("portfolio-profit")).toHaveText(
      "Loss: D$58.50",
    );
    await expect(finalPanel.getByTestId("portfolio-return")).toHaveText(
      "Loss: 0.59%",
    );
    await expect(finalPanel.getByTestId("final-cash")).toHaveText("D$5,901.50");
    await expect(
      finalPanel.getByTestId("holding-FERN").getByTestId("holding-value"),
    ).toHaveText("D$4,040.00");
    await expect(
      host
        .getByRole("list", { name: "Round event timeline" })
        .getByRole("listitem"),
    ).toHaveCount(9);
    await guestContext.setOffline(false);
    await expect(
      guest.getByRole("heading", { name: "Round results", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    const guestFinal = await finalized(guest);
    if (guestFinal.status !== "FINISHED")
      throw new Error("Expected frozen results");
    expect(guestFinal.portfolio).toEqual(guestTraded.portfolio);
    expect(guestFinal.rankings).toEqual(hostFinal.rankings);
    await expect(
      guest
        .getByRole("region", { name: "Your final portfolio", exact: true })
        .getByTestId("portfolio-value"),
    ).toHaveText("D$10,000.00");
    await guest.reload();
    await expect(
      guest.getByRole("heading", { name: "Round results", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    expect(await finalized(guest)).toEqual(guestFinal);
    await host.screenshot({
      path: testInfo.outputPath("results-desktop.png"),
      fullPage: true,
    });
    await guest.screenshot({
      path: testInfo.outputPath("results-360.png"),
      fullPage: true,
    });
    await host.getByRole("button", { name: "Return to lobby" }).click();
    for (const page of [host, guest])
      await expect(
        page.getByRole("button", { name: "Ready for round", exact: true }),
      ).toBeVisible();
    expect(await finalized(host)).toEqual(hostFinal);
    expect(await finalized(guest)).toEqual(guestFinal);
    for (const page of [host, guest])
      await page
        .getByRole("button", { name: "Ready for round", exact: true })
        .click();
    await host
      .getByRole("button", { name: "Start round", exact: true })
      .click();
    await expect(
      host
        .getByRole("region", { name: "Your portfolio", exact: true })
        .getByTestId("own-cash"),
    ).toHaveText("D$10,000.00", { timeout: 10000 });
    expect((await read(host)).round!.roundId).not.toBe(opening.roundId);
    expect(await finalized(host)).toEqual(hostFinal);
    expect(await finalized(guest)).toEqual(guestFinal);
    // A fresh no-trade round closes with shared winners in stable join order.
    await writeFile(process.env.DINOPUMP_E2E_CLOCK!, "1212000");
    for (const page of [host, guest]) {
      await expect(
        page.getByRole("heading", { name: "Round results", exact: true }),
      ).toBeVisible({ timeout: 15000 });
      const ranks = page
        .getByRole("list", { name: "Final rankings" })
        .getByRole("listitem");
      await expect(ranks.nth(0)).toContainText(
        "Rank 1 (shared) · Portfolio Host",
      );
      await expect(ranks.nth(1)).toContainText(
        "Rank 1 (shared) · Portfolio Guest",
      );
      await expect(
        page.getByRole("status").filter({ hasText: "Tied winners" }),
      ).toContainText("Portfolio Host, Portfolio Guest");
      const emptyFinal = page.getByRole("region", {
        name: "Your final portfolio",
        exact: true,
      });
      await expect(
        emptyFinal.getByText("No remaining holdings.", { exact: true }),
      ).toBeVisible();
      await expect(emptyFinal.getByTestId("portfolio-value")).toHaveText(
        "D$10,000.00",
      );
    }
    expect(await finalized(host)).toEqual(hostFinal);
    expect(await finalized(guest)).toEqual(guestFinal);
    await Promise.all(responseReads);
    const hostRequestIds = bought.recentOrders
      .map((o) => o.requestId)
      .concat(sold.recentOrders.map((o) => o.requestId));
    const guestRequestIds = guestTraded.recentOrders.map((o) => o.requestId);
    const cookies = [
      ...(await hostContext.cookies()),
      ...(await guestContext.cookies()),
    ].filter((c) => c.name === "dino_session");
    expect(cookies.length).toBe(2);
    expect(cookies.every((cookie) => cookie.httpOnly)).toBe(true);
    for (const [page, otherRequests] of [
      [host, guestRequestIds],
      [guest, hostRequestIds],
    ] as const) {
      const bodies = delivered.get(page)!;
      expect(bodies.length).toBeGreaterThan(10);
      expect(
        bodies.some((body) => otherRequests.some((id) => body.includes(id))),
      ).toBe(false);
      expect(
        bodies.some((body) =>
          cookies.some((cookie) => body.includes(cookie.value)),
        ),
      ).toBe(false);
      expect(
        bodies.some((body) =>
          /"(secret_hash|sessionSecret|session_secret|secret)"/.test(body),
        ),
      ).toBe(false);
      const publicBatches = bodies.filter((body) =>
        body.startsWith('42["market:batch"'),
      );
      expect(publicBatches.length).toBeGreaterThan(0);
      for (const body of publicBatches) {
        const batch = marketBatchSchema.parse(JSON.parse(body.slice(2))[1]);
        expect("portfolio" in batch).toBe(false);
        for (const total of batch.totals)
          expect(Object.keys(total).sort()).toEqual([
            "joinOrder",
            "playerId",
            "portfolioValueCents",
            "profitCents",
            "rank",
            "returnPercent",
          ]);
      }
    }
  } finally {
    await writeFile(process.env.DINOPUMP_E2E_CLOCK!, "0");
    await hostContext.close();
    await guestContext.close();
  }
});
