import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

// Load the shared local environment without forwarding Node CLI flags through
// Next.js's development workers. Explicit process environment values take priority.
const rootEnv = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(rootEnv)) loadEnvFile(rootEnv);

/** @type {import('next').NextConfig} */
const nextConfig = {};

export default nextConfig;
