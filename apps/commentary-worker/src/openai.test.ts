import { expect, it } from "vitest";
import { configuredNarrator, OpenAIProvider } from "./openai.js";
import type { NarrationRequest } from "./narrator.js";

const request: NarrationRequest = {
  facts: "Approved fictional event",
  context: {
    capturedAtMs: 60000,
    elapsedMs: 60000,
    windowStartMs: 0,
    assets: [],
  },
  options: [{ headline: "Recorded context", commentary: "Recorded activity." }],
};

it("makes one tool-free structured request with bounded output and private credentials", async () => {
  const controller = new AbortController();
  const provider = new OpenAIProvider(
    "synthetic_key",
    "synthetic-model",
    async (url, init) => {
      expect(url).toBe("https://api.openai.com/v1/responses");
      expect(init?.signal).toBe(controller.signal);
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer synthetic_key",
      });
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        model: "synthetic-model",
        store: false,
        max_output_tokens: 400,
        tools: [],
        text: { format: { type: "json_schema", strict: true } },
      });
      expect(body).not.toHaveProperty("previous_response_id");
      expect(JSON.stringify(body)).not.toContain("synthetic_key");
      expect(body.input).toContain("Approved fictional event");
      return Response.json({
        status: "completed",
        output: [
          {
            type: "message",
            role: "assistant",
            content: [
              { type: "output_text", text: JSON.stringify(request.options[0]) },
            ],
          },
        ],
      });
    },
  );
  expect(await provider.generate(request, controller.signal)).toBe(
    JSON.stringify(request.options[0]),
  );
});

it.each([
  {},
  { COMMENTARY_PROVIDER: "openai", COMMENTARY_MODEL: "test" },
  { COMMENTARY_PROVIDER: "openai", OPENAI_API_KEY: "synthetic" },
  {
    COMMENTARY_PROVIDER: "other",
    OPENAI_API_KEY: "synthetic",
    COMMENTARY_MODEL: "test",
  },
  {
    COMMENTARY_PROVIDER: "openai",
    OPENAI_API_KEY: "synthetic",
    COMMENTARY_MODEL: "<script>",
  },
])(
  "disables missing or unsupported configuration without any provider call",
  (env) => {
    expect(configuredNarrator(env)).toBeUndefined();
  },
);

it("enables only explicit provider/key/model configuration", () => {
  expect(
    configuredNarrator({
      COMMENTARY_PROVIDER: "openai",
      OPENAI_API_KEY: "synthetic",
      COMMENTARY_MODEL: "test-snapshot",
    }),
  ).toMatchObject({ provider: "openai", model: "test-snapshot" });
});

it.each([
  { status: "incomplete", output: [] },
  {
    status: "completed",
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "refusal", refusal: "No" }],
      },
    ],
  },
  { status: "completed", output: [] },
  {
    status: "completed",
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "{}" }, { type: "refusal" }],
      },
    ],
  },
])(
  "does not turn incomplete, refusal or ambiguous provider output into narration",
  async (body) => {
    const provider = new OpenAIProvider("synthetic", "test", async () =>
      Response.json(body),
    );
    expect(await provider.generate(request, new AbortController().signal)).toBe(
      "",
    );
  },
);

it("surfaces outages without exposing provider error bodies or credentials", async () => {
  const provider = new OpenAIProvider(
    "synthetic_secret",
    "test",
    async () => new Response("private provider failure", { status: 503 }),
  );
  await expect(
    provider.generate(request, new AbortController().signal),
  ).rejects.toThrow("Narration provider unavailable");
});
