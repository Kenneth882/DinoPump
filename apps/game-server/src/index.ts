import { createServer } from "node:http";

const port = Number(process.env.GAME_SERVER_PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("GAME_SERVER_PORT must be an integer between 1 and 65535");
}

// Process liveness only. Room commands, Socket.IO, and persistence come later.
const server = createServer((request, response) => {
  response.setHeader("Content-Type", "application/json");
  if (request.method === "GET" && request.url === "/health") {
    response.end(JSON.stringify({ status: "ok" }));
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ error: "NOT_FOUND" }));
});

server.listen(port, "127.0.0.1", () => {
  console.info(`DinoPump service listening on http://127.0.0.1:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => server.close());
}
