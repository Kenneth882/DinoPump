import { expect, test } from "@playwright/test";

test("two guests create, join, and reconnect to the same lobby at 360px (AC-01/10/17 lobby subset)", async ({
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
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});
