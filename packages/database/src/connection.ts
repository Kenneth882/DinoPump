import { readFileSync } from "node:fs";
import type { PoolConfig } from "pg";

/** Hosted connections retain session ownership and always verify the server CA. */
export function databaseConnection(
  env: NodeJS.ProcessEnv = process.env,
): PoolConfig {
  let url: URL;
  try {
    url = new URL(env.DATABASE_URL ?? "");
  } catch {
    throw new Error("DATABASE_URL must be a PostgreSQL URL");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error("DATABASE_URL must be a PostgreSQL URL");
  const hosted = !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.hostname.endsWith(".pooler.supabase.com") && url.port !== "5432")
    throw new Error("Supabase requires the session pooler on port 5432");
  // pg connection-string SSL parameters can silently override the explicit CA.
  if ([...url.searchParams.keys()].some((key) => key.startsWith("ssl")))
    throw new Error("Use DATABASE_SSL_CA_FILE, not URL SSL parameters");
  if (hosted && !env.DATABASE_SSL_CA_FILE)
    throw new Error("Hosted PostgreSQL requires DATABASE_SSL_CA_FILE");
  const schema = env.DATABASE_SCHEMA;
  if (schema && !/^[a-z][a-z0-9_]{0,62}$/.test(schema))
    throw new Error("Invalid DATABASE_SCHEMA");
  if (schema && url.searchParams.has("options"))
    throw new Error("Use DATABASE_SCHEMA, not URL options");
  return {
    connectionString: url.href,
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
    ...(schema ? { options: `-c search_path=${schema}` } : {}),
    ...(env.DATABASE_SSL_CA_FILE
      ? {
          ssl: {
            ca: readFileSync(env.DATABASE_SSL_CA_FILE, "utf8"),
            rejectUnauthorized: true,
          },
        }
      : {}),
  };
}
