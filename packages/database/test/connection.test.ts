import { expect, it } from "vitest";
import { databaseConnection } from "../src/connection.js";

it("requires verified TLS and a session connection for hosted ownership", () => {
  const env = {
    NODE_ENV: "production",
    DATABASE_URL:
      "postgresql://game.synthetic:synthetic@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
    DATABASE_SCHEMA: "staging_0123456789abcdef0123456789abcdef",
  };
  expect(() => databaseConnection(env)).toThrow("session");
  env.DATABASE_URL = env.DATABASE_URL.replace(":6543", ":5432");
  expect(() => databaseConnection(env)).toThrow("DATABASE_SSL_CA_FILE");
});
