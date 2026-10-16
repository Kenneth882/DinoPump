import { Pool } from "pg";
import { databaseConnection } from "../packages/database/dist/index.js";
import { prepareStaging } from "../packages/database/src/staging.js";

// Explicit operator action after resource approval. Never load developer .env.
const id = process.env.DINOPUMP_DEPLOYMENT_ID ?? "";
const pool = new Pool(
  databaseConnection({
    ...process.env,
    DATABASE_URL: process.env.STAGING_ADMIN_DATABASE_URL,
    DATABASE_SCHEMA: `staging_${id}`,
  }),
);
try {
  await prepareStaging(pool, {
    id,
    schema: `staging_${id}`,
    gameRole: `game_${id}`,
    auditRole: `audit_${id}`,
    gamePassword: process.env.STAGING_GAME_PASSWORD ?? "",
    auditPassword: process.env.STAGING_AUDIT_PASSWORD ?? "",
  });
  console.info(
    "Staging schema migrated; game and read-only audit roles provisioned",
  );
} catch {
  console.error(
    "Staging preparation failed. Inspect operator privileges and identity; do not reset existing data. No driver details logged.",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
