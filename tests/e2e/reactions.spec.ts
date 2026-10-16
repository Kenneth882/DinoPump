import { terminalView } from "../helpers/terminal.js";
import { writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
  lobbySnapshotSchema,
  reactionPublishedSchema,
  roundEndedSchema,
} from "../../packages/contracts/dist/index.js";

test("room members exchange reactions and recover public activity without changing market/results (AC-05/10/11/17)", async ({
  browser,
}, testInfo) => {
  test.setTimeout(120000);
  const hostContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const guestContext = await browser.newContext({
    viewport: { width: 360, height: 800 },
    reducedMotion: "reduce",
  });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  let inject: (packet: string) => void = () => {};
  let lastReaction = "";
  let lastBatch = "";
  let dropReactionAck = false;
  let silenceMarket = false;
  let sentReactions = 0;
  const guestPackets: string[] = [];
  await guestContext.routeWebSocket(/socket\.io/, (ws) => {
    const server = ws.connectToServer();
    inject = (packet) => ws.send(packet);
    ws.onMessage((message) => {
      if (String(message).includes('"reaction:send"')) sentReactions++;
      server.send(message);
    });
    server.onMessage((message) => {
      const packet = String(message);
      guestPackets.push(packet);
      if (packet.includes('"reaction:published"')) lastReaction = packet;
      if (packet.includes('"market:batch"')) lastBatch = packet;
      if (
        dropReactionAck &&
        /^43\d+\[/.test(packet) &&
        packet.includes('"publishedId"')
      )
        return;
      if (
        silenceMarket &&
        !packet.includes('"reaction:published"') &&
        packet !== "2"
      )
        return;
      ws.send(message);
    });
  });
  const items = (page: Page) =>
    page
      .getByRole("list", { name: "Executed player activity" })
      .getByRole("listitem");
  const reactions = (page: Page) =>
    page.getByRole("list", { name: "Recent reactions" }).getByRole("listitem");
  const hash = (value: unknown) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");
  try {
    for (const [page, name] of [
      [host, "Roar Host"],
      [guest, "Roar Guest"],
    ] as const) {
      await page.goto("/");
      await page.getByLabel("Display name").fill(name);
      await page.getByRole("button", { name: "Save guest" }).click();
    }
    await host.getByRole("button", { name: "Create lobby" }).click();
    const code = await host.getByTestId("room-code").innerText();
    await guest.getByLabel("Room code").fill(code);
    await guest.getByRole("button", { name: "Join lobby" }).click();
    for (const page of [host, guest])
      await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    const read = (page: Page) =>
      page
        .evaluate(
          async (roomCode) =>
            await (await fetch(`/api/rooms/${roomCode}/snapshot`)).json(),
          code,
        )
        .then((raw) => lobbySnapshotSchema.parse(raw));
    const marketHashes = async () =>
      Promise.all(
        [host, guest].map(async (page) => {
          const state = await read(page);
          return hash({ round: state.round, terminal: state.terminal });
        }),
      );
    await host.getByRole("button", { name: "Big roar", exact: true }).click();
    for (const page of [host, guest])
      await expect(
        page
          .getByRole("list", { name: "Recent reactions" })
          .getByRole("listitem"),
      ).toHaveText(["Roar Host · Big roar"]);
    inject(lastReaction);
    await expect(reactions(guest)).toHaveCount(1);
    const keyboardReaction = guest.getByRole("button", {
      name: "Tiny arms, big gains",
      exact: true,
    });
    await keyboardReaction.focus();
    await guest.keyboard.press("Enter");
    await expect(reactions(host)).toHaveCount(2);
    expect(
      await guest
        .getByRole("list", { name: "Recent reactions" })
        .evaluate((el) =>
          el.closest('[aria-live], [role="status"], [role="log"]'),
        ),
    ).toBeNull();
    for (const page of [host, guest])
      await page
        .getByRole("button", { name: "Ready for round", exact: true })
        .click();
    await host
      .getByRole("button", { name: "Start round", exact: true })
      .click();
    for (const page of [host, guest]) {
      await expect(
        page.getByRole("heading", { name: "Market and your resources" }),
      ).toBeVisible({ timeout: 10000 });
      await expect(
        page.getByText("No executed player activity yet.", { exact: true }),
      ).toBeVisible();
      await expect(reactions(page)).toHaveCount(0);
    }
    const opening = (await read(host)).round!;
    const beforeReactions = await marketHashes();
    await host
      .getByRole("button", { name: "Meteor incoming", exact: true })
      .click();
    await expect(reactions(guest)).toHaveText(["Roar Host · Meteor incoming"]);
    expect(await marketHashes()).toEqual(beforeReactions);
    await host.getByLabel("Whole units").fill("150");
    await host.getByLabel("Maximum buy price (cents)").fill("4100");
    await host.getByRole("button", { name: "Submit buy" }).click();
    await expect(host.getByTestId("trade-result")).toContainText(
      "150 units executed",
    );
    for (const page of [host, guest])
      await expect(
        page
          .getByRole("list", { name: "Executed player activity" })
          .getByRole("listitem"),
      ).toHaveText([
        "Roar Host bought 100 FERN at D$40.40 · D$4,040.00 total · from Game liquidity bot",
        "Roar Host bought 50 FERN at D$40.80 · D$2,040.00 total · from Game liquidity bot",
      ]);
    const bought = (await read(host)).round!;
    // Replaying a fully applied market batch cannot duplicate player activity.
    inject(lastBatch);
    await expect(items(guest)).toHaveCount(2);
    await host.getByLabel("Buy or sell").selectOption("sell");
    await host.getByLabel("Whole units").fill("50");
    await host.getByLabel("Minimum sell price (cents)").fill("3963");
    await host.getByRole("button", { name: "Submit sell" }).click();
    await expect(host.getByTestId("trade-result")).toContainText(
      "50 units executed",
    );
    for (const page of [host, guest]) {
      await expect(items(page)).toHaveCount(3);
      await expect(items(page).last()).toHaveText(
        "Roar Host sold 50 FERN at D$39.63 · D$1,981.50 total · to Game liquidity bot",
      );
    }
    await host.getByLabel("Whole units").fill("200");
    await host.getByRole("button", { name: "Submit sell" }).click();
    await expect(host.getByTestId("trade-result")).toContainText("Rejected");
    await host.getByLabel("Buy or sell").selectOption("buy");
    await host.getByLabel("Whole units").fill("1");
    await host.getByLabel("Maximum buy price (cents)").fill("100");
    await host.getByRole("button", { name: "Submit buy" }).click();
    await expect(host.getByTestId("trade-result")).toContainText(
      "No liquidity within protection",
    );
    await expect(items(guest)).toHaveCount(3);
    // A lost acknowledgement reports uncertainty and never automatically resends.
    dropReactionAck = true;
    await guest
      .getByRole("button", { name: "Meteor incoming", exact: true })
      .click();
    await expect(
      guest.getByText(
        "Reaction confirmation unavailable. It may have been sent.",
        { exact: true },
      ),
    ).toBeVisible();
    const sentBeforeRecovery = sentReactions;
    dropReactionAck = false;
    await terminalView(guest, "Trade");
    // Reaction traffic supplies no freshness evidence for the market channel.
    silenceMarket = true;
    const publicEvent = reactionPublishedSchema.parse(
      JSON.parse(lastReaction.slice(2))[1],
    );
    const injectFreshReaction = () =>
      inject(
        `42${JSON.stringify(["reaction:published", { ...publicEvent, id: randomUUID() }])}`,
      );
    const traffic = setInterval(injectFreshReaction, 300);
    try {
      await expect(
        guest.getByText("Synchronizing…", { exact: true }),
      ).toBeVisible({ timeout: 8000 });
      await expect(
        guest.getByRole("button", { name: "Submit buy" }),
      ).toBeDisabled();
      await expect(
        guest.getByRole("button", { name: "Big roar", exact: true }),
      ).toBeDisabled();
    } finally {
      clearInterval(traffic);
      silenceMarket = false;
    }
    await expect(guest.getByText("Connected", { exact: true })).toBeVisible({
      timeout: 10000,
    });
    expect(sentReactions).toBe(sentBeforeRecovery);
    await writeFile(process.env.DINOPUMP_E2E_CLOCK!, "61000");
    await expect(host.getByTestId("news-item")).toHaveCount(1);
    await guestContext.setOffline(true);
    await expect(guest.getByText("Reconnecting…", { exact: true })).toBeVisible(
      { timeout: 15000 },
    );
    await expect(
      guest.getByRole("button", { name: "Big roar", exact: true }),
    ).toBeDisabled();
    await guestContext.setOffline(false);
    await expect(guest.getByText("Connected", { exact: true })).toBeVisible({
      timeout: 15000,
    });
    expect(sentReactions).toBe(sentBeforeRecovery);
    await expect(items(guest)).toHaveText(await items(host).allTextContents());
    const authoritative = (await read(guest)).round!;
    expect(
      await items(guest).evaluateAll((rows) =>
        rows.map((row) => Number(row.getAttribute("data-sequence"))),
      ),
    ).toEqual(authoritative.trades.map((fill) => fill.sequence));
    expect(
      await guest.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await host.screenshot({
      path: testInfo.outputPath("reactions-desktop.png"),
      fullPage: true,
    });
    await guest.screenshot({
      path: testInfo.outputPath("reactions-360.png"),
      fullPage: true,
    });
    // Incoming events remain bounded, expire, and never become live announcements.
    for (let index = 0; index < 25; index++) injectFreshReaction();
    await expect(reactions(guest)).toHaveCount(20);
    await expect(reactions(guest)).toHaveCount(0, { timeout: 12000 });
    await writeFile(process.env.DINOPUMP_E2E_CLOCK!, "611000");
    for (const page of [host, guest])
      await expect(
        page.getByRole("heading", { name: "Round results", exact: true }),
      ).toBeVisible({ timeout: 15000 });
    const results = (page: Page) =>
      page
        .evaluate(
          async (id) => await (await fetch(`/api/rounds/${id}/results`)).json(),
          opening.roundId,
        )
        .then((raw) => roundEndedSchema.parse(raw));
    const frozen = await Promise.all([results(host), results(guest)]);
    // Results can render before recovery completes. Ephemeral reactions are
    // intentionally cleared during resync, so synchronize both recipients first.
    for (const page of [host, guest])
      await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    for (const page of [host, guest])
      await page.getByRole("button", { name: "Big roar", exact: true }).click();
    await expect(reactions(guest)).toHaveCount(2);
    expect(
      (await Promise.all([results(host), results(guest)])).map(hash),
    ).toEqual(frozen.map(hash));
    const terminalPacket = lastReaction;
    await host.getByRole("button", { name: "Return to lobby" }).click();
    for (const page of [host, guest]) {
      await expect(
        page.getByRole("button", { name: "Ready for round", exact: true }),
      ).toBeVisible();
      await expect(reactions(page)).toHaveCount(0);
    }
    inject(terminalPacket);
    await expect(reactions(guest)).toHaveCount(0);
    for (const page of [host, guest])
      await page
        .getByRole("button", { name: "Ready for round", exact: true })
        .click();
    await host
      .getByRole("button", { name: "Start round", exact: true })
      .click();
    await expect(
      guest.getByRole("heading", { name: "Market and your resources" }),
    ).toBeVisible({ timeout: 10000 });
    expect((await read(guest)).round!.roundId).not.toBe(opening.roundId);
    inject(terminalPacket);
    await expect(reactions(guest)).toHaveCount(0);
    await expect(items(guest)).toHaveCount(0);
    expect(await Promise.all([results(host), results(guest)])).toEqual(frozen);
    for (const packet of guestPackets.filter((p) =>
      p.includes('"reaction:published"'),
    )) {
      const event = JSON.parse(packet.slice(2))[1];
      expect(reactionPublishedSchema.safeParse(event).success).toBe(true);
    }
    expect(
      guestPackets.some((packet) =>
        bought.recentOrders.some((order) => packet.includes(order.requestId)),
      ),
    ).toBe(false);
    const secrets = [
      ...(await hostContext.cookies()),
      ...(await guestContext.cookies()),
    ]
      .filter((cookie) => cookie.name === "dino_session")
      .map((cookie) => cookie.value);
    expect(
      guestPackets.some((packet) =>
        secrets.some((secret) => packet.includes(secret)),
      ),
    ).toBe(false);
  } finally {
    await writeFile(process.env.DINOPUMP_E2E_CLOCK!, "0");
    await hostContext.close();
    await guestContext.close();
  }
});
