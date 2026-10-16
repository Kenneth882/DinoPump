import { spawnSync } from "node:child_process";

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: "inherit", env });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv.includes("--staging")) {
  // No Docker, .env loading, migration or destructive cleanup in hosted mode.
  process.exitCode = run("node", [
    "--import",
    "tsx",
    "tests/load/eight-client.ts",
    ...process.argv.slice(2),
  ]);
} else {
  // Same tmpfs-only database as db:verify; never read .env or DATABASE_URL.
  const env = {
    ...process.env,
    DINOPUMP_TEST_PORT: process.env.DINOPUMP_TEST_PORT ?? "55434",
    DINOPUMP_TEST_PROJECT: process.env.DINOPUMP_TEST_PROJECT ?? "dinopump-load",
  };
  const compose = ["compose", "-f", "compose.test.yaml"];
  try {
    if (run("docker", [...compose, "up", "-d", "--wait"], env))
      throw new Error("Isolated PostgreSQL unavailable");
    process.exitCode = run(
      "node",
      [
        "--import",
        "tsx",
        "tests/load/eight-client.ts",
        ...process.argv.slice(2),
      ],
      {
        ...env,
        TEST_DATABASE_URL: `postgresql://dinopump_test:synthetic_test_only@127.0.0.1:${env.DINOPUMP_TEST_PORT}/dinopump_test`,
      },
    );
  } finally {
    if (run("docker", [...compose, "down"], env)) process.exitCode = 1;
  }
}
