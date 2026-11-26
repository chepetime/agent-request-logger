import { gzipSync } from "node:zlib";
import { expect, it } from "vitest";
import {
  type Exchange,
  isCredentialHeader,
  markdown,
  requestText,
  responseSummary,
  safeHeaders,
} from "../../src/capture.js";

const event = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;

it("assembles OpenAI text, tool calls, reasoning and usage across events", () => {
  const output = responseSummary(
    [
      { choices: [{ delta: { content: "Hel", reasoning_content: "Think" } }] },
      {
        choices: [
          {
            delta: {
              content: "lo",
              tool_calls: [{ index: 0, function: { name: "read", arguments: '{"path":' } }],
            },
          },
        ],
      },
      {
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"a"}' } }] } }],
        usage: { total_tokens: 9 },
      },
    ]
      .map(event)
      .join(""),
    "openai",
  );
  expect(output).toContain("Hello");
  expect(output).toContain("Think");
  expect(output).toContain("read");
  expect(output).toContain("total_tokens");
});

it("handles Responses API streaming and completed JSON", () => {
  expect(
    responseSummary(event({ type: "response.output_text.delta", delta: "hello" }), "openai"),
  ).toContain("hello");
  expect(
    responseSummary(
      JSON.stringify({
        output: [{ type: "message", content: [{ type: "output_text", text: "complete" }] }],
      }),
      "openai",
    ),
  ).toContain("complete");
});

it("assembles Anthropic reasoning and tool arguments", () => {
  const output = responseSummary(
    [
      { type: "content_block_start", index: 1, content_block: { type: "tool_use", name: "read" } },
      { delta: { thinking: "consider" } },
      { delta: { text: "done" } },
      { index: 1, delta: { partial_json: '{"path":"file"}' } },
      { usage: { output_tokens: 3 } },
    ]
      .map(event)
      .join(""),
    "anthropic",
  );
  for (const value of ["consider", "done", "read", "file", "output_tokens"])
    expect(output).toContain(value);
});

it("decodes compressed requests without changing their original buffers", () => {
  const compressed = gzipSync("original");
  expect(requestText(compressed, "gzip")).toBe("original");
  expect(requestText(Buffer.from("broken"), "gzip")).toContain("could not be decoded");
  expect(compressed.equals(gzipSync("original"))).toBe(true);
});

it("redacts header names case-insensitively and preserves body content", () => {
  expect(
    safeHeaders({ Authorization: "secret", cookie: "session", "x-api-key": "secret" }),
  ).toEqual({ Authorization: "[REDACTED]", cookie: "[REDACTED]", "x-api-key": "[REDACTED]" });
  const exchange: Exchange = {
    agent: "Example",
    protocol: "anthropic",
    method: "POST",
    url: "/v1/messages",
    status: 200,
    headers: { authorization: "secret" },
    request: Buffer.from(
      JSON.stringify({
        system: "instructions",
        tools: [{ name: "read" }],
        messages: [{ role: "user", content: "keep ``` fences" }],
      }),
    ),
    response: Buffer.from("unrecognized"),
    elapsedMs: 1,
  };
  const output = markdown(exchange);
  expect(output).not.toContain("secret");
  for (const value of ["instructions", "read", "keep ``` fences", "unrecognized", "````"])
    expect(output).toContain(value);
});

it.each([
  ["authorization", true],
  ["Proxy-Authorization", true],
  ["x-api-key", true],
  ["x-goog-api-key", true],
  ["x-auth-token", true],
  ["x-amz-security-token", true],
  ["set-cookie", true],
  ["openai-api-key", true],
  ["anthropic-beta", false],
  ["session_id", false],
  ["content-type", false],
  ["x-tokenizer-version", false],
])("classifies %s as credential: %s", (name, hidden) => {
  expect(isCredentialHeader(name)).toBe(hidden);
});

it("labels incomplete and truncated captures", () => {
  const output = markdown({
    agent: "Example",
    protocol: "raw",
    method: "POST",
    url: "/v1/x",
    status: 200,
    headers: {},
    request: Buffer.from("{"),
    response: Buffer.from(""),
    elapsedMs: 1,
    responseIncomplete: true,
    requestTruncated: true,
    responseTruncated: true,
  });
  expect(output).toContain("closed before the upstream finished");
  expect(output).toContain("Request body exceeded the capture limit");
  expect(output).toContain("Response body exceeded the capture limit");
});

it("preserves malformed or unfamiliar provider payloads without breaking capture rendering", () => {
  for (const value of [
    { choices: [null], content: {} },
    { output: [null, { content: {} }] },
    { unexpected: true },
  ]) {
    expect(responseSummary(JSON.stringify(value), "openai")).toBeTruthy();
    expect(responseSummary(JSON.stringify(value), "anthropic")).toBeTruthy();
  }
});
