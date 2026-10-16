import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

// Load the shared local environment without forwarding Node CLI flags through
// Next.js's development workers. Explicit process environment values take priority.
const rootEnv = fileURLToPath(new URL("../../.env", import.meta.url));
if (process.env.NODE_ENV !== "production" && existsSync(rootEnv))
  loadEnvFile(rootEnv);

// Render supplies a private host:port reference before both build and runtime.
if (!process.env.GAME_SERVER_ORIGIN && process.env.GAME_SERVER_HOSTPORT) {
  if (!/^[a-zA-Z0-9.-]+:[0-9]+$/.test(process.env.GAME_SERVER_HOSTPORT))
    throw new Error("Invalid GAME_SERVER_HOSTPORT");
  process.env.GAME_SERVER_ORIGIN = `http://${process.env.GAME_SERVER_HOSTPORT}`;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  skipTrailingSlashRedirect: true,
  distDir: process.env.DINOPUMP_E2E === "1" ? ".next-e2e" : ".next",
  async rewrites() {
    return [
      {
        source: "/socket.io/:path*",
        destination: `${process.env.GAME_SERVER_ORIGIN ?? "http://127.0.0.1:3001"}/socket.io/`,
      },
    ];
  },
};

export default nextConfig;
