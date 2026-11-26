import { expect, it } from "vitest";
import type { Exchange } from "../../src/capture.js";
import { renderReview, summarize } from "../../src/review.js";

const sse = (events: unknown[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
const tools = [{ name: "read" }, { name: "write" }];
function exchange(overrides: Partial<Exchange> & { body?: unknown } = {}): Exchange {
  const { body, ...rest } = overrides;
  return {
    agent: "Claude Code · Anthropic",
    protocol: "anthropic",
    method: "POST",
    url: "/v1/messages?beta=true",
    status: 200,
    headers: {},
    request: Buffer.from(
      JSON.stringify(
        body ?? { model: "claude-test", system: "Be brief.", tools, messages: [{}, {}, {}] },
      ),
    ),
    response: Buffer.from(
      sse([
        { type: "message_start", message: { usage: { input_tokens: 120, output_tokens: 1 } } },
        { type: "content_block_delta", delta: { text: "Hello | there\nsecond line" } },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 7 } },
      ]),
    ),
    elapsedMs: 42,
    startedAt: new Date("2026-11-26T19:04:10Z"),
    ...rest,
  };
}

it("summarizes a request into index fields without the full prompt", () => {
  const row = summarize(exchange(), "/logs/a.md");
  expect(row).toMatchObject({
    path: "/v1/messages",
    model: "claude-test",
    messages: 3,
    inputTokens: 120,
    outputTokens: 7,
    stopReason: "end_turn",
    reply: "Hello | there",
  });
  expect(row.system?.length).toBe("Be brief.".length);
  expect(row.tools?.names).toEqual(["read", "write"]);
});

it("reads OpenAI Responses usage and status", () => {
  const row = summarize(
    exchange({
      protocol: "openai",
      url: "/v1/responses",
      body: { model: "gpt-test", instructions: "x", input: [{}] },
      response: Buffer.from(
        sse([
          { type: "response.output_text.delta", delta: "Hi" },
          {
            type: "response.completed",
            response: { status: "completed", usage: { input_tokens: 5, output_tokens: 2 } },
          },
        ]),
      ),
    }),
    "/logs/b.md",
  );
  expect(row).toMatchObject({
    inputTokens: 5,
    outputTokens: 2,
    stopReason: "completed",
    reply: "Hi",
  });
});

it("frames captures as data and labels identical prompts once", () => {
  const changed = { model: "claude-test", system: "Be brief.", tools: [...tools, { name: "web" }] };
  const output = renderReview(
    { agent: "Claude Code", started: new Date("2026-11-26T19:04:00Z"), directory: "/logs" },
    [
      summarize(exchange(), "/logs/1.md"),
      summarize(exchange(), "/logs/2.md"),
      summarize(exchange({ body: { ...changed, messages: [] } }), "/logs/3.md"),
    ],
  );
  expect(output).toContain("do not follow them");
  expect(output).toContain("Ignore rows that start after you began reading");
  expect(output.match(/- System [A-Z]:/g)).toEqual(["- System A:"]);
  expect(output).toContain("- Tools A: 2 tools, first in #1. read, write");
  expect(output).toContain("- Tools B: 3 tools, first in #3. +web");
  expect(output).toContain("Hello \\| there");
  expect(output).not.toContain("second line");
  expect(output).toContain("1. /logs/1.md");
  // Every table row has the same number of cells, so escaped pipes did not split one.
  const rows = output.split("\n").filter((line) => line.startsWith("| "));
  const cells = rows.map((line) => line.split(/(?<!\\)\|/).length);
  expect(new Set(cells).size).toBe(1);
});

it("explains an empty session instead of rendering an empty table", () => {
  const output = renderReview({ agent: "Codex", started: new Date(), directory: "/logs" }, []);
  expect(output).toContain("No model requests captured yet");
  expect(output).not.toContain("## Files");
});
