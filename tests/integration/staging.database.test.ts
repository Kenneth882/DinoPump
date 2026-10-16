import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { expect, it } from "vitest";
import { isolatedDatabase } from "../helpers/database.js";
import { prepareStaging } from "../../packages/database/src/staging.js";
import { LobbyStore } from "../../packages/database/dist/index.js";

it("provisions a usable game login and a read-only replay login without migration privileges", async () => {
  const database = await isolatedDatabase();
  const id = randomUUID().replaceAll("-", "");
  const schema = `staging_${id}`;
  const gameRole = `game_${id}`;
  const auditRole = `audit_${id}`;
  const connection = (role: string) => {
    const url = new URL(process.env.TEST_DATABASE_URL!);
    url.username = role;
    url.password = "synthetic";
    return new Pool({
      connectionString: url.href,
      options: `-c search_path=${schema}`,
    });
  };
  const game = connection(gameRole);
  const audit = connection(auditRole);
  const operator = new Pool({
    connectionString: process.env.TEST_DATABASE_URL,
    options: `-c search_path=${schema}`,
  });
  let store: LobbyStore | undefined;
  try {
    await prepareStaging(operator, {
      id,
      schema,
      gameRole,
      auditRole,
      gamePassword: "synthetic",
      auditPassword: "synthetic",
    });
    await expect(
      prepareStaging(operator, {
        id,
        schema,
        gameRole,
        auditRole,
        gamePassword: "different",
        auditPassword: "different",
      }),
    ).rejects.toThrow();
    store = await LobbyStore.open(game);
    expect(await store.isReady()).toBe(true);
    expect(
      (await audit.query("SELECT id FROM deployment_identity")).rows,
    ).toEqual([{ id }]);
    await expect(audit.query("DELETE FROM guest_sessions")).rejects.toThrow();
    await expect(
      game.query("CREATE TABLE forbidden (id int)"),
    ).rejects.toThrow();
    await expect(
      game.query("UPDATE deployment_identity SET id='changed'"),
    ).rejects.toThrow();
    await expect(
      audit.query("SELECT claim_commentary(1, $1)", [randomUUID()]),
    ).rejects.toThrow();
  } finally {
    await store?.close();
    await game.end();
    await audit.end();
    // This entire server is the guarded tmpfs-only test database.
    await database.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await database.pool.query(`DROP ROLE IF EXISTS ${gameRole}, ${auditRole}`);
    await operator.end();
    await database.close();
  }
});
