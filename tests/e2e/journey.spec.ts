import { writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

import {
  lobbySnapshotSchema,
  newsItemSchema,
  roundEndedSchema,
} from "../../packages/contracts/dist/index.js";
import { terminalView } from "../helpers/terminal.js";

async function typeField(page: Page, label: string, value: string) {
  await page.getByLabel(label, { exact: true }).focus();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(value);
}

async function activate(page: Page, name: string) {
  const button = page.getByRole("button", { name, exact: true });
  await expect(button).toBeEnabled();
  await button.focus();
  await page.keyboard.press("Enter");
}

test("two players complete the keyboard journey on desktop and at 360px (AC-10/11/13/17)", async ({
  browser,
}, testInfo) => {
  test.setTimeout(90000);
  const desktop = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
  });
  const mobile = await browser.newContext({
    viewport: { width: 360, height: 800 },
    reducedMotion: "reduce",
  });
  let loseNextOrder = false;
  let withhold = false;
  let committedWhilePending = false;
  let silence = false;
  let disconnect = () => {};
  const inject = new Map<string, (packet: string) => void>();
  for (const [name, context] of [
    ["host", desktop],
    ["guest", mobile],
  ] as const) {
    await context.routeWebSocket(/socket\.io/, (ws) => {
      const server = ws.connectToServer();
      inject.set(name, (packet) => ws.send(packet));
      if (name === "guest")
        disconnect = () => {
          withhold = false;
          ws.close();
          server.close();
        };
      ws.onMessage((message) => {
        if (
          name === "guest" &&
          loseNextOrder &&
          String(message).includes('"order:submit"')
        ) {
          loseNextOrder = false;
          withhold = true;
        }
        server.send(message);
      });
      server.onMessage((message) => {
        if (name === "guest" && (withhold || silence)) {
          if (String(message).includes('"order:result"'))
            committedWhilePending = true;
          if (/^4[23]/.test(String(message))) return;
        }
        ws.send(message);
      });
    });
  }
  const firstVisit = new Map<Page, number>();
  const host = await desktop.newPage();
  const guest = await mobile.newPage();
  try {
    for (const [page, name] of [
      [host, "Journey Host"],
      [guest, "Journey Guest"],
    ] as const) {
      firstVisit.set(page, Date.now());
      await page.goto("/");
      await page.getByLabel("Display name").focus();
      await page.keyboard.type(name);
      await page.keyboard.press("Tab");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("button", { name: "Save guest" }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
    }
    await host.getByRole("button", { name: "Create lobby" }).focus();
    await host.keyboard.press("Enter");
    const code = await host.getByTestId("room-code").innerText();
    await guest.getByLabel("Room code").focus();
    await guest.keyboard.type(code);
    await guest.keyboard.press("Tab");
    await guest.keyboard.press("Enter");
    for (const page of [host, guest]) {
      await expect(page.getByText("Connected", { exact: true })).toBeVisible();
      await page
        .getByRole("button", { name: "Ready for round", exact: true })
        .focus();
      await page.keyboard.press("Enter");
    }
    await expect(
      host.getByRole("button", { name: "Start round", exact: true }),
    ).toBeEnabled();
    await host
      .getByRole("button", { name: "Start round", exact: true })
      .focus();
    await host.keyboard.press("Enter");
    await expect(
      guest.getByRole("tab", { name: "Market", exact: true }),
    ).toBeVisible({ timeout: 10000 });
    await expect(guest.getByRole("tab", { selected: true })).toHaveText(
      "Market",
    );
    await expect(guest.getByRole("tabpanel")).toHaveCount(1);
    await expect(
      guest.getByRole("region", { name: "Protected trade" }),
    ).toBeHidden();
    await guest.getByRole("tab", { name: "Market", exact: true }).focus();
    await guest.keyboard.press("ArrowRight");
    await expect(
      guest.getByRole("tab", { name: "Trade", exact: true }),
    ).toBeFocused();
    await expect(guest.getByRole("tab", { selected: true })).toHaveText(
      "Trade",
    );
    await guest.keyboard.press("Home");
    await expect(guest.getByRole("tab", { selected: true })).toHaveText(
      "Market",
    );
    await guest.keyboard.press("ArrowLeft");
    await expect(guest.getByRole("tab", { selected: true })).toHaveText("News");
    await guest.keyboard.press("ArrowRight");
    await expect(guest.getByRole("tab", { selected: true })).toHaveText(
      "Market",
    );
    await guest.keyboard.press("ArrowRight");
    await typeField(guest, "Whole units", "150");
    await typeField(guest, "Maximum buy price (cents)", "4100");
    await guest.getByRole("tab", { name: "Trade", exact: true }).focus();
    await guest.keyboard.press("End");
    await expect(guest.getByRole("tab", { selected: true })).toHaveText("News");
    await expect(guest.getByTestId("trade-result")).toBeVisible();
    await expect(
      guest.getByText(
        "No news yet. The first market event arrives one minute into the round.",
      ),
    ).toBeVisible();
    await guest.keyboard.press("ArrowLeft");
    await expect(
      guest.getByText("No holdings yet.", { exact: true }),
    ).toBeVisible();
    await guest.keyboard.press("ArrowLeft");
    await expect(guest.getByLabel("Whole units")).toHaveValue("150");
    await expect(guest.getByLabel("Maximum buy price (cents)")).toHaveValue(
      "4100",
    );
    await guest.screenshot({
      path: testInfo.outputPath("trade-360.png"),
      fullPage: true,
    });
    await guest.screenshot({
      path: testInfo.outputPath("trade-360-viewport.png"),
    });
    // Every ticket control fits the narrow viewport and has a visible focus ring.
    for (const control of await guest
      .getByRole("region", { name: "Protected trade" })
      .locator("input, select, button")
      .all()) {
      const bounds = await control.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(360);
    }
    // Returning from the bottom of the ticket must not focus behind the sticky bar.
    await guest.getByRole("button", { name: "Submit buy" }).focus();
    await guest.getByRole("combobox", { name: "Asset", exact: true }).focus();
    const assetBox = await guest
      .getByRole("combobox", { name: "Asset", exact: true })
      .boundingBox();
    const navigationBox = await guest
      .locator(".terminal-navigation")
      .boundingBox();
    expect(assetBox!.y).toBeGreaterThanOrEqual(
      navigationBox!.y + navigationBox!.height,
    );
    await guest.getByLabel("Whole units").focus();
    expect(
      await guest
        .getByLabel("Whole units")
        .evaluate((el) => getComputedStyle(el).outlineStyle),
    ).toBe("solid");
    await guest.keyboard.press("Tab");
    await expect(guest.getByLabel("Maximum buy price (cents)")).toBeFocused();
    await guest.keyboard.press("Tab");
    await expect(
      guest.getByRole("button", { name: "Submit buy" }),
    ).toBeFocused();
    const bar = guest.locator(".terminal-bar");
    const barBox = await bar.boundingBox();
    expect(barBox!.y).toBeGreaterThanOrEqual(0);
    expect(barBox!.y + barBox!.height).toBeLessThan(800);
    await expect(bar).toContainText("Round closes in");
    await expect(bar).toContainText("Connected");
    await expect(bar).toContainText(
      "Fictional market game. Virtual currency only.",
    );
    // Resize keeps the same mounted form and selection in both layouts.
    await guest.setViewportSize({ width: 1600, height: 1000 });
    await expect(guest.getByRole("tablist")).toHaveCount(0);
    await expect(
      guest.getByRole("region", { name: "Asset watchlist" }),
    ).toBeVisible();
    await guest.setViewportSize({ width: 360, height: 800 });
    await terminalView(guest, "Trade");
    await expect(guest.getByLabel("Whole units")).toHaveValue("150");

    const read = async (page: Page) =>
      lobbySnapshotSchema.parse(
        await page.evaluate(
          async (roomCode) =>
            await (await fetch(`/api/rooms/${roomCode}/snapshot`)).json(),
          code,
        ),
      );
    const opening = (await read(host)).round!;
    await host
      .getByRole("region", { name: "Asset watchlist" })
      .getByRole("button", { name: /BONE/ })
      .focus();
    await host.keyboard.press("Enter");
    await expect(
      host.getByRole("combobox", { name: "Asset", exact: true }),
    ).toHaveValue("BONE");
    await typeField(host, "Whole units", "1");
    await activate(host, "Submit buy");
    await expect(host.getByTestId("trade-result")).toContainText(
      "1 units executed",
    );
    const desktopFirstTradeMs = Date.now() - firstVisit.get(host)!;
    loseNextOrder = true;
    await activate(guest, "Submit buy");
    await expect.poll(() => committedWhilePending).toBe(true);
    await expect(guest.getByTestId("trade-result")).toContainText(
      "Pending reconciliation",
    );
    await expect(
      guest.getByRole("button", { name: "Submit buy" }),
    ).toBeDisabled();
    await terminalView(guest, "News");
    await expect(guest.getByTestId("trade-result")).toBeVisible();
    disconnect();
    await expect(guest.getByTestId("connection-status")).toHaveText(
      "Reconnecting…",
    );
    await expect(guest.getByTestId("connection-status")).toHaveText(
      "Connected",
      { timeout: 15000 },
    );
    await expect(guest.getByTestId("trade-result")).toContainText(
      "150 units executed; 0 unfilled",
    );
    await expect(guest.getByTestId("trade-result")).toContainText(
      "Executed total: D$6,080.00",
    );
    const mobileFirstTradeMs = Date.now() - firstVisit.get(guest)!;
    expect(desktopFirstTradeMs).toBeLessThan(120000);
    expect(mobileFirstTradeMs).toBeLessThan(120000);
    const timingPath = testInfo.outputPath("first-trade-timing.json");
    await writeFile(
      timingPath,
      JSON.stringify({ desktopFirstTradeMs, mobileFirstTradeMs }),
    );
    await testInfo.attach("first-trade-timing.json", {
      path: timingPath,
      contentType: "application/json",
    });
    const bought = (await read(guest)).round!;
    expect(bought.recentOrders).toHaveLength(1);
    expect(bought.portfolio).toMatchObject({
      cashCents: 392000,
      holdings: { FERN: 150 },
    });
    await expect(guest.getByTestId("trade-result")).toHaveAttribute(
      "role",
      "status",
    );
    await expect(guest.getByTestId("trade-result")).toHaveAttribute(
      "aria-atomic",
      "true",
    );
    await terminalView(guest, "Trade");
    await guest.getByLabel("Buy or sell").focus();
    await guest.keyboard.press("s");
    await guest.keyboard.press("Tab");
    await expect(guest.getByLabel("Buy or sell")).toHaveValue("sell");
    await typeField(guest, "Whole units", "151");
    await activate(guest, "Submit sell");
    await expect(guest.getByTestId("trade-result")).toContainText("Rejected");
    await typeField(guest, "Whole units", "50");
    await typeField(guest, "Minimum sell price (cents)", "3963");
    await activate(guest, "Submit sell");
    await expect(guest.getByTestId("trade-result")).toContainText(
      "50 units executed; 0 unfilled",
    );
    await terminalView(guest, "Portfolio");
    await expect(guest.getByTestId("own-cash")).toHaveText("D$5,901.50");
    await expect(guest.getByTestId("holding-FERN")).toContainText("100 units");
    await expect(
      guest
        .getByRole("region", { name: "Your portfolio", exact: true })
        .getByTestId("portfolio-profit"),
    ).toHaveText("Loss: D$135.50");
    await guest
      .getByText("Your holdings at last-trade marks", { exact: true })
      .focus();
    await guest.keyboard.press("Enter");
    await expect(guest.getByTestId("holding-FERN")).toBeHidden();
    await guest.keyboard.press("Enter");
    await expect(guest.getByTestId("holding-FERN")).toBeVisible();
    const traded = (await read(host)).round!;
    const other = (await read(guest)).round!;
    expect(other.assets).toEqual(traded.assets);
    expect(other.quotes).toEqual(traded.quotes);
    expect(other.totals).toEqual(traded.totals);
    await terminalView(guest, "News");
    await writeFile(process.env.DINOPUMP_E2E_CLOCK!, "61000");
    await expect(guest.getByTestId("news-item")).toHaveCount(1);
    const afterEvent = (await read(host)).round!;
    expect(afterEvent.assets.map((a) => a.lastPriceCents)).toEqual(
      traded.assets.map((a) => a.lastPriceCents),
    );
    expect(afterEvent.quotes).not.toEqual(traded.quotes);
    const source = afterEvent.news[0]!;
    for (const page of [host, guest]) {
      const card = page.getByTestId("news-item");
      await expect(card).toContainText(source.headline);
      await expect(card).toContainText(source.facts);
      await expect(card).toContainText(source.commentary);
      await expect(card.getByTestId("ai-narration")).toHaveCount(0);
      // The market, chart and news must not become live tick announcements.
      expect(
        await card.evaluate((el) =>
          el.closest('[aria-live], [role="status"], [role="log"]'),
        ),
      ).toBeNull();
      const published = newsItemSchema.parse({
        ...source,
        narrationStatus: "published",
        narrationProvenance: {
          provider: "synthetic",
          model: "journey",
          promptVersion: "fixture",
          durationMs: 1,
          validationStatus: "accepted",
        },
        narration: {
          headline: "Synthetic enhancement",
          commentary: "Recorded fictional market context. <b>Plain text</b>",
          capturedAtMs: source.appliedAtMs,
          elapsedMs: source.appliedAtMs - afterEvent.opensAt,
        },
      });
      inject.get(page === host ? "host" : "guest")!(
        `42${JSON.stringify(["news:update", published])}`,
      );
      await expect(card.getByTestId("ai-narration")).toContainText(
        "AI narration · As of 1:",
      );
      await expect(card.getByTestId("ai-narration")).toContainText(
        "<b>Plain text</b>",
      );
      await expect(card.getByTestId("ai-narration").locator("b")).toHaveCount(
        0,
      );
      await expect(card).toContainText(source.commentary);
      await expect(card.locator("time")).toHaveAttribute(
        "datetime",
        new Date(source.appliedAtMs).toISOString(),
      );
      await expect(page.getByTestId("news-item")).toHaveCount(1);
    }
    // The enhanced UI fixture never changes service facts or final outcomes.
    expect((await read(host)).round).toEqual(afterEvent);
    silence = true;
    await expect(guest.getByTestId("connection-status")).toHaveText(
      "Synchronizing…",
      { timeout: 8000 },
    );
    await terminalView(guest, "Trade");
    await expect(
      guest.getByRole("button", { name: "Submit sell" }),
    ).toBeDisabled();
    await expect(bar).toContainText("Quotes stale or unavailable");
    silence = false;
    await expect(guest.getByTestId("connection-status")).toHaveText(
      "Connected",
      { timeout: 15000 },
    );
    await expect(
      guest.getByRole("button", { name: "Submit sell" }),
    ).toBeEnabled();
    expect(
      await guest.evaluate(
        () => matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
    ).toBe(true);
    expect(await guest.evaluate(() => document.getAnimations().length)).toBe(0);
    expect(
      await guest.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    for (const [page, name] of [
      [host, "desktop"],
      [guest, "360"],
    ] as const) {
      await page.screenshot({
        path: testInfo.outputPath(`market-${name}.png`),
        fullPage: true,
      });
    }
    await mobile.setOffline(true);
    await expect(guest.getByTestId("connection-status")).toHaveText(
      "Reconnecting…",
    );
    await writeFile(process.env.DINOPUMP_E2E_CLOCK!, "611000");
    await expect(
      host.getByRole("heading", { name: "Round results", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await mobile.setOffline(false);
    await expect(
      guest.getByRole("heading", { name: "Round results", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    const results = async (page: Page) =>
      roundEndedSchema.parse(
        await page.evaluate(
          async (roundId) =>
            await (await fetch(`/api/rounds/${roundId}/results`)).json(),
          opening.roundId,
        ),
      );
    const hostResult = await results(host),
      guestResult = await results(guest);
    expect(guestResult.status).toBe("FINISHED");
    if (guestResult.status !== "FINISHED" || hostResult.status !== "FINISHED")
      throw new Error("Expected immutable results");
    expect(guestResult.rankings).toEqual(hostResult.rankings);
    expect(guestResult.timeline).toHaveLength(9);
    expect(guestResult.marks.FERN).toBe(3963);
    expect(guestResult.portfolio).toMatchObject({
      cashCents: 590150,
      holdings: { FERN: 100 },
    });
    await expect(
      guest
        .getByRole("region", { name: "Your final portfolio", exact: true })
        .getByTestId("portfolio-value"),
    ).toHaveText("D$9,864.50");
    await guest.reload();
    await expect(
      guest.getByRole("heading", { name: "Round results", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    expect(await results(guest)).toEqual(guestResult);
    await guest.screenshot({
      path: testInfo.outputPath("results-360.png"),
      fullPage: true,
    });
    await activate(host, "Return to lobby");
    await expect(
      guest.getByRole("button", { name: "Ready for round", exact: true }),
    ).toBeVisible();
    expect(await results(host)).toEqual(hostResult);
    expect(await results(guest)).toEqual(guestResult);
  } finally {
    await writeFile(process.env.DINOPUMP_E2E_CLOCK!, "0");
    await desktop.close();
    await mobile.close();
  }
});
