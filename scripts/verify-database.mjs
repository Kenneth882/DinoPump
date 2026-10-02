import { spawnSync } from "node:child_process";

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: "inherit", env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited unsuccessfully`);
}

// Never load .env or reuse DATABASE_URL. This Compose project has only tmpfs data.
const compose = ["compose", "-f", "compose.test.yaml"];
try {
  run("docker", [...compose, "up", "-d", "--wait"]);
  run(
    "pnpm",
    ["exec", "vitest", "run", "--config", "vitest.database.config.ts"],
    {
      ...process.env,
      TEST_DATABASE_URL:
        "postgresql://dinopump_test:synthetic_test_only@127.0.0.1:55433/dinopump_test",
    },
  );
} finally {
  run("docker", [...compose, "down"]);
}
