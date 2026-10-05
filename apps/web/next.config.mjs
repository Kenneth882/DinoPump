import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

// Load the shared local environment without forwarding Node CLI flags through
// Next.js's development workers. Explicit process environment values take priority.
const rootEnv = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(rootEnv)) loadEnvFile(rootEnv);

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
