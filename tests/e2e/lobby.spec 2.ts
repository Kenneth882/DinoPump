import { expect, test } from "@playwright/test";

test("two guests join, reconnect, ready and observe the same authoritative opening at 360px (AC-01/02/10/17 subset)", async ({
  browser,
}, testInfo) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext({
    viewport: { width: 360, height: 800 },
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
      guest.getByText("Game liquidity bot", { exact: false }),
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
        page.getByRole("heading", { name: "Opening resources" }),
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
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});
