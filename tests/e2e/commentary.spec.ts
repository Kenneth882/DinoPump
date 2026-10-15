import { writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { expect, test } from "@playwright/test";
import { CommentaryWorker } from "../../apps/commentary-worker/src/worker.js";
import { lobbySnapshotSchema } from "../../packages/contracts/dist/index.js";

test("authored news stays complete without AI; late narration enriches the same card on desktop and mobile (AC-09/11/13/14/18)", async ({
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
      [host!, "News Host"],
      [guest!, "News Guest"],
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
    await writeFile(process.env.DINOPUMP_E2E_CLOCK!, "61000");
    for (const page of [host!, guest!]) {
      await expect(page.getByTestId("news-item")).toHaveCount(1);
      await expect(page.getByTestId("ai-narration")).toHaveCount(0);
    }
    await new CommentaryWorker(
      pool,
      undefined,
      () => Date.now() + 61000,
    ).processOne();
    await writeFile(process.env.DINOPUMP_E2E_CLOCK!, "121000");
    await expect(host!.getByTestId("news-item")).toHaveCount(2);
    await contexts[1]!.setOffline(true);
    await expect(
      guest!.getByText("Reconnecting…", { exact: true }),
    ).toBeVisible();
    await contexts[1]!.setOffline(false);
    await expect(guest!.getByText("Connected", { exact: true })).toBeVisible({
      timeout: 15000,
    });
    await pool.query(
      `CREATE FUNCTION fail_browser_commentary() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic optional browser publication failure'; END $$; CREATE TRIGGER fail_browser_commentary BEFORE INSERT ON commentary_publications FOR EACH ROW EXECUTE FUNCTION fail_browser_commentary()`,
    );
    const worker = new CommentaryWorker(
      pool,
      {
        provider: "synthetic",
        model: "browser-stub",
        promptVersion: "test-v1",
        async narrate() {
          return {
            status: "accepted",
            headline: "Historical herd report",
            commentary:
              "Recorded activity belongs to the preceding window. The herd keeps its history.",
            provenance: {
              provider: "synthetic",
              model: "browser-stub",
              promptVersion: "test-v1",
              durationMs: 0,
              validationStatus: "accepted",
            },
          };
        },
      },
      () => Date.now() + 121000,
    );
    await worker.processOne();
    await writeFile(process.env.DINOPUMP_E2E_CLOCK!, "660000");
    await expect(host!.getByTestId("news-item")).toHaveCount(9);
    const read = async () =>
      lobbySnapshotSchema.parse(
        await host!.evaluate(
          async (roomCode) =>
            await (await fetch(`/api/rooms/${roomCode}/snapshot`)).json(),
          code,
        ),
      );
    const before = await read();
    expect(before.status).toBe("FINISHED");
    const source = before.round!.news[1]!;
    for (const page of [host!, guest!]) {
      await expect(page.getByText("Connected", { exact: true })).toBeVisible();
      await expect(page.getByTestId("ai-narration")).toHaveCount(0);
    }
    await pool.query(
      "DROP TRIGGER fail_browser_commentary ON commentary_publications",
    );
    for (const page of [host!, guest!]) {
      const card = page
        .getByTestId("news-item")
        .filter({
          has: page.getByRole("heading", {
            name: source.headline,
            exact: true,
          }),
        })
        .filter({ has: page.getByText(source.commentary, { exact: true }) });
      // Catalog selections may repeat: source time identifies the original card.
      const target = card.filter({
        has: page.locator(
          `time[datetime="${new Date(source.appliedAtMs).toISOString()}"]`,
        ),
      });
      await expect(target.getByTestId("ai-narration")).toContainText(
        "AI narration",
      );
      await expect(target.getByTestId("ai-narration")).toContainText(
        "As of 2:",
      );
      await expect(target).toContainText(source.facts);
      await expect(target).toContainText(source.commentary);
      await expect(page.getByTestId("news-item")).toHaveCount(9);
      await expect(page.getByTestId("ai-narration")).toHaveCount(1);
    }
    expect((await read()).terminal).toEqual(before.terminal);
    await guest!.reload();
    await expect(guest!.getByTestId("ai-narration")).toHaveCount(1);
  } finally {
    await pool.end();
    await writeFile(process.env.DINOPUMP_E2E_CLOCK!, "0");
    await Promise.all(contexts.map((context) => context.close()));
  }
});
