import { writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { expect, test } from "@playwright/test";
import { CommentaryWorker } from "../../apps/commentary-worker/src/worker.js";
import { configuredNarrator } from "../../apps/commentary-worker/src/openai.js";
import { lobbySnapshotSchema } from "../../packages/contracts/dist/index.js";

test("two guests trade, receive all nine events, reconnect and finish with no LLM key (AC-09/11/13/18)", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const contexts = await Promise.all([
    browser.newContext({ viewport: { width: 1600, height: 1000 } }),
    browser.newContext({ viewport: { width: 360, height: 800 } }),
  ]);
  const [host, guest] = await Promise.all(
    contexts.map((context) => context.newPage()),
  );
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    for (const [page, name] of [
      [host!, "No Key Host"],
      [guest!, "No Key Guest"],
    ] as const) {
      await page.goto("/");
      await page.getByLabel("Display name").fill(name);
      await page.getByRole("button", { name: "Save guest" }).click();
    }
    await host!.getByRole("button", { name: "Create lobby" }).click();
    const code = await host!.getByTestId("room-code").innerText();
    await guest!.getByLabel("Room code").fill(code);
    await guest!.getByRole("button", { name: "Join lobby" }).click();
    for (const page of [host!, guest!]) {
      await expect(page.getByText("Connected", { exact: true })).toBeVisible();
      await page
        .getByRole("button", { name: "Ready for round", exact: true })
        .click();
    }
    await host!
      .getByRole("button", { name: "Start round", exact: true })
      .click();
    await expect(
      host!.getByRole("heading", { name: "Market and your resources" }),
    ).toBeVisible({ timeout: 10000 });
    await host!.getByLabel("Whole units").fill("1");
    await host!.getByRole("button", { name: "Submit buy" }).click();
    await expect(host!.getByTestId("trade-result")).toContainText(
      "1 units executed",
    );
    // Both real browser clients confirm validated batch receipt for ticket #20.
    await expect
      .poll(async () => {
        const metrics = await (
          await fetch("http://127.0.0.1:3101/metrics")
        ).json();
        return metrics.histograms.commit_to_client_ms?.count ?? 0;
      })
      .toBeGreaterThanOrEqual(2);
    await writeFile(process.env.DINOPUMP_E2E_CLOCK!, "61000");
    await expect(host!.getByTestId("news-item")).toHaveCount(1);
    const narrator = configuredNarrator({
      COMMENTARY_PROVIDER: "openai",
      COMMENTARY_MODEL: "synthetic",
    });
    expect(narrator).toBeUndefined();
    const worker = new CommentaryWorker(
      pool,
      narrator,
      () => Date.now() + 660000,
    );
    // Missing credentials must also permit trading after a scheduled effect.
    await worker.processOne();
    await host!.getByLabel("Whole units").fill("2");
    await host!.getByRole("button", { name: "Submit buy" }).click();
    await expect(host!.getByTestId("trade-result")).toContainText(
      "2 units executed",
    );
    await contexts[1]!.setOffline(true);
    await expect(
      guest!.getByText("Reconnecting…", { exact: true }),
    ).toBeVisible();
    await contexts[1]!.setOffline(false);
    await expect(guest!.getByText("Connected", { exact: true })).toBeVisible({
      timeout: 15000,
    });
    await writeFile(process.env.DINOPUMP_E2E_CLOCK!, "660000");
    const read = async () =>
      lobbySnapshotSchema.parse(
        await host!.evaluate(
          async (roomCode) =>
            await (await fetch(`/api/rooms/${roomCode}/snapshot`)).json(),
          code,
        ),
      );
    await expect.poll(async () => (await read()).status).toBe("FINISHED");
    const before = await read();
    expect(before.round!.news).toHaveLength(9);
    while (await worker.processOne()) {
      /* Drain all nine jobs without a provider. */
    }
    await expect
      .poll(async () =>
        (await read()).round!.news.every(
          (item) => item.narrationStatus === "fallback",
        ),
      )
      .toBe(true);
    const after = await read();
    expect(after.terminal).toEqual(before.terminal);
    for (const item of after.round!.news) {
      const source = before.round!.news.find(
        (news) => news.sourceEventId === item.sourceEventId,
      )!;
      expect(item).toMatchObject({ ...source, narrationStatus: "fallback" });
      expect(item.narration).toBeUndefined();
    }
    for (const page of [host!, guest!]) {
      await expect(page.getByTestId("news-item")).toHaveCount(9);
      await expect(page.getByTestId("ai-narration")).toHaveCount(0);
      await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    }
    await guest!.reload();
    await expect(guest!.getByTestId("news-item")).toHaveCount(9);
    await expect(guest!.getByTestId("ai-narration")).toHaveCount(0);
  } finally {
    await pool.end();
    await writeFile(process.env.DINOPUMP_E2E_CLOCK!, "0");
    await Promise.all(contexts.map((context) => context.close()));
  }
});
